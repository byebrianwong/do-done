import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TasksTitle } from '@/components/SwapTitle';
import QuickAddButton from '@/components/QuickAddButton';
import TaskEditModalV2 from '@/components/TaskEditModalV2';
import DisplaySheet from '@/components/DisplaySheet';
import GroupedTaskList from '@/components/GroupedTaskList';
import { ListActionsMenu } from '@/components/ListActionsMenu';
import {
  ListError,
  ListSkeleton,
  UpdatingBar,
} from '@/components/ListPlaceholder';
import {
  invalidateTasks,
  useAllTasks,
  useProjectsWithCounts,
} from '@/lib/task-queries';
import { useRefreshOnFocus, usePullToRefresh } from '@/lib/query-client';
import { useDisplayConfig } from '@/lib/use-display-config';
import { useListLoadState } from '@/lib/list-load-state';
import type { Task } from '@do-done/shared';

export function AllView() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tasksQuery = useAllTasks();
  const { data: tasks = [], refetch } = tasksQuery;
  const loadState = useListLoadState(tasksQuery);
  const { data: projectsWithCounts = [] } = useProjectsWithCounts();
  const [editing, setEditing] = useState<Task | null>(null);
  const [showDisplay, setShowDisplay] = useState(false);
  const { config, setConfig, reset, isDefault } = useDisplayConfig('all');
  useRefreshOnFocus(refetch);
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const handlePress = useCallback((t: Task) => setEditing(t), []);

  const projectList = useMemo(
    () => projectsWithCounts.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    [projectsWithCounts]
  );

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) for (const tag of t.tags) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TasksTitle />
        <View style={styles.topActions}>
          <Pressable onPress={() => setShowDisplay(true)} hitSlop={8} style={styles.iconBtn}>
            <Ionicons name="options-outline" size={22} color="#6366f1" />
            {!isDefault ? <View style={styles.activeDot} /> : null}
          </Pressable>
          <Pressable
            onPress={() => router.push('/search' as never)}
            hitSlop={8}
            style={styles.iconBtn}
          >
            <Ionicons name="search" size={22} color="#6366f1" />
          </Pressable>
          <ListActionsMenu
            actions={[
              {
                key: 'completed',
                label: 'Completed',
                icon: 'checkmark-done-circle-outline',
                onPress: () => router.push('/completed' as never),
              },
            ]}
          />
        </View>
      </View>
      <UpdatingBar visible={loadState.showUpdating} />

      {loadState.showSkeleton ? (
        <ListSkeleton rows={6} />
      ) : loadState.showError ? (
        <ListError onRetry={refetch} />
      ) : (
        <GroupedTaskList
          tasks={tasks}
          projects={projectList}
          config={config}
          onConfigChange={setConfig}
          onTaskPress={handlePress}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
          }
          // Without this the screen is a stack of "(0)" status headers: the
          // grouping emits its columns as drop targets whether or not anything
          // is in them, and there is nothing to drag into them here.
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No tasks yet</Text>
              <Text style={styles.emptyHint}>Tap + to add one.</Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
        />
      )}
      <QuickAddButton />
      <TaskEditModalV2
        task={editing}
        visible={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={invalidateTasks}
      />
      <DisplaySheet
        visible={showDisplay}
        onClose={() => setShowDisplay(false)}
        config={config}
        onChange={setConfig}
        onReset={reset}
        isDefault={isDefault}
        projects={projectList}
        availableTags={availableTags}
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
  activeDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#6366f1',
  },
  listContent: { paddingBottom: 96, flexGrow: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: { fontSize: 16, color: '#6b7280', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#9ca3af', marginTop: 4 },
});
