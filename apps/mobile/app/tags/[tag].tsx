import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { decodeTagParam, type Task } from '@do-done/shared';

import TaskItem from '@/components/TaskItem';
import TaskEditModalV2 from '@/components/TaskEditModalV2';
import {
  ListError,
  ListSkeleton,
  UpdatingBar,
} from '@/components/ListPlaceholder';
import { invalidateTasks, useTaggedTasks } from '@/lib/task-queries';
import { useRefreshOnFocus, usePullToRefresh } from '@/lib/query-client';
import { useListLoadState } from '@/lib/list-load-state';

type Section = { title: string; data: Task[] };

/**
 * Every task carrying one tag, split Open / Done like the project screen.
 *
 * There is no quick-add bar here on purpose: a task typed into it would not
 * pick the tag up — nothing in the composer seeds a tag — so the row would
 * drop straight out of the list it was typed into.
 */
export default function TagDetailScreen() {
  // Expo Router hands back the raw segment, still percent-encoded.
  const { tag: raw } = useLocalSearchParams<{ tag: string }>();
  const tag = decodeTagParam(raw ?? '');

  const tasksQuery = useTaggedTasks(tag);
  const { data: tasks = [], refetch } = tasksQuery;
  const loadState = useListLoadState(tasksQuery);
  useRefreshOnFocus(refetch);
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const [editing, setEditing] = useState<Task | null>(null);
  const handlePress = useCallback((t: Task) => setEditing(t), []);

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

  // A tag cuts across projects and statuses, so this screen genuinely cannot
  // tell whether a completion emptied anything — the Open section here is not
  // a section of *work*, it is a slice of several. Passing no count is how a
  // surface says "I can't tell", which keeps the celebration rules from
  // firing on a guess.
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `#${tag}` }} />
      <UpdatingBar visible={loadState.showUpdating} />
      <SectionList
        sections={sections}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
          <TaskItem task={item} onPress={handlePress} />
        )}
        renderSectionHeader={({ section: { title, data } }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>
              {title} <Text style={styles.sectionCount}>({data.length})</Text>
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
              <Text style={styles.emptyText}>Nothing tagged #{tag}</Text>
              <Text style={styles.emptyHint}>
                A tag exists only while a task carries it.
              </Text>
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
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: { fontSize: 16, color: '#6b7280', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#9ca3af', marginTop: 4 },
});
