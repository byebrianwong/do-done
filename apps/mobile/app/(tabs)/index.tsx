import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DraggableFlatList, {
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import TaskItem from '@/components/TaskItem';
import OverdueSection from '@/components/OverdueSection';
import QuickAddBar from '@/components/QuickAddBar';
import TaskEditModalV2 from '@/components/TaskEditModalV2';
import DisplaySheet from '@/components/DisplaySheet';
import GroupedTaskList from '@/components/GroupedTaskList';
import {
  invalidateTasks,
  reorderTasks,
  useProjectsWithCounts,
  useTodayTasks,
} from '@/lib/task-queries';
import { useRefreshOnFocus } from '@/lib/query-client';
import { useDisplayConfig } from '@/lib/use-display-config';
import { generateFocusList } from '@do-done/task-engine';
import { filterByConfig, isManualSort, isOverdue, todayLocalISO } from '@do-done/shared';
import type { Task } from '@do-done/shared';

/** Tasks that belong on Today: overdue + focus picks + anything scheduled today. */
function todayUniverse(allTasks: Task[]): Task[] {
  const active = allTasks.filter(
    (t) => t.status !== 'done' && t.status !== 'cancelled'
  );
  const overdue = active.filter(isOverdue);
  const overdueIds = new Set(overdue.map((t) => t.id));
  const fresh = active.filter((t) => !overdueIds.has(t.id));
  const focusIds = new Set(generateFocusList(fresh, 3).map((t) => t.id));
  const today = todayLocalISO();
  const todayList = fresh.filter((t) => {
    if (focusIds.has(t.id)) return true;
    const d = t.when_date ?? t.due_date ?? null;
    return d !== null && d <= today;
  });
  return [...overdue, ...todayList];
}

export default function TodayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: allTasks = [], isRefetching, refetch } = useTodayTasks();
  const { data: projectsWithCounts = [] } = useProjectsWithCounts();
  const [editing, setEditing] = useState<Task | null>(null);
  const [showDisplay, setShowDisplay] = useState(false);
  const { config, setConfig, reset, isDefault } = useDisplayConfig('today');
  const [otherOrder, setOtherOrder] = useState<Task[]>([]);
  useRefreshOnFocus(refetch);

  const handlePress = useCallback((t: Task) => setEditing(t), []);

  const projectList = useMemo(
    () => projectsWithCounts.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    [projectsWithCounts]
  );

  const universe = useMemo(() => todayUniverse(allTasks), [allTasks]);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of universe) for (const tag of t.tags) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [universe]);

  const curated = config.group === 'none' && isManualSort(config);

  // Curated layout works over the filter-applied universe.
  const filtered = useMemo(() => filterByConfig(universe, config), [universe, config]);
  const overdue = useMemo(() => filtered.filter(isOverdue), [filtered]);
  const todayList = useMemo(() => {
    const overdueIds = new Set(overdue.map((t) => t.id));
    return filtered.filter((t) => !overdueIds.has(t.id));
  }, [filtered, overdue]);
  const focusIds = useMemo(
    () => new Set(generateFocusList(todayList, 3).map((t) => t.id)),
    [todayList]
  );
  const focusIdsRef = useRef<Set<string>>(new Set());
  focusIdsRef.current = focusIds;

  useEffect(() => {
    setOtherOrder(todayList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayList.map((t) => t.id).join(',')]);

  function persistOrder(next: Task[]) {
    setOtherOrder(next);
    void reorderTasks(next.map((t) => t.id)).catch(() => {});
  }

  const renderDraggable = useCallback(
    ({ item, drag, isActive }: RenderItemParams<Task>) => (
      <View style={isActive ? { opacity: 0.9, backgroundColor: '#f1f5f9' } : undefined}>
        <TaskItem
          task={item}
          onPress={handlePress}
          onDragHandle={drag}
          focused={focusIdsRef.current.has(item.id)}
        />
      </View>
    ),
    [handlePress]
  );

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.topTitle}>Today</Text>
        <View style={styles.topActions}>
          <Pressable onPress={() => setShowDisplay(true)} hitSlop={8} style={styles.completedBtn}>
            <Ionicons name="options-outline" size={22} color="#6366f1" />
            {!isDefault ? <View style={styles.activeDot} /> : null}
          </Pressable>
          <Pressable
            onPress={() => router.push('/search' as never)}
            hitSlop={8}
            style={styles.completedBtn}
          >
            <Ionicons name="search" size={22} color="#6366f1" />
          </Pressable>
          <Pressable
            onPress={() => router.push('/completed' as never)}
            hitSlop={8}
            style={styles.completedBtn}
          >
            <Ionicons name="checkmark-done-circle" size={22} color="#6366f1" />
          </Pressable>
          <Pressable
            onPress={() => router.push('/settings' as never)}
            hitSlop={8}
            style={styles.completedBtn}
          >
            <Ionicons name="settings-outline" size={22} color="#6366f1" />
          </Pressable>
        </View>
      </View>

      {curated ? (
        <DraggableFlatList
          data={otherOrder}
          keyExtractor={(item) => item.id}
          renderItem={renderDraggable}
          onDragEnd={({ data }) => persistOrder(data)}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#6366f1" />
          }
          ListHeaderComponent={
            <OverdueSection tasks={overdue} onChange={invalidateTasks} />
          }
          ListEmptyComponent={
            overdue.length === 0 && otherOrder.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>Nothing scheduled today</Text>
                <Text style={styles.emptyHint}>Add a task below.</Text>
              </View>
            ) : null
          }
          contentContainerStyle={styles.listContent}
        />
      ) : (
        <GroupedTaskList
          tasks={universe}
          projects={projectList}
          config={config}
          onTaskPress={handlePress}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#6366f1" />
          }
          contentContainerStyle={styles.listContent}
        />
      )}

      <QuickAddBar defaultStatus="not_started" onCreated={invalidateTasks} />
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
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  topTitle: { fontSize: 22, fontWeight: '700', color: '#111827' },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  completedBtn: { padding: 4 },
  activeDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#6366f1',
  },
  listContent: {
    paddingBottom: 140,
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 16,
    color: '#6b7280',
    fontWeight: '600',
  },
  emptyHint: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 4,
  },
});
