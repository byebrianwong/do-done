import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
  none: '#9ca3af',
};

export interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date?: string;
  project_id?: string;
  description?: string;
}

interface TaskItemProps {
  task: Task;
  onPress?: (task: Task) => void;
}

export default function TaskItem({ task, onPress }: TaskItemProps) {
  const dotColor = PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.none;

  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={() => onPress?.(task)}
    >
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>
          {task.title}
        </Text>
        {task.due_date ? (
          <Text style={styles.dueDate}>{task.due_date}</Text>
        ) : null}
      </View>
    </Pressable>
  );
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
    opacity: 0.7,
    backgroundColor: '#f9fafb',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
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
  dueDate: {
    fontSize: 13,
    color: '#6b7280',
  },
});
