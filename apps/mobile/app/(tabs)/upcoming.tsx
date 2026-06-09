import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  NestableDraggableFlatList,
  NestableScrollContainer,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import TaskItem from '@/components/TaskItem';
import QuickAddBar from '@/components/QuickAddBar';
import TaskEditModalV2 from '@/components/TaskEditModalV2';
import {
  invalidateTasks,
  reorderTasks,
  useAllTasks,
} from '@/lib/task-queries';
import { useRefreshOnFocus } from '@/lib/query-client';
import {
  addDaysLocalISO,
  isOverdue,
  todayLocalISO,
  type Task,
} from '@do-done/shared';

const HORIZON_DAYS = 14;

type Section = { key: string; title: string; data: Task[] };

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

// Build the ordered Upcoming sections: Overdue → Today → Tomorrow → each dated
// day in the horizon → Later → Anytime → Someday. Empty buckets are dropped.
function buildSections(tasks: Task[]): Section[] {
  const today = todayLocalISO();
  const tomorrow = addDaysLocalISO(1);
  const horizonEnd = addDaysLocalISO(HORIZON_DAYS);

  const overdue: Task[] = [];
  const byDate = new Map<string, Task[]>();
  const later: Task[] = [];
  const anytime: Task[] = [];
  const someday: Task[] = [];

  const push = (m: Map<string, Task[]>, k: string, t: Task) => {
    const a = m.get(k) ?? [];
    a.push(t);
    m.set(k, a);
  };

  for (const t of tasks) {
    if (t.status === 'done' || t.status === 'cancelled') continue;
    if (isOverdue(t)) {
      overdue.push(t);
      continue;
    }
    const d = effectiveDate(t);
    if (d) {
      if (d <= horizonEnd) push(byDate, d, t);
      else later.push(t);
      continue;
    }
    switch (t.when_bucket) {
      case 'today':
        push(byDate, today, t);
        break;
      case 'tomorrow':
        push(byDate, tomorrow, t);
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

  const out: Section[] = [];
  if (overdue.length) out.push({ key: 'overdue', title: 'Overdue', data: overdue });

  for (const k of [...byDate.keys()].sort()) {
    const title =
      k === today ? 'Today' : k === tomorrow ? 'Tomorrow' : dayLabel(k);
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
  const { data: tasks = [], isLoading, isRefetching, refetch } = useAllTasks();
  const [sections, setSections] = useState<Section[]>([]);
  const [editing, setEditing] = useState<Task | null>(null);
  useRefreshOnFocus(refetch);

  // Mirror the server-derived groups into drag-reorderable copies. Re-syncs when
  // a task's date/bucket/status changes (which changes grouping), not on a pure
  // within-day reorder.
  useEffect(() => {
    setSections(buildSections(tasks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tasks
      .map((t) => `${t.id}:${t.when_date ?? t.due_date ?? ''}:${t.when_bucket ?? ''}:${t.status}`)
      .join('|'),
  ]);

  const handlePress = useCallback((t: Task) => setEditing(t), []);

  function persistSection(key: string, data: Task[]) {
    setSections((prev) =>
      prev.map((s) => (s.key === key ? { ...s, data } : s))
    );
    void reorderTasks(data.map((t) => t.id)).catch(() => {});
  }

  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<Task>) => (
      <View style={isActive ? styles.activeRow : undefined}>
        <TaskItem task={item} onPress={handlePress} onDragHandle={drag} />
      </View>
    ),
    [handlePress]
  );

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.topTitle}>Upcoming</Text>
        <Pressable
          onPress={() => router.push('/search' as never)}
          hitSlop={8}
          style={styles.iconBtn}
        >
          <Ionicons name="search" size={22} color="#6366f1" />
        </Pressable>
      </View>

      <NestableScrollContainer
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor="#6366f1"
          />
        }
      >
        {sections.map((section) => (
          <View key={section.key}>
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
            <NestableDraggableFlatList
              data={section.data}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              onDragEnd={({ data }) => persistSection(section.key, data)}
            />
          </View>
        ))}

        {sections.length === 0 && !isLoading ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Nothing on the horizon</Text>
            <Text style={styles.emptyHint}>
              Scheduled and someday tasks show up here.
            </Text>
          </View>
        ) : null}
      </NestableScrollContainer>

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
  iconBtn: { padding: 4 },
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
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { fontSize: 16, color: '#6b7280', fontWeight: '600' },
  emptyHint: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
