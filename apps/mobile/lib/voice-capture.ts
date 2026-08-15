/**
 * Recording a voice note: one pass that yields both a transcript and a file.
 *
 * `expo-speech-recognition` will persist the audio it is already listening to
 * (`recordingOptions.persist`), so DoDone gets the recording and the text from
 * a single microphone session. That is worth stating plainly because the
 * obvious alternative — a recorder module alongside the recogniser — means two
 * things contending for the mic, which on Android means one of them silently
 * gets nothing.
 *
 * The module is loaded lazily, exactly as the old quick-add bar did inline:
 * Expo Go's runtime has no arbitrary native modules, so a top-level import
 * takes the whole app down there instead of just hiding a button. Everything
 * below degrades to `supported: false` rather than throwing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { VOICE_MAX_DURATION_MS } from "@do-done/shared";
import { IS_EXPO_GO } from "./runtime";
import {
  applyResult,
  EMPTY_TRANSCRIPT,
  isSessionComplete,
  normalizeLevel,
  recognitionErrorMessage,
  transcriptText,
  type RecognitionResultEvent,
  type TranscriptState,
} from "./voice-session";

// ─── The native module, or a stub ──────────────────────────

interface SpeechModule {
  start: (options: Record<string, unknown>) => void;
  stop: () => void;
  abort: () => void;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
}

type SpeechEventName =
  | "result"
  | "end"
  | "error"
  | "audiostart"
  | "audioend"
  | "volumechange";

const STUB: SpeechModule = {
  start: () => {},
  stop: () => {},
  abort: () => {},
  requestPermissionsAsync: async () => ({ granted: false }),
};

let SpeechRecognition: SpeechModule = STUB;
let useSpeechRecognitionEvent: (
  name: SpeechEventName,
  // The event shapes differ per name and the module types them as a union we
  // narrow at each use site; `unknown` here keeps that honest.
  cb: (event: never) => void
) => void = () => {};
let moduleLoaded = false;

if (!IS_EXPO_GO && Platform.OS !== "web") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-speech-recognition");
    SpeechRecognition = mod.ExpoSpeechRecognitionModule;
    useSpeechRecognitionEvent = mod.useSpeechRecognitionEvent;
    moduleLoaded = true;
  } catch {
    // Not in this build — every surface hides its mic.
  }
}

/**
 * Whether this build can record at all.
 *
 * False in Expo Go and on web, so the mic button is absent rather than present
 * and dead. Exported so a surface can decide its layout without mounting the
 * hook.
 */
export const VOICE_SUPPORTED = moduleLoaded;

/** How often the elapsed counter reticks. Fine enough for a 0:0x readout. */
const TICK_MS = 200;

/**
 * How long to wait for `audioend` after the recogniser has stopped before
 * giving up on the file and handing over the transcript alone.
 *
 * It should always arrive when `persist` is on. The timeout exists so that a
 * recogniser which dies mid-session leaves the user with their words rather
 * than with a recorder that never closes.
 */
const AUDIO_CLOSE_GRACE_MS = 1500;

// ─── The hook ──────────────────────────────────────────────

/** What one finished recording produced. */
export interface VoiceRecording {
  /** What was heard. May be empty — the audio is still worth keeping. */
  transcript: string;
  /**
   * `file://` path to the audio in the cache directory, or null if the
   * platform gave us nothing. The caller owns it from here: upload it, then
   * delete it. Its extension is the only evidence of what was written —
   * Android writes WAV, iOS may write CAF — so the name and MIME type are
   * derived from the URI rather than assumed.
   */
  audioUri: string | null;
  /** How long the recording ran, for the label on the attachment. */
  durationMs: number;
  /** When it started, which is what the stored file is named after. */
  startedAt: number;
}

export interface VoiceCapture {
  /** False in Expo Go, on web, and in any build without the native module. */
  supported: boolean;
  recording: boolean;
  /** Live text, partial results included, so words appear as they're spoken. */
  transcript: string;
  elapsedMs: number;
  /** 0..1 input level, for the meter. */
  level: number;
  error: string | null;
  /** Resolves false when permission was refused or the mic couldn't start. */
  start: () => Promise<boolean>;
  /** Finish and hand the result to `onDone`. */
  stop: () => void;
  /** Abandon the recording. `onDone` never fires. */
  cancel: () => void;
  clearError: () => void;
}

export interface UseVoiceCaptureOptions {
  /**
   * Fired once, when the recogniser has stopped *and* the audio file is
   * closed. Never fired for a cancelled recording.
   */
  onDone?: (recording: VoiceRecording) => void;
  /** BCP-47 tag. Defaults to the recogniser's `en-US`. */
  lang?: string;
}

