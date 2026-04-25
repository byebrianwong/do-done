import React, { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { parseTaskInput } from '@do-done/task-engine';
import { getTasksApi } from '@/lib/supabase';

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
    });

    setSubmitting(false);
    if (!error) {
      setText('');
      onCreated?.();
    }
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.container}>
        <TextInput
          style={styles.input}
          placeholder="Add a task..."
          placeholderTextColor="#9ca3af"
          value={text}
          onChangeText={setText}
          onSubmitEditing={handleSubmit}
          returnKeyType="done"
          editable={!submitting}
        />
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
