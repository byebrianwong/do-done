import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  SectionList,
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
import { invalidateTasks, useAllTasks } from '@/lib/task-queries';
import { useRefreshOnFocus } from '@/lib/query-client';
import { STATUS_CONFIG } from '@do-done/shared';
import type { Task, TaskStatus } from '@do-done/shared';

// Active statuses in browse order (terminal statuses live in Completed).
const STATUS_GROUPS: TaskStatus[] = [
  'inbox',
  'in_progress',
  'next',
  'not_started',
];

type Section = { title: string; status: TaskStatus; data: Task[] };

export default function AllTasksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: tasks = [], isLoading, isRefetching, refetch } = useAllTasks();
  const [editing, setEditing] = useState<Task | null>(null);
  useRefreshOnFocus(refetch);

  const handlePress = useCallback((t: Task) => setEditing(t), []);

  const sections = useMemo<Section[]>(() => {
    const byStatus = new Map<TaskStatus, Task[]>();
    for (const t of tasks) {
      if (t.status === 'done' || t.status === 'cancelled') continue;
      const arr = byStatus.get(t.status) ?? [];
      arr.push(t);
      byStatus.set(t.status, arr);
    }
    return STATUS_GROUPS.filter((s) => (byStatus.get(s)?.length ?? 0) > 0).map(
      (s) => ({
        title: STATUS_CONFIG[s].label,
        status: s,
        data: byStatus.get(s) ?? [],
      })
    );
  }, [tasks]);

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

      <SectionList
        sections={sections}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => <TaskItem task={item} onPress={handlePress} />}
        renderSectionHeader={({ section: { title, status, data } }) => (
          <View style={styles.sectionHeader}>
            <View
              style={[styles.statusDot, { backgroundColor: STATUS_CONFIG[status].color }]}
            />
            <Text style={styles.sectionHeaderText}>
              {title} <Text style={styles.sectionCount}>({data.length})</Text>
            </Text>
          </View>
        )}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No active tasks</Text>
              <Text style={styles.emptyHint}>Add one below.</Text>
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor="#6366f1"
          />
        }
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { fontSize: 16, color: '#6b7280', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#9ca3af', marginTop: 4 },
});
