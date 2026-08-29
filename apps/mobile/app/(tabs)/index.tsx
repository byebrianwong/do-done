import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import OverdueSection from '@/components/OverdueSection';
import QuickAddButton from '@/components/QuickAddButton';
import TaskEditModalV2 from '@/components/TaskEditModalV2';
import DisplaySheet from '@/components/DisplaySheet';
import GroupedTaskList from '@/components/GroupedTaskList';
import CalendarEventRow from '@/components/CalendarEventRow';
import { ListActionsMenu } from '@/components/ListActionsMenu';
import SectionedDraggableList, {
  type DraggableSection,
} from '@/components/SectionedDraggableList';
import {
  ListError,
  ListSkeleton,
  UpdatingBar,
} from '@/components/ListPlaceholder';
import { useListLoadState } from '@/lib/list-load-state';
import {
  invalidateTasks,
  moveTask,
  reorderTasks,
  useProjectsWithCounts,
  useTodayTasks,
} from '@/lib/task-queries';
import { addDaysISO, useCalendarEvents, useLocalDay } from '@/lib/calendar-queries';
import { useRefreshOnFocus, usePullToRefresh } from '@/lib/query-client';
import { useDisplayConfig } from '@/lib/use-display-config';
import { partitionToday, todayUniverse } from '@do-done/task-engine';
import {
  calendarEventsOnDay,
  filterByConfig,
  isCollapsed,
  isManualSort,
  toggleCollapsed,
  todayLocalISO,
} from '@do-done/shared';
import type { CalendarEvent, Task } from '@do-done/shared';

const FOCUS = 'focus';
const OTHER = 'other';

/** Today's Google Calendar events — the fixed skeleton of the day, shown
 *  above the task list so tasks can be planned around them. */
function TodaySchedule({ events }: { events: CalendarEvent[] }) {
  const todayEvents = calendarEventsOnDay(events, todayLocalISO());
  if (todayEvents.length === 0) return null;
  return (
    <View style={scheduleStyles.card}>
      <Text style={scheduleStyles.heading}>Today’s schedule</Text>
      {todayEvents.map((e) => (
        <CalendarEventRow key={e.id} event={e} />
      ))}
    </View>
  );
}

const scheduleStyles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingVertical: 8,
  },
  heading: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#9ca3af',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
});

/** Tasks in this list that still count as work. Feeds the spark gate. */
function openCount(tasks: Task[]): number {
  return tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled')
    .length;
}