export function useVoiceCapture(
  options: UseVoiceCaptureOptions = {}
): VoiceCapture {
  const { onDone, lang = "en-US" } = options;

  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Everything the native events touch is a ref: they fire from outside
  // React's batching, and a session that read stale state would hand over the
  // previous recording's transcript.
  const stateRef = useRef<TranscriptState>(EMPTY_TRANSCRIPT);
  const audioUriRef = useRef<string | null>(null);
  const endedRef = useRef(false);
  const audioClosedRef = useRef(false);
  const cancelledRef = useRef(false);
  const activeRef = useRef(false);
  const startedAtRef = useRef(0);
  const graceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // `onDone` is usually an inline closure, so holding it in a ref keeps the
  // event subscriptions below from resubscribing on every parent render.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const clearTimers = useCallback(() => {
    if (graceRef.current) {
      clearTimeout(graceRef.current);
      graceRef.current = null;
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  /** Hand the result over, exactly once per session. */
  const finish = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    clearTimers();
    setRecording(false);
    setLevel(0);

    if (cancelledRef.current) return;

    onDoneRef.current?.({
      transcript: transcriptText(stateRef.current),
      audioUri: audioUriRef.current,
      durationMs: Date.now() - startedAtRef.current,
      startedAt: startedAtRef.current,
    });
  }, [clearTimers]);

  const settle = useCallback(() => {
    if (
      isSessionComplete({
        ended: endedRef.current,
        audioClosed: audioClosedRef.current,
      })
    ) {
      finish();
    }
  }, [finish]);

  useSpeechRecognitionEvent("result", (event: RecognitionResultEvent) => {
    if (!activeRef.current) return;
    stateRef.current = applyResult(stateRef.current, event);
    setTranscript(transcriptText(stateRef.current));
  });

  useSpeechRecognitionEvent("volumechange", (event: { value: number }) => {
    if (!activeRef.current) return;
    setLevel(normalizeLevel(event.value));
  });

  useSpeechRecognitionEvent("audiostart", (event: { uri: string | null }) => {
    // Noted early so a session that ends without an `audioend` still has
    // somewhere to point. The file is not read until `audioend`.
    if (event.uri) audioUriRef.current = event.uri;
  });

  useSpeechRecognitionEvent("audioend", (event: { uri: string | null }) => {
    if (event.uri) audioUriRef.current = event.uri;
    audioClosedRef.current = true;
    settle();
  });

  useSpeechRecognitionEvent("end", () => {
    if (!activeRef.current) return;
    endedRef.current = true;
    // Give the file a moment to close on its own; hand over the transcript
    // alone if it never does.
    if (!audioClosedRef.current && !graceRef.current) {
      graceRef.current = setTimeout(() => {
        graceRef.current = null;
        audioClosedRef.current = true;
        settle();
      }, AUDIO_CLOSE_GRACE_MS);
    }
    settle();
  });

  useSpeechRecognitionEvent(
    "error",
    (event: { error: string; message?: string }) => {
      if (!activeRef.current) return;
      const message = recognitionErrorMessage(event.error);
      if (message) setError(message);
      // Not a cancel: a failed *recognition* still leaves audio worth keeping,
      // and `end` is what completes the session either way.
      endedRef.current = true;
      settle();
    }
  );

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    try {
      SpeechRecognition.stop();
    } catch {
      // Already stopped — `end` has either fired or is about to.
    }
  }, []);

  const cancel = useCallback(() => {
    if (!activeRef.current) return;
    cancelledRef.current = true;
    try {
      SpeechRecognition.abort();
    } catch {
      // ignore
    }
    // Don't wait for `end`: the surface is closing now, and a cancelled
    // session has nothing to hand over.
    activeRef.current = false;
    clearTimers();
    setRecording(false);
    setLevel(0);
  }, [clearTimers]);

  const start = useCallback(async (): Promise<boolean> => {
    if (!moduleLoaded || activeRef.current) return false;

    setError(null);
    const permission = await SpeechRecognition.requestPermissionsAsync().catch(
      () => ({ granted: false })
    );
    if (!permission.granted) {
      setError("DoDone needs microphone and speech access to record.");
      return false;
    }

    stateRef.current = EMPTY_TRANSCRIPT;
    audioUriRef.current = null;
    endedRef.current = false;
    audioClosedRef.current = false;
    cancelledRef.current = false;
    startedAtRef.current = Date.now();
    setTranscript("");
    setElapsedMs(0);
    setLevel(0);

    try {
      SpeechRecognition.start({
        lang,
        interimResults: true,
        // A voice note is more than one utterance. Android 12 and below ignore
        // this and stop at the first pause, which is a shorter note rather
        // than a broken one.
        continuous: true,
        addsPunctuation: true,
        // The whole point: the recogniser writes the WAV it is already
        // listening to, so nothing else has to open the microphone.
        recordingOptions: { persist: true },
        volumeChangeEventOptions: { enabled: true, intervalMillis: 150 },
      });
    } catch {
      setError("Couldn't start recording.");
      return false;
    }

    activeRef.current = true;
    setRecording(true);

    tickRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedMs(elapsed);
      // The ceiling is the attachment size limit wearing a clock's face; see
      // VOICE_MAX_DURATION_MS. Stopping is a normal finish, so the note is
      // kept rather than lost at the boundary.
      if (elapsed >= VOICE_MAX_DURATION_MS) stop();
    }, TICK_MS);

    return true;
  }, [lang, stop]);

  // A surface torn down mid-recording must not leave the microphone open.
  useEffect(
    () => () => {
      if (activeRef.current) {
        cancelledRef.current = true;
        activeRef.current = false;
        try {
          SpeechRecognition.abort();
        } catch {
          // ignore
        }
      }
      if (graceRef.current) clearTimeout(graceRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
    },
    []
  );

  return {
    supported: moduleLoaded,
    recording,
    transcript,
    elapsedMs,
    level,
    error,
    start,
    stop,
    cancel,
    clearError: useCallback(() => setError(null), []),
  };
}
