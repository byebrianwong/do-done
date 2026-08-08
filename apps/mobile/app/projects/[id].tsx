import React, { useCallback, useMemo, useState } from 'react';
import {
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import TaskItem from '@/components/TaskItem';
import QuickAddBar from '@/components/QuickAddBar';
import TaskEditModalV2 from '@/components/TaskEditModalV2';
import {
  ListError,
  ListSkeleton,
  UpdatingBar,
} from '@/components/ListPlaceholder';
import { invalidateTasks, useProject, useProjectTasks } from '@/lib/task-queries';
import { useRefreshOnFocus, usePullToRefresh } from '@/lib/query-client';
import { useListLoadState } from '@/lib/list-load-state';
import type { Task } from '@do-done/shared';

type Section = { title: string; data: Task[] };

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = id ?? '';

  const { data: project } = useProject(projectId);
  const tasksQuery = useProjectTasks(projectId);
  const { data: tasks = [], refetch } = tasksQuery;
  const loadState = useListLoadState(tasksQuery);
  useRefreshOnFocus(refetch);
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const [editing, setEditing] = useState<Task | null>(null);
  const handlePress = useCallback((t: Task) => setEditing(t), []);

  // Split into Open vs Done, mirroring the web project view.
  const sections = useMemo<Section[]>(() => {
    const open: Task[] = [];
    const done: Task[] = [];
    for (const t of tasks) {
      if (t.status === 'done' || t.status === 'cancelled') done.push(t);
      else open.push(t);
    }
    const out: Section[] = [];
    if (open.length) out.push({ title: 'Open', data: open });
    if (done.length) out.push({ title: 'Done', data: done });
    return out;
  }, [tasks]);

  const title = project?.name ?? 'Project';

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title,
          headerTitle: () => (
            <View style={styles.headerTitle}>
              {project?.icon ? (
                <Text style={styles.headerIcon}>{project.icon}</Text>
              ) : project ? (
                <View
                  style={[styles.headerDot, { backgroundColor: project.color }]}
                />
              ) : null}
              <Text style={styles.headerText}>{title}</Text>
            </View>
          ),
        }}
      />
      <UpdatingBar visible={loadState.showUpdating} />
      <SectionList
        sections={sections}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
          <TaskItem task={item} onPress={handlePress} />
        )}
        renderSectionHeader={({ section: { title: t, data } }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>
              {t} <Text style={styles.sectionCount}>({data.length})</Text>
            </Text>
          </View>
        )}
        ListEmptyComponent={
          loadState.showSkeleton ? (
            <ListSkeleton rows={4} />
          ) : loadState.showError ? (
            <ListError onRetry={refetch} />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No tasks in this project yet</Text>
              <Text style={styles.emptyHint}>Add one below.</Text>
            </View>
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
          />
        }
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled
      />
      <QuickAddBar
        defaultStatus="not_started"
        projectId={projectId}
        onCreated={invalidateTasks}
      />
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
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerIcon: { fontSize: 16 },
  headerDot: { width: 12, height: 12, borderRadius: 6 },
  headerText: { fontSize: 17, fontWeight: '700', color: '#111827' },
  listContent: { paddingBottom: 140, flexGrow: 1 },
  sectionHeader: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
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
