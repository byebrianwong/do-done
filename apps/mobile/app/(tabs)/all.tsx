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
import QuickAddBar from '@/components/QuickAddBar';
import TaskEditModalV2 from '@/components/TaskEditModalV2';
import DisplaySheet from '@/components/DisplaySheet';
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
import { applyDisplay, isManualSort } from '@do-done/shared';
import type {
  GroupDropTarget,
  Task,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput,
} from '@do-done/shared';

/** Translate a group's drop target into the task patch a cross-section drop implies. */
function patchForDrop(drop: GroupDropTarget): UpdateTaskInput {
  switch (drop.field) {
    case 'status':
      return { status: drop.value as TaskStatus };
    case 'priority':
      return { priority: drop.value as TaskPriority };
    case 'project_id':
      return { project_id: drop.value };
    case 'when_date':
      return { when_date: drop.value, when_bucket: null };
  }
}

export default function AllTasksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: tasks = [], isRefetching, refetch } = useAllTasks();
  const { data: projectsWithCounts = [] } = useProjectsWithCounts();
  const [editing, setEditing] = useState<Task | null>(null);
  const [showDisplay, setShowDisplay] = useState(false);
  const { config, setConfig, reset, isDefault } = useDisplayConfig('all');
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

  const { sections, meta } = useMemo(() => {
    const groups = applyDisplay(tasks, config, { projects: projectList });
    const sections: DraggableSection[] = groups.map((g) => ({
      key: g.key,
      title: g.label,
      data: g.tasks,
    }));
    const meta = new Map(groups.map((g) => [g.key, { color: g.color, drop: g.drop }]));
    return { sections, meta };
  }, [tasks, config, projectList]);

  // Refs keep drag callbacks stable while always seeing the latest grouping.
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const manualRef = useRef(isManualSort(config));
  manualRef.current = isManualSort(config);

  const onReorder = useCallback((_key: string, ids: string[]) => {
    // A manual reorder only sticks when sorting is manual; otherwise the engine
    // owns the order, so snap back by reconciling from the cache.
    if (!manualRef.current) {
      invalidateTasks();
      return;
    }
    void reorderTasks(ids).catch(() => {});
  }, []);

  const onMove = useCallback(
    (taskId: string, _from: string, toKey: string, destIds: string[]) => {
      const drop = metaRef.current.get(toKey)?.drop;
      if (!drop) {
        // Read-only section (e.g. a date bucket or tag) — revert the move.
        invalidateTasks();
        return;
      }
      void updateTask(taskId, patchForDrop(drop))
        .then(() => reorderTasks(destIds))
        .catch(() => {});
    },
    []
  );

  const renderHeader = useCallback((section: DraggableSection) => {
    if (!section.title) return <View style={styles.noneHeader} />;
    const color = metaRef.current.get(section.key)?.color ?? '#9ca3af';
    return (
      <View style={styles.sectionHeader}>
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <Text style={styles.sectionHeaderText}>
          {section.title}{' '}
          <Text style={styles.sectionCount}>({section.data.length})</Text>
        </Text>
      </View>
    );
  }, []);

  const renderTask = useCallback(
    (task: Task, drag: () => void, isActive: boolean) => (
      <View style={isActive ? styles.activeRow : undefined}>
        <TaskItem task={task} onPress={handlePress} onDragHandle={drag} />
      </View>
    ),
    [handlePress]
  );

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.topTitle}>All</Text>
        <View style={styles.topActions}>
          <Pressable
            onPress={() => setShowDisplay(true)}
            hitSlop={8}
            style={styles.iconBtn}
          >
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
          <Pressable
            onPress={() => router.push('/completed' as never)}
            hitSlop={8}
            style={styles.iconBtn}
          >
            <Ionicons name="checkmark-done-circle" size={22} color="#6366f1" />
          </Pressable>
        </View>
      </View>

      <SectionedDraggableList
        sections={sections}
        renderHeader={renderHeader}
        renderTask={renderTask}
        onReorder={onReorder}
        onMove={onMove}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor="#6366f1"
          />
        }
        contentContainerStyle={styles.listContent}
      />
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
  noneHeader: { height: 8 },
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
});