export default function TodayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const todayQuery = useTodayTasks();
  const { data: allTasks = [], refetch } = todayQuery;
  // Whether we have an answer at all — "Nothing scheduled today" is only ever
  // shown once we do. On a cold start that's the restored cache; failing that,
  // a skeleton until the fetch lands.
  const loadState = useListLoadState(todayQuery);
  const { data: projectsWithCounts = [] } = useProjectsWithCounts();
  // Today only, in the device's local day (the fetch passes the device
  // timezone so the server resolves the same day the user is looking at;
  // useLocalDay rolls the window over when the app foregrounds on a new day).
  const localDay = useLocalDay();
  const { data: events = [] } = useCalendarEvents(
    localDay,
    addDaysISO(localDay, 1)
  );
  const [editing, setEditing] = useState<Task | null>(null);
  const [showDisplay, setShowDisplay] = useState(false);
  const { config, setConfig, reset, isDefault } = useDisplayConfig('today');
  useRefreshOnFocus(refetch);
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const handlePress = useCallback((t: Task) => setEditing(t), []);

  const projectList = useMemo(
    () => projectsWithCounts.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    [projectsWithCounts]
  );

  const universe = useMemo(
    () => todayUniverse(allTasks, todayLocalISO()),
    [allTasks]
  );

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of universe) for (const tag of t.tags) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [universe]);

  const curated = config.group === 'none' && isManualSort(config);

  // Curated layout works over the filter-applied universe, split into the three
  // Today sections (overdue · focus · other).
  const filtered = useMemo(() => filterByConfig(universe, config), [universe, config]);
  const { overdue, focus, other } = useMemo(
    () => partitionToday(filtered, 3),
    [filtered]
  );

  // Focus membership drives the ⭐ marker on rows in the Focus section.
  const focusIdsRef = useRef<Set<string>>(new Set());
  focusIdsRef.current = useMemo(() => new Set(focus.map((t) => t.id)), [focus]);

  const sections = useMemo<DraggableSection[]>(
    () => [
      { key: FOCUS, title: 'Focus', data: focus },
      { key: OTHER, title: 'Other tasks', data: other },
    ],
    [focus, other]
  );

  // Collapsed sections keep their header but drop their rows from the list.
  const renderSections = useMemo<DraggableSection[]>(
    () => sections.map((s) => (isCollapsed(config, s.key) ? { ...s, data: [] } : s)),
    [sections, config]
  );
  const countByKey = useMemo(
    () => new Map(sections.map((s) => [s.key, s.data.length])),
    [sections]
  );

  const onReorder = useCallback((_key: string, ids: string[]) => {
    void reorderTasks(ids).catch(() => {});
  }, []);

  // Dragging across the Focus ↔ Other boundary pins the task in or forces it
  // out, then persists the destination order. A collapsed destination isn't a
  // drop target (v1) — snap back.
  const onMove = useCallback(
    (taskId: string, _from: string, toKey: string, destIds: string[]) => {
      if (isCollapsed(config, toKey)) {
        invalidateTasks();
        return;
      }
      const focus_override = toKey === FOCUS ? 'include' : 'exclude';
      void moveTask(taskId, { focus_override }, destIds).catch(() => {});
    },
    [config]
  );

  const renderHeader = useCallback(
    (section: DraggableSection) => {
      const isFocus = section.key === FOCUS;
      const collapsed = isCollapsed(config, section.key);
      const count = countByKey.get(section.key) ?? section.data.length;
      return (
        <Pressable
          style={styles.sectionHeader}
          onPress={() => setConfig(toggleCollapsed(config, section.key))}
        >
          <Ionicons
            name={collapsed ? 'chevron-forward' : 'chevron-down'}
            size={14}
            color="#9ca3af"
          />
          {isFocus ? <Ionicons name="flash" size={13} color="#6366f1" /> : null}
          <Text
            style={[styles.sectionHeaderText, isFocus && styles.focusHeaderText]}
          >
            {section.title}{' '}
            <Text style={styles.sectionCount}>({count})</Text>
          </Text>
        </Pressable>
      );
    },
    [config, setConfig, countByKey]
  );

  const renderTask = useCallback(
    (
      task: Task,
      drag: () => void,
      isActive: boolean,
      section: DraggableSection
    ) => (
      <View style={isActive ? styles.activeRow : undefined}>
        <TaskItem
          task={task}
          onPress={handlePress}
          onDragStart={drag}
          focused={focusIdsRef.current.has(task.id)}
          // This screen *is* today, so a row scheduled for today has nothing
          // to add by saying so. It is set per row rather than for the screen
          // because the Focus section pulls in work that isn't today's — a
          // task scheduled Friday, or none at all — and "Fri, Aug 21" sitting
          // under the Today heading is exactly what those rows need to say.
          hideScheduledDay={task.scheduled_date === localDay}
          openInSection={openCount(section.data)}
        />
      </View>
    ),
    [handlePress, localDay]
  );

  const isEmpty =
    overdue.length === 0 && focus.length === 0 && other.length === 0;

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
          {/* Completed and Settings moved in here when the ⋯ arrived: both are
              destinations rather than actions on this list, and five icons
              beside "Today" was the bar competing with the day. */}
          <ListActionsMenu
            actions={[
              {
                key: 'completed',
                label: 'Completed',
                icon: 'checkmark-done-circle-outline',
                onPress: () => router.push('/completed' as never),
              },
              {
                key: 'settings',
                label: 'Settings',
                icon: 'settings-outline',
                onPress: () => router.push('/settings' as never),
              },
            ]}
          />
        </View>
      </View>
      <UpdatingBar visible={loadState.showUpdating} />

      {loadState.showSkeleton ? (
        <ListSkeleton />
      ) : loadState.showError ? (
        <ListError onRetry={refetch} />
      ) : curated ? (
        isEmpty ? (
          <View style={styles.emptyWrap}>
            <TodaySchedule events={events} />
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Nothing scheduled today</Text>
              <Text style={styles.emptyHint}>Tap + to add a task.</Text>
            </View>
          </View>
        ) : (
          <SectionedDraggableList
            sections={renderSections}
            renderHeader={renderHeader}
            renderTask={renderTask}
            onReorder={onReorder}
            onMove={onMove}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
            }
            ListHeaderComponent={
              <>
                <TodaySchedule events={events} />
                <OverdueSection tasks={overdue} onChange={invalidateTasks} />
              </>
            }
            contentContainerStyle={styles.listContent}
          />
        )
      ) : (
        <GroupedTaskList
          tasks={universe}
          projects={projectList}
          config={config}
          onConfigChange={setConfig}
          onTaskPress={handlePress}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
          }
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Scheduled for today by default — that is what this screen is, and an
          undated task captured here would drop straight out of the list it was
          added to. The composer's chip shows the day, a typed date replaces it,
          and `localDay` rolls it over when the app comes back on a new day. */}
      <QuickAddButton scheduledDate={localDay} />
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
    paddingBottom: 96,
    flexGrow: 1,
  },
  emptyWrap: { flex: 1 },
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
  activeRow: { opacity: 0.9, backgroundColor: '#f1f5f9' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  focusHeaderText: { color: '#6366f1' },
  sectionCount: { color: '#9ca3af', fontWeight: '500' },
});
