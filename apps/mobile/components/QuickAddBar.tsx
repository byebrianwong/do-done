import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { parseTaskInput } from '@do-done/task-engine';
import { getTasksApi } from '@/lib/supabase';
import { hapticSuccess } from '@/lib/haptics';
import { useVoiceInput } from '@/lib/useVoiceInput';
import ParsePreview from './ParsePreview';
import VoiceMicButton from './VoiceMicButton';

interface QuickAddBarProps {
  defaultStatus?: 'inbox' | 'not_started';
  onCreated?: () => void;
  /** Assign created tasks to this project (e.g. on the project detail screen). */
  projectId?: string;
  /**
   * Focus the input as soon as the bar mounts. Used by the quick-add widget
   * deep link so a home-screen tap lands directly in task capture.
   */
  autoFocus?: boolean;
}

export default function QuickAddBar({
  defaultStatus = 'not_started',
  onCreated,
  projectId,
  autoFocus = false,
}: QuickAddBarProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);
  const inputRef = useRef<TextInput>(null);

  const voice = useVoiceInput({
    onResult: (transcript) => setText(transcript),
    onStart: () => setText(''),
  });

  // edgeToEdgeEnabled in app.config.ts disables Android adjustResize, so the
  // absolute-positioned bar would stay behind the keyboard. Track keyboard
  // height and lift the bar above it.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) =>
      setKbHeight(e.endCoordinates.height)
    );
    const hideSub = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Pre-focus the input when launched via the quick-add widget. A short delay
  // lets the modal transition settle so the keyboard reliably comes up.
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, [autoFocus]);

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);

    const parsed = parseTaskInput(trimmed);
    const tasks = await getTasksApi();
    const { error } = await tasks.create({
      title: parsed.title,
      status: defaultStatus,
      ...(projectId && { project_id: projectId }),
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
      hapticSuccess();
      setText('');
      onCreated?.();
    }
  }

  return (
    <View
      style={[
        styles.wrapper,
        kbHeight > 0 && { bottom: kbHeight + 8 },
      ]}
    >
      <ParsePreview text={text} />
      <View style={styles.container}>
        <TextInput
          ref={inputRef}
          testID="quick-add-input"
          style={styles.input}
          placeholder={voice.listening ? 'Listening…' : 'Add a task...'}
          placeholderTextColor="#9ca3af"
          value={text}
          onChangeText={setText}
          onSubmitEditing={handleSubmit}
          returnKeyType="done"
          editable={!submitting}
        />
        {voice.supported ? (
          <VoiceMicButton
            listening={voice.listening}
            onPress={voice.toggle}
            disabled={submitting}
          />
        ) : null}
        <Pressable
          testID="quick-add-submit"
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
    // Sits just above the tab bar. The Today screen's content area already
    // stops at the top of the tab bar, so this is the gap above it (was 90,
    // which floated the bar too high).
    position: 'absolute',
    bottom: 16,
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
