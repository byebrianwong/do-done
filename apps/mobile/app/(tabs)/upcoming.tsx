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
import DisplaySheet from '@/components/DisplaySheet';
import GroupedTaskList from '@/components/GroupedTaskList';
import SectionedDraggableList, {
  type DraggableSection,
} from '@/components/SectionedDraggableList';
import {
  invalidateTasks,
  reorderTasks,
  updateTask,
  useAllTasks,
  useProjectsWithCounts,
} from '@/lib/task-queries';
import { useRefreshOnFocus } from '@/lib/query-client';
import { useDisplayConfig } from '@/lib/use-display-config';
import {
  addDaysLocalISO,
  filterByConfig,
  isManualSort,
  isOverdue,
  todayLocalISO,
  type Task,
  type UpdateTaskInput,
} from '@do-done/shared';

const HORIZON_DAYS = 14;

function dayLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function effectiveDate(t: Task): string | null {
  return t.when_date ?? t.due_date ?? null;
}

// What dropping into a date section should do to a task's schedule.
function sectionTarget(key: string): UpdateTaskInput {
  if (key === 'overdue') return { when_date: todayLocalISO(), when_bucket: null };
  if (key === 'later') return { when_date: null, when_bucket: 'later' };
  if (key === 'anytime') return { when_date: null, when_bucket: null };
  if (key === 'someday') return { when_date: null, when_bucket: 'someday' };
  return { when_date: key, when_bucket: null }; // a YYYY-MM-DD day
}

// Build ordered date sections: Overdue → Today → Tomorrow → each dated day in
// the horizon → Later → Anytime → Someday.
function buildSections(tasks: Task[]): DraggableSection[] {
  const today = todayLocalISO();
  const tomorrow = addDaysLocalISO(1);
  const horizonEnd = addDaysLocalISO(HORIZON_DAYS);

  const overdue: Task[] = [];
  const byDate = new Map<string, Task[]>([
    [today, []],
    [tomorrow, []],
  ]);
  const later: Task[] = [];
  const anytime: Task[] = [];
  const someday: Task[] = [];

  const push = (k: string, t: Task) => {
    const a = byDate.get(k) ?? [];
    a.push(t);
    byDate.set(k, a);
  };

  for (const t of tasks) {
    if (t.status === 'done' || t.status === 'cancelled') continue;
    if (isOverdue(t)) {
      overdue.push(t);
      continue;
    }
    const d = effectiveDate(t);
    if (d) {
      if (d <= horizonEnd) push(d, t);
      else later.push(t);
      continue;
    }
    switch (t.when_bucket) {
      case 'today':
        push(today, t);
        break;
      case 'tomorrow':
        push(tomorrow, t);
        break;
      case 'someday':
        someday.push(t);
        break;
      case 'this_week':
      case 'next_week':
      case 'later':
        later.push(t);
        break;
      default:
        anytime.push(t);
    }
  }

  const out: DraggableSection[] = [];
  if (overdue.length) out.push({ key: 'overdue', title: 'Overdue', data: overdue });
  for (const k of [...byDate.keys()].sort()) {
    const title = k === today ? 'Today' : k === tomorrow ? 'Tomorrow' : dayLabel(k);
    out.push({ key: k, title, data: byDate.get(k)! });
  }
  if (later.length) out.push({ key: 'later', title: 'Later', data: later });
  if (anytime.length) out.push({ key: 'anytime', title: 'Anytime', data: anytime });
  if (someday.length) out.push({ key: 'someday', title: 'Someday', data: someday });
  return out;
}

export default function UpcomingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: tasks = [], isRefetching, refetch } = useAllTasks();
  const { data: projectsWithCounts = [] } = useProjectsWithCounts();
  const [editing, setEditing] = useState<Task | null>(null);
  const [showDisplay, setShowDisplay] = useState(false);
  const { config, setConfig, reset, isDefault } = useDisplayConfig('upcoming');
  useRefreshOnFocus(refetch);

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

  const curated = config.group === 'date' && isManualSort(config);
  const sections = useMemo(
    () => buildSections(filterByConfig(tasks, config)),
    [tasks, config]
  );

  const onReorder = useCallback((_key: string, ids: string[]) => {
    void reorderTasks(ids).catch(() => {});
  }, []);

  const onMove = useCallback(
    (taskId: string, _from: string, toKey: string, destIds: string[]) => {
      void updateTask(taskId, sectionTarget(toKey))
        .then(() => reorderTasks(destIds))
        .catch(() => {});
    },
    []
  );

  const renderHeader = useCallback(
    (section: DraggableSection) => (
      <View style={styles.sectionHeader}>
        <Text
          style={[
            styles.sectionHeaderText,
            section.key === 'overdue' && styles.overdueText,
          ]}
        >
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

  const refreshControl = (
    <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#6366f1" />
  );

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.topTitle}>Upcoming</Text>
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
        </View>
      </View>

      {curated ? (
        <SectionedDraggableList
          sections={sections}
          renderHeader={renderHeader}
          renderTask={renderTask}
          onReorder={onReorder}
          onMove={onMove}
          refreshControl={refreshControl}
          contentContainerStyle={styles.listContent}
        />
      ) : (
        <GroupedTaskList
          tasks={tasks}
          projects={projectList}
          config={config}
          onTaskPress={handlePress}
          refreshControl={refreshControl}
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
  activeRow: { opacity: 0.9, backgroundColor: '#f1f5f9' },
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
  overdueText: { color: '#b91c1c' },
  sectionCount: { color: '#9ca3af', fontWeight: '500' },
});
