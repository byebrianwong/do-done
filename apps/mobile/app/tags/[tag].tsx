import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { decodeTagParam, type Task } from '@do-done/shared';

import TaskEditModalV2 from '@/components/TaskEditModalV2';
import DisplaySheet from '@/components/DisplaySheet';
import GroupedTaskList from '@/components/GroupedTaskList';
import {
  ListError,
  ListSkeleton,
  UpdatingBar,
} from '@/components/ListPlaceholder';
import {
  invalidateTasks,
  useProjectsWithCounts,
  useTaggedTasks,
} from '@/lib/task-queries';
import { useRefreshOnFocus, usePullToRefresh } from '@/lib/query-client';
import { useDisplayConfig } from '@/lib/use-display-config';
import { useListLoadState } from '@/lib/list-load-state';

/**
 * Every task carrying one tag.
 *
 * There is no quick-add bar here on purpose: a task typed into it would not
 * pick the tag up — nothing in the composer seeds a tag — so the row would
 * drop straight out of the list it was typed into.
 *
 * One saved Display config for the surface, not one per tag (`viewKey` is the
 * bare "tag", as on web) — otherwise a preference would reset itself every
 * time a new tag was coined.
 */
export default function TagDetailScreen() {
  // Expo Router hands back the raw segment, still percent-encoded.
  const { tag: raw } = useLocalSearchParams<{ tag: string }>();
  const tag = decodeTagParam(raw ?? '');

  const tasksQuery = useTaggedTasks(tag);
  const { data: tasks = [], refetch } = tasksQuery;
  const loadState = useListLoadState(tasksQuery);
  const { data: projectsWithCounts = [] } = useProjectsWithCounts();
  useRefreshOnFocus(refetch);
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const [editing, setEditing] = useState<Task | null>(null);
  const [showDisplay, setShowDisplay] = useState(false);
  const { config, setConfig, reset, isDefault } = useDisplayConfig('tag');
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
      <Stack.Screen
        options={{
          title: `#${tag}`,
          headerRight: () => (
            <Pressable
              onPress={() => setShowDisplay(true)}
              hitSlop={8}
              style={styles.iconBtn}
            >
              <Ionicons name="options-outline" size={22} color="#6366f1" />
              {!isDefault ? <View style={styles.activeDot} /> : null}
            </Pressable>
          ),
        }}
      />
      <UpdatingBar visible={loadState.showUpdating} />
      <GroupedTaskList
        tasks={tasks}
        projects={projectList}
        config={config}
        onConfigChange={setConfig}
        onTaskPress={handlePress}
        // A tag cuts across projects and statuses, so this screen genuinely
        // cannot tell whether a completion emptied anything — a section here is
        // not a section of *work*, it is a slice of several. Withholding the
        // count is how a surface says "I can't tell", which keeps the
        // celebration rules from firing on a guess.
        sectionCounts={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
          />
        }
        ListEmptyComponent={
          loadState.showSkeleton ? (
            <ListSkeleton rows={4} />
          ) : loadState.showError ? (
            <ListError onRetry={refetch} />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Nothing tagged #{tag}</Text>
              <Text style={styles.emptyHint}>
                A tag exists only while a task carries it.
              </Text>
            </View>
          )
        }
        contentContainerStyle={styles.listContent}
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
  listContent: { paddingBottom: 40, flexGrow: 1 },
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
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: { fontSize: 16, color: '#6b7280', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#9ca3af', marginTop: 4 },
});
