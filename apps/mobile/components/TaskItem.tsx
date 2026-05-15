import React, { useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PRIORITY_CONFIG, STATUS_CONFIG, formatDuration } from '@do-done/shared';
import type { Task as SharedTask, UpdateTaskInput } from '@do-done/shared';
import { getTasksApi } from '@/lib/supabase';
import { useUndoToast } from './UndoToast';

export type Task = SharedTask;

interface TaskItemProps {
  task: Task;
  onChange?: () => void;
  onPress?: (task: Task) => void;
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}
function addDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function buildReschedule(
  task: Task,
  target:
    | { kind: 'date'; date: string }
    | { kind: 'bucket'; bucket: 'today' | 'tomorrow' | 'this_week' }
    | { kind: 'remove' }
): UpdateTaskInput {
  const today = todayISO();
  if (target.kind === 'remove') {
    return {
      when_date: null,
      when_bucket: null,
      due_date: null,
      due_time: null,
    };
  }
  if (target.kind === 'date') {
    const input: UpdateTaskInput = {
      when_date: target.date,
      when_bucket: null,
    };
    if (task.due_date && task.due_date < target.date) {
      input.due_date = target.date;
    }
    return input;
  }
  const input: UpdateTaskInput = {
    when_date: null,
    when_bucket: target.bucket,
  };
  if (task.due_date && task.due_date < today) input.due_date = today;
  return input;
}

export default function TaskItem({ task, onChange, onPress }: TaskItemProps) {
  const statusCfg = STATUS_CONFIG[task.status];
  const statusColor = statusCfg?.color ?? '#94a3b8';
  const priorityColor = PRIORITY_CONFIG[task.priority].color;
  const priorityLit = { p1: 4, p2: 3, p3: 2, p4: 1 }[task.priority];
  const completed = task.status === 'done';
  const [busy, setBusy] = useState(false);
  const toast = useUndoToast();

  async function handleToggle() {
    setBusy(true);
    const tasks = await getTasksApi();
    if (completed) {
      await tasks.reopen(task.id);
    } else {
      const { error } = await tasks.complete(task.id);
      if (!error) {
        toast.show({
          message: `Completed “${task.title}”`,
          undo: async () => {
            const api = await getTasksApi();
            await api.reopen(task.id);
            onChange?.();
          },
        });
      }
    }
    setBusy(false);
    onChange?.();
  }

  async function applyTarget(target: Parameters<typeof buildReschedule>[1]) {
    const api = await getTasksApi();
    await api.update(task.id, buildReschedule(task, target));
    onChange?.();
  }

  async function confirmDelete() {
    const run = async () => {
      const api = await getTasksApi();
      const { error } = await api.delete(task.id);
      if (error) {
        console.error('Delete failed:', error);
        return;
      }
      onChange?.();
    };
    Alert.alert(
      'Delete task?',
      `“${task.title}” will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: run },
      ]
    );
  }

  function openLongPressMenu() {
    const labels = [
      'Move to Today',
      'Move to Tomorrow',
      'Move to This week',
      'Remove dates',
      'Delete',
      'Cancel',
    ];
    const cancel = labels.length - 1;
    const destructive = 4;
    const choose = (i: number) => {
      switch (i) {
        case 0:
          return applyTarget({ kind: 'date', date: todayISO() });
        case 1:
          return applyTarget({ kind: 'date', date: addDaysISO(1) });
        case 2:
          return applyTarget({ kind: 'bucket', bucket: 'this_week' });
        case 3:
          return applyTarget({ kind: 'remove' });
        case 4:
          return confirmDelete();
        default:
          return;
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: labels,
          cancelButtonIndex: cancel,
          destructiveButtonIndex: destructive,
          title: task.title,
        },
        choose
      );
      return;
    }
    Alert.alert(task.title, 'Reschedule', [
      { text: labels[0], onPress: () => choose(0) },
      { text: labels[1], onPress: () => choose(1) },
      { text: labels[2], onPress: () => choose(2) },
      { text: labels[3], onPress: () => choose(3) },
      { text: labels[4], onPress: () => choose(4), style: 'destructive' },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={() => onPress?.(task)}
      onLongPress={openLongPressMenu}
      delayLongPress={350}
    >
      <Pressable
        onPress={handleToggle}
        disabled={busy}
        hitSlop={8}
        style={[
          styles.checkbox,
          {
            borderColor: completed ? '#d4d4d4' : statusColor,
            backgroundColor: completed ? '#d4d4d4' : 'transparent',
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={statusColor} />
        ) : completed ? (
          <Text style={styles.check}>✓</Text>
        ) : null}
      </Pressable>
      <View style={styles.priorityBars}>
        {[0, 1, 2, 3].map((i) => {
          const lit = i < priorityLit;
          const h = 3 + i * 2;
          return (
            <View
              key={i}
              style={[
                styles.priorityBar,
                { height: h, backgroundColor: lit ? priorityColor : '#e5e7eb' },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text
            style={[styles.title, completed && styles.titleDone]}
            numberOfLines={1}
          >
            {task.title}
          </Text>
          {task.duration_minutes ? (
            <View style={styles.metaChip}>
              <Text style={styles.metaChipLabel}>
                ~{formatDuration(task.duration_minutes)}
              </Text>
            </View>
          ) : null}
          {task.status !== 'not_started' && task.status !== 'inbox' ? (
            <View
              style={[
                styles.statusChip,
                { backgroundColor: STATUS_CONFIG[task.status].color + '22' },
              ]}
            >
              <Text
                style={[
                  styles.statusChipLabel,
                  { color: STATUS_CONFIG[task.status].color },
                ]}
              >
                {STATUS_CONFIG[task.status].label}
              </Text>
            </View>
          ) : null}
        </View>
        {task.when_date ? (
          <Text style={styles.dueDate}>{formatDueDate(task.when_date)}</Text>
        ) : task.due_date ? (
          <Text style={styles.dueDate}>
            {formatDueDate(task.due_date)}
            {task.due_time ? ` ${task.due_time}` : ''}
          </Text>
        ) : task.when_bucket ? (
          <Text style={styles.dueDate}>
            {task.when_bucket.replace('_', ' ')}
          </Text>
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
  pressed: { backgroundColor: '#f9fafb' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: { color: '#fff', fontSize: 13, fontWeight: '700' },
  priorityBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    marginRight: 10,
    width: 18,
    height: 14,
  },
  priorityBar: {
    width: 3,
    borderRadius: 1,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 8,
  },
  title: { fontSize: 16, color: '#111827', flexShrink: 1 },
  titleDone: { color: '#9ca3af', textDecorationLine: 'line-through' },
  dueDate: { fontSize: 13, color: '#6b7280' },
  metaChip: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  metaChipLabel: {
    fontSize: 10,
    color: '#6b7280',
    fontWeight: '600',
  },
  statusChip: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  statusChipLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
