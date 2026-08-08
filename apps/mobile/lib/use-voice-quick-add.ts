/**
 * Dictating a task, from both quick-add surfaces.
 *
 * The bar above the tab bar and the composer the home-screen widget floats are
 * different components with the same job, so the flow they share lives here
 * rather than being written twice and drifting: record → split the transcript
 * into a title and a description → let the user edit either → and only once
 * the task exists, upload the audio against it.
 *
 * That ordering is forced rather than chosen. An attachment row points at a
 * `task_id`, so there is nothing to attach to until the task has been created;
 * the recording therefore waits in the cache directory across the gap between
 * speaking and submitting.
 */

import { useCallback, useRef, useState } from "react";
import { appendTranscript, splitTranscript } from "@do-done/shared";
import { getAttachmentsApi } from "./supabase";
import { useVoiceCapture, type VoiceRecording } from "./voice-capture";
import { attachVoiceNote } from "./voice-note";

export interface UseVoiceQuickAddOptions {
  /**
   * Called with the title half of a transcript, for the host to merge into its
   * text field. The host owns that field — it also runs the tag absorber over
   * it — so this hands the words over rather than setting them.
   */
  onTitle: (title: string) => void;
}

export interface VoiceQuickAdd {
  /** False in Expo Go and on web; the host hides its mic button entirely. */
  supported: boolean;
  /** The live recording state, for `VoiceRecorder`. */
  voice: ReturnType<typeof useVoiceCapture>;
  /** True while the recorder card belongs on screen. */
  open: boolean;
  /** Start recording. A refused permission leaves `open` false. */
  begin: () => Promise<void>;
  /** Abandon the recording in progress and close the card. */
  dismiss: () => void;
  /** The description dictation has built up so far, "" when there is none. */
  description: string;
  /** Anything spoken that hasn't been filed against a task yet. */
  pending: boolean;
  /** Upload every held recording against a task that now exists. */
  flush: (taskId: string) => Promise<void>;
  /** Drop everything held — after a submit, or when the host resets. */
  reset: () => void;
  /** An upload that failed, phrased for the user. */
  error: string | null;
}

export function useVoiceQuickAdd({
  onTitle,
}: UseVoiceQuickAddOptions): VoiceQuickAdd {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  // Recordings live in a ref, not state: `flush` is called from the host's
  // submit handler in the same tick as the create, and a state read there
  // would see the list as it was before the last recording landed.
  const held = useRef<VoiceRecording[]>([]);

  // Held in a ref for the same reason `onDone` is inside useVoiceCapture: the
  // host passes an inline closure, and the callback below must not be rebuilt
  // (and resubscribe the native events) on every keystroke.
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;

  const handleDone = useCallback((recording: VoiceRecording) => {
    setOpen(false);

    if (recording.audioUri) {
      held.current = [...held.current, recording];
      setPendingCount(held.current.length);
    }

    const { title, description: rest } = splitTranscript(recording.transcript);
    if (title) onTitleRef.current(title);
    if (rest) setDescription((prev) => appendTranscript(prev, rest));
  }, []);

  const voice = useVoiceCapture({ onDone: handleDone });

  const begin = useCallback(async () => {
    setError(null);
    // Show the card only once the microphone is actually running, so a refused
    // permission leaves the surface as it was instead of opening onto a
    // recorder that will never hear anything.
    const started = await voice.start();
    if (started) setOpen(true);
  }, [voice]);

  const dismiss = useCallback(() => {
    voice.cancel();
    setOpen(false);
  }, [voice]);

  const reset = useCallback(() => {
    held.current = [];
    setPendingCount(0);
    setDescription("");
    setError(null);
  }, []);

  const flush = useCallback(async (taskId: string) => {
    const recordings = held.current;
    if (recordings.length === 0) return;
    held.current = [];
    setPendingCount(0);

    const api = await getAttachmentsApi();
    for (const recording of recordings) {
      const { error: err } = await attachVoiceNote(api, taskId, recording);
      // The task is already created and its text is already in place, so a
      // failed upload costs the audio and nothing else. Say so rather than
      // failing the capture the user has visibly completed.
      if (err) setError("Task added, but the recording couldn't be attached.");
    }
  }, []);

  return {
    supported: voice.supported,
    voice,
    open,
    begin,
    dismiss,
    description,
    pending: pendingCount > 0,
    flush,
    reset,
    error: error ?? voice.error,
  };
}
