import React, { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import TaskItem from '@/components/TaskItem';
import DisplaySheet from '@/components/DisplaySheet';
import GroupedTaskList from '@/components/GroupedTaskList';
import {
  ListError,
  ListSkeleton,
  UpdatingBar,
} from '@/components/ListPlaceholder';
import { useCompletedTasks, useProjectsWithCounts } from '@/lib/task-queries';
import { useRefreshOnFocus, usePullToRefresh } from '@/lib/query-client';
import { useDisplayConfig } from '@/lib/use-display-config';
import { useListLoadState } from '@/lib/list-load-state';
import { filterByConfig, sortTasks, type Task } from '@do-done/shared';

type Section = { title: string; data: Task[] };

function groupByDay(tasks: Task[]): Section[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - 7);

  const buckets = {
    today: [] as Task[],
    yesterday: [] as Task[],
    week: [] as Task[],
    earlier: [] as Task[],
  };
  for (const t of tasks) {
    if (!t.completed_at) {
      buckets.earlier.push(t);
      continue;
    }
    const d = new Date(t.completed_at);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) buckets.today.push(t);
    else if (d.getTime() === yesterday.getTime()) buckets.yesterday.push(t);
    else if (d >= weekStart) buckets.week.push(t);
    else buckets.earlier.push(t);
  }
  const out: Section[] = [];
  if (buckets.today.length) out.push({ title: 'Today', data: buckets.today });
  if (buckets.yesterday.length)
    out.push({ title: 'Yesterday', data: buckets.yesterday });
  if (buckets.week.length) out.push({ title: 'This week', data: buckets.week });
  if (buckets.earlier.length)
    out.push({ title: 'Earlier', data: buckets.earlier });
  return out;
}

/**
 * A finished list, in day buckets.
 *
 * Grouping by the day something was finished is the reading this screen exists
 * for, and the Display engine has no axis for it — `completed_at` is a sort
 * field, not a group key. So this follows Upcoming's shape: under the view's
 * own grouping the bespoke buckets render, and picking any *other* grouping
 * hands the list to `GroupedTaskList`. Either way the config's filters run
 * first, which is what gives this screen "Show subtasks" — a parent whose six
 * steps were ticked off together otherwise buries the rest of the day.
 */
export default function CompletedScreen() {
  const completedQuery = useCompletedTasks();
  const { data: tasks = [], refetch } = completedQuery;
  const loadState = useListLoadState(completedQuery);
  const { data: projectsWithCounts = [] } = useProjectsWithCounts();
  const [showDisplay, setShowDisplay] = useState(false);
  const { config, setConfig, reset, isDefault } = useDisplayConfig('completed');
  useRefreshOnFocus(refetch);
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const projectList = useMemo(
    () => projectsWithCounts.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    [projectsWithCounts]
  );

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) for (const tag of t.tags) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const curated = config.group === 'none';
  // Sorted before bucketing rather than inside it, so the Sort pills order the
  // rows within each day and `groupByDay` stays a pure bucketing pass.
  const sections = useMemo(
    () => groupByDay(sortTasks(filterByConfig(tasks, config), config.sort)),
    [tasks, config]
  );

  const empty = loadState.showSkeleton ? (
    <ListSkeleton rows={4} />
  ) : loadState.showError ? (
    <ListError onRetry={refetch} />
  ) : (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>
        Nothing here yet — complete a task and it’ll land here.
      </Text>
    </View>
  );

  const refresh = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor="#6366f1"
    />
  );

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Completed',
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
      {curated ? (
        <SectionList
          sections={sections}
          keyExtractor={(t) => t.id}
          renderItem={({ item }) => <TaskItem task={item} keepsCompleted />}
          renderSectionHeader={({ section: { title, data } }) => (
            <View style={styles.header}>
              <Text style={styles.headerText}>
                {title} <Text style={styles.headerCount}>({data.length})</Text>
              </Text>
            </View>
          )}
          ListEmptyComponent={empty}
          refreshControl={refresh}
          stickySectionHeadersEnabled
        />
      ) : (
        <GroupedTaskList
          tasks={tasks}
          projects={projectList}
          config={config}
          onConfigChange={setConfig}
          refreshControl={refresh}
          ListEmptyComponent={empty}
        />
      )}
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
  header: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#6b7280',
  },
  headerCount: { color: '#9ca3af', fontWeight: '500' },
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
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#9ca3af', fontSize: 14, textAlign: 'center' },
});
