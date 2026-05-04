import React, { useEffect, useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { parseTaskInput } from '@do-done/task-engine';
import { getTasksApi } from '@/lib/supabase';
import { IS_EXPO_GO } from '@/lib/runtime';

// expo-speech-recognition has custom native code, not in Expo Go's bundled
// runtime. Lazy-load it only when we have a dev client / standalone build,
// and stub out the API in Expo Go so the mic button can hide gracefully.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ExpoSpeechRecognitionModule: any = {
  start: () => {},
  stop: () => {},
  requestPermissionsAsync: async () => ({ granted: false }),
};
type SpeechEventName = 'result' | 'end' | 'error';
let useSpeechRecognitionEvent: (
  name: SpeechEventName,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cb: (e: any) => void
) => void = () => {};

if (!IS_EXPO_GO) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-speech-recognition');
    ExpoSpeechRecognitionModule = mod.ExpoSpeechRecognitionModule;
    useSpeechRecognitionEvent = mod.useSpeechRecognitionEvent;
  } catch {
    // module not available — mic stays hidden
  }
}

const VOICE_ENABLED = !IS_EXPO_GO && Platform.OS !== 'web';

interface QuickAddBarProps {
  defaultStatus?: 'inbox' | 'todo';
  onCreated?: () => void;
}

export default function QuickAddBar({
  defaultStatus = 'todo',
  onCreated,
}: QuickAddBarProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [listening, setListening] = useState(false);

  // Speech recognition events
  useSpeechRecognitionEvent('result', (e) => {
    const transcript = e.results?.[0]?.transcript;
    if (transcript) {
      setText(transcript);
    }
  });
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('error', () => setListening(false));

  useEffect(() => {
    return () => {
      // Stop listening if component unmounts
      if (listening) {
        try {
          ExpoSpeechRecognitionModule.stop();
        } catch {
          // ignore
        }
      }
    };
  }, [listening]);

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);

    const parsed = parseTaskInput(trimmed);
    const tasks = await getTasksApi();
    const { error } = await tasks.create({
      title: parsed.title,
      status: defaultStatus,
      ...(parsed.priority && { priority: parsed.priority }),
      ...(parsed.due_date && { due_date: parsed.due_date }),
      ...(parsed.due_time && { due_time: parsed.due_time }),
      ...(parsed.duration_minutes && {
        duration_minutes: parsed.duration_minutes,
      }),
      ...(parsed.tags && parsed.tags.length > 0 && { tags: parsed.tags }),
      ...(parsed.recurrence_rule && {
        recurrence_rule: parsed.recurrence_rule,
      }),
    });

    setSubmitting(false);
    if (!error) {
      setText('');
      onCreated?.();
    }
  }

  async function toggleListening() {
    if (listening) {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        // ignore
      }
      setListening(false);
      return;
    }

    if (Platform.OS === 'web') {
      // Web Speech API isn't reliable cross-browser; tell the user.
      return;
    }

    const result =
      await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) {
      return;
    }

    setListening(true);
    setText('');
    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: true,
      continuous: false,
    });
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.container}>
        <TextInput
          style={styles.input}
          placeholder={listening ? 'Listening...' : 'Add a task...'}
          placeholderTextColor="#9ca3af"
          value={text}
          onChangeText={setText}
          onSubmitEditing={handleSubmit}
          returnKeyType="done"
          editable={!submitting}
        />
        {VOICE_ENABLED ? (
          <Pressable
            style={({ pressed }) => [
              styles.iconButton,
              (pressed || listening) && styles.iconButtonActive,
            ]}
            onPress={toggleListening}
            disabled={submitting}
            hitSlop={4}
          >
            <Ionicons
              name={listening ? 'mic' : 'mic-outline'}
              size={20}
              color={listening ? '#6366f1' : '#6b7280'}
            />
          </Pressable>
        ) : null}
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="add" size={24} color="#fff" />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 90,
    left: 16,
    right: 16,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    paddingVertical: 10,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  iconButtonActive: {
    backgroundColor: '#eef2ff',
  },
  button: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
  },
});
