import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { PRIORITY_CONFIG } from '@do-done/shared';
import type { Task as SharedTask } from '@do-done/shared';
import { getTasksApi } from '@/lib/supabase';

export type Task = SharedTask;

interface TaskItemProps {
  task: Task;
  onChange?: () => void;
  onPress?: (task: Task) => void;
}

export default function TaskItem({ task, onChange, onPress }: TaskItemProps) {
  const dotColor = PRIORITY_CONFIG[task.priority].color;
  const completed = task.status === 'done';
  const [busy, setBusy] = useState(false);

  async function handleToggle() {
    setBusy(true);
    const tasks = await getTasksApi();
    if (completed) {
      await tasks.update(task.id, { status: 'todo' });
    } else {
      await tasks.complete(task.id);
    }
    setBusy(false);
    onChange?.();
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={() => onPress?.(task)}
    >
      <Pressable
        onPress={handleToggle}
        disabled={busy}
        hitSlop={8}
        style={[
          styles.checkbox,
          {
            borderColor: completed ? '#d4d4d4' : dotColor,
            backgroundColor: completed ? '#d4d4d4' : 'transparent',
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={dotColor} />
        ) : completed ? (
          <Text style={styles.check}>✓</Text>
        ) : null}
      </Pressable>
      <View style={styles.content}>
        <Text
          style={[styles.title, completed && styles.titleDone]}
          numberOfLines={1}
        >
          {task.title}
        </Text>
        {task.due_date ? (
          <Text style={styles.dueDate}>{formatDueDate(task.due_date)}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.getTime() === today.getTime()) return 'Today';
  if (date.getTime() === tomorrow.getTime()) return 'Tomorrow';
  if (date < today) return 'Overdue';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  pressed: {
    backgroundColor: '#f9fafb',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 16,
    color: '#111827',
    flex: 1,
    marginRight: 8,
  },
  titleDone: {
    color: '#9ca3af',
    textDecorationLine: 'line-through',
  },
  dueDate: {
    fontSize: 13,
    color: '#6b7280',
  },
});
