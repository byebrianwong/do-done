/**
 * Voice-to-text capture for quick-add, wrapping expo-speech-recognition.
 *
 * That module ships custom native code that is NOT in Expo Go, so it's
 * lazy-required only in a dev-client / standalone build. In Expo Go (or web)
 * `supported` is false and callers hide the mic. Partial results stream in via
 * `onResult` so the caller can live-fill its input; the user reviews the parsed
 * chips and taps send (no auto-submit, to avoid acting on a misrecognition).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { IS_EXPO_GO } from './runtime';
import { hapticLight } from './haptics';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SpeechModule: any = {
  start: () => {},
  stop: () => {},
  requestPermissionsAsync: async () => ({ granted: false }),
};
let useSpeechEvent: (
  name: 'result' | 'end' | 'error',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cb: (e: any) => void
) => void = () => {};
let MODULE_LOADED = false;

if (!IS_EXPO_GO) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-speech-recognition');
    SpeechModule = mod.ExpoSpeechRecognitionModule;
    useSpeechEvent = mod.useSpeechRecognitionEvent;
    MODULE_LOADED = true;
  } catch {
    // not available — mic stays hidden
  }
}

export const VOICE_SUPPORTED = MODULE_LOADED && Platform.OS !== 'web';

interface VoiceOptions {
  /** Called with each (partial or final) transcript while listening. */
  onResult: (transcript: string, isFinal: boolean) => void;
  /** Called when listening starts (e.g. to clear the field). */
  onStart?: () => void;
}

export interface VoiceInput {
  supported: boolean;
  listening: boolean;
  toggle: () => void;
  stop: () => void;
}

export function useVoiceInput(opts: VoiceOptions): VoiceInput {
  const [listening, setListening] = useState(false);
  // Keep the latest callbacks without re-subscribing the native listeners.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const handleResult = useCallback((e: { results?: { transcript?: string }[]; isFinal?: boolean }) => {
    const transcript = e?.results?.[0]?.transcript;
    if (transcript != null) optsRef.current.onResult(transcript, !!e?.isFinal);
  }, []);
  const handleEnd = useCallback(() => setListening(false), []);
  const handleError = useCallback(() => setListening(false), []);

  useSpeechEvent('result', handleResult);
  useSpeechEvent('end', handleEnd);
  useSpeechEvent('error', handleError);

  // Stop listening if the host unmounts mid-capture.
  useEffect(() => {
    return () => {
      try {
        SpeechModule.stop();
      } catch {
        // ignore
      }
    };
  }, []);

  const stop = useCallback(() => {
    try {
      SpeechModule.stop();
    } catch {
      // ignore
    }
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (!VOICE_SUPPORTED) return;
    if (listening) {
      stop();
      return;
    }
    void (async () => {
      const perm = await SpeechModule.requestPermissionsAsync();
      if (!perm?.granted) {
        Alert.alert(
          'Microphone needed',
          'Enable microphone access in Settings to add tasks by voice.'
        );
        return;
      }
      hapticLight();
      optsRef.current.onStart?.();
      setListening(true);
      SpeechModule.start({ lang: 'en-US', interimResults: true, continuous: false });
    })();
  }, [listening, stop]);

  return { supported: VOICE_SUPPORTED, listening, toggle, stop };
}
