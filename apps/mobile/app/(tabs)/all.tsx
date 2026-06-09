import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import TaskItem from '@/components/TaskItem';
import QuickAddBar from '@/components/QuickAddBar';
import TaskEditModalV2 from '@/components/TaskEditModalV2';
import SectionedDraggableList, {
  type DraggableSection,
} from '@/components/SectionedDraggableList';
import {
  invalidateTasks,
  reorderTasks,
  updateTask,
  useAllTasks,
} from '@/lib/task-queries';
import { useRefreshOnFocus } from '@/lib/query-client';
import { STATUS_CONFIG } from '@do-done/shared';
import type { Task, TaskStatus } from '@do-done/shared';

// Active statuses, always shown so each is a drag target (terminal statuses
// live in Completed).
const STATUS_GROUPS: TaskStatus[] = [
  'inbox',
  'in_progress',
  'next',
  'not_started',
];

function buildSections(tasks: Task[]): DraggableSection[] {
  const byStatus = new Map<TaskStatus, Task[]>(
    STATUS_GROUPS.map((s) => [s, [] as Task[]])
  );
  for (const t of tasks) {
    if (t.status === 'done' || t.status === 'cancelled') continue;
    byStatus.get(t.status)?.push(t);
  }
  return STATUS_GROUPS.map((s) => ({
    key: s,
    title: STATUS_CONFIG[s].label,
    data: byStatus.get(s)!,
  }));
}

export default function AllTasksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: tasks = [], isRefetching, refetch } = useAllTasks();
  const [editing, setEditing] = useState<Task | null>(null);
  useRefreshOnFocus(refetch);

  const handlePress = useCallback((t: Task) => setEditing(t), []);
  const sections = useMemo(() => buildSections(tasks), [tasks]);

  const onReorder = useCallback((_key: string, ids: string[]) => {
    void reorderTasks(ids).catch(() => {});
  }, []);

  const onMove = useCallback(
    (taskId: string, _from: string, toKey: string, destIds: string[]) => {
      void updateTask(taskId, { status: toKey as TaskStatus })
        .then(() => reorderTasks(destIds))
        .catch(() => {});
    },
    []
  );

  const renderHeader = useCallback(
    (section: DraggableSection) => (
      <View style={styles.sectionHeader}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: STATUS_CONFIG[section.key as TaskStatus].color },
          ]}
        />
        <Text style={styles.sectionHeaderText}>
          {section.title}{' '}
          <Text style={styles.sectionCount}>({section.data.length})</Text>
        </Text>
      </View>
    ),
    []
  );

  const renderTask = useCallback(
    (task: Task, drag: () => void, isActive: boolean) => (
      <View style={isActive ? styles.activeRow : undefined}>
        <TaskItem task={task} onPress={handlePress} onDragHandle={drag} />
      </View>
    ),
    [handlePress]
  );

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.topTitle}>All</Text>
        <View style={styles.topActions}>
          <Pressable
            onPress={() => router.push('/search' as never)}
            hitSlop={8}
            style={styles.iconBtn}
          >
            <Ionicons name="search" size={22} color="#6366f1" />
          </Pressable>
          <Pressable
            onPress={() => router.push('/completed' as never)}
            hitSlop={8}
            style={styles.iconBtn}
          >
            <Ionicons name="checkmark-done-circle" size={22} color="#6366f1" />
          </Pressable>
        </View>
      </View>

      <SectionedDraggableList
        sections={sections}
        renderHeader={renderHeader}
        renderTask={renderTask}
        onReorder={onReorder}
        onMove={onMove}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor="#6366f1"
          />
        }
        contentContainerStyle={styles.listContent}
      />
      <QuickAddBar defaultStatus="not_started" onCreated={invalidateTasks} />
      <TaskEditModalV2
        task={editing}
        visible={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={invalidateTasks}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  topTitle: { fontSize: 22, fontWeight: '700', color: '#111827' },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { padding: 4 },
  activeRow: { opacity: 0.9, backgroundColor: '#f1f5f9' },
  listContent: { paddingBottom: 140, flexGrow: 1 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#6b7280',
  },
  sectionCount: { color: '#9ca3af', fontWeight: '500' },
});
