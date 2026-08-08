import React, { useCallback, useMemo, useRef } from 'react';
import type { RefreshControlProps } from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import TaskItem from '@/components/TaskItem';
import SectionedDraggableList, {
  type DraggableSection,
} from '@/components/SectionedDraggableList';
import { invalidateTasks, moveTask, reorderTasks } from '@/lib/task-queries';
import {
  applyDisplay,
  isCollapsed,
  isManualSort,
  toggleCollapsed,
  withSort,
} from '@do-done/shared';
import type {
  DisplayConfig,
  GroupDropTarget,
  Task,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput,
} from '@do-done/shared';

interface DisplayProject {
  id: string;
  name: string;
  color: string;
}

interface Props {
  tasks: Task[];
  projects?: DisplayProject[];
  config: DisplayConfig;
  onTaskPress: (t: Task) => void;
  /** Lets a drag in a *sorted* view convert it to manual sort. Without it, a
   *  drag under a non-manual sort just snaps back. */
  onConfigChange?: (next: DisplayConfig) => void;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  contentContainerStyle?: object;
}

/** Translate a group's drop target into the task patch a cross-section drop implies. */
function patchForDrop(drop: GroupDropTarget): UpdateTaskInput {
  switch (drop.field) {
    case 'status':
      return { status: drop.value as TaskStatus };
    case 'priority':
      return { priority: drop.value as TaskPriority };
    case 'project_id':
      return { project_id: drop.value };
    case 'scheduled_date':
      return { scheduled_date: drop.value };
  }
}

/**
 * The generic Display rendering: applyDisplay() → SectionedDraggableList, with
 * the drag matrix shared across the All / Today / Upcoming "override" modes.
 * Cross-section drag maps the target group's drop target to a task patch;
 * reorder persists only under manual sort (else the engine owns the order).
 */
export default function GroupedTaskList({
  tasks,
  projects,
  config,
  onTaskPress,
  onConfigChange,
  refreshControl,
  contentContainerStyle,
}: Props) {
  const { sections, meta } = useMemo(() => {
    const groups = applyDisplay(tasks, config, { projects });
    const sections: DraggableSection[] = groups.map((g) => ({
      key: g.key,
      title: g.label,
      data: g.tasks,
    }));
    const meta = new Map(
      groups.map((g) => [g.key, { color: g.color, drop: g.drop, count: g.count }])
    );
    return { sections, meta };
  }, [tasks, config, projects]);

  // What the list actually renders: collapsed sections keep their header but
  // drop their rows. The full `sections` (above) still drive the freeze/convert
  // refs, so a collapsed section's order is preserved.
  const renderSections = useMemo(
    () =>
      sections.map((s) =>
        isCollapsed(config, s.key) ? { ...s, data: [] as typeof s.data } : s
      ),
    [sections, config]
  );

  const metaRef = useRef(meta);
  metaRef.current = meta;
  const manualRef = useRef(isManualSort(config));
  manualRef.current = isManualSort(config);
  // Refs so the stable callbacks below can read the latest sections/config and
  // freeze the displayed order when converting a sorted view to manual.
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const configRef = useRef(config);
  configRef.current = config;
  const onConfigChangeRef = useRef(onConfigChange);
  onConfigChangeRef.current = onConfigChange;

  const onReorder = useCallback((sectionKey: string, ids: string[]) => {
    if (manualRef.current) {
      void reorderTasks(ids).catch(() => {});
      return;
    }
    // Sorted view: dragging converts it to manual. Freeze the full displayed
    // order (this section reordered) into sort_order, then flip sort to manual.
    const convert = onConfigChangeRef.current;
    if (!convert) {
      invalidateTasks();
      return;
    }
    const allIds = sectionsRef.current.flatMap((s) =>
      s.key === sectionKey ? ids : s.data.map((t) => t.id)
    );
    void reorderTasks(allIds)
      .then(() => convert(withSort(configRef.current, 'manual')))
      .catch(() => {});
  }, []);

  const onMove = useCallback(
    (taskId: string, _from: string, toKey: string, destIds: string[]) => {
      // Collapsed sections aren't drop targets in v1 — snap back, expand to drop in.
      if (isCollapsed(configRef.current, toKey)) {
        invalidateTasks();
        return;
      }
      const drop = metaRef.current.get(toKey)?.drop;
      if (!drop) {
        invalidateTasks();
        return;
      }
      if (manualRef.current) {
        void moveTask(taskId, patchForDrop(drop), destIds).catch(() => {});
        return;
      }
      // Sorted view: apply the field change AND freeze the full displayed order
      // (moved task removed from its old section, dest uses destIds), then flip
      // sort to manual.
      const convert = onConfigChangeRef.current;
      if (!convert) {
        invalidateTasks();
        return;
      }
      const allIds = sectionsRef.current.flatMap((s) =>
        s.key === toKey
          ? destIds
          : s.data.map((t) => t.id).filter((id) => id !== taskId)
      );
      void moveTask(taskId, patchForDrop(drop), allIds)
        .then(() => convert(withSort(configRef.current, 'manual')))
        .catch(() => {});
    },
    []
  );

  const renderHeader = useCallback((section: DraggableSection) => {
    if (!section.title) return <View style={styles.noneHeader} />;
    const m = metaRef.current.get(section.key);
    const color = m?.color ?? '#9ca3af';
    // Full count (not the rendered-rows count, which is 0 when collapsed).
    const count = m?.count ?? section.data.length;
    const collapsed = isCollapsed(configRef.current, section.key);
    const toggle = onConfigChangeRef.current;
    return (
      <Pressable
        style={styles.sectionHeader}
        disabled={!toggle}
        onPress={() => toggle?.(toggleCollapsed(configRef.current, section.key))}
      >
        <Ionicons
          name={collapsed ? 'chevron-forward' : 'chevron-down'}
          size={14}
          color="#9ca3af"
        />
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <Text style={styles.sectionHeaderText}>
          {section.title}{' '}
          <Text style={styles.sectionCount}>({count})</Text>
        </Text>
      </Pressable>
    );
  }, []);

  // With "show completed" on, a ticked-off task stays in this list, so its row
  // must not play the collapse-and-vanish completion exit.
  const keepsCompleted = config.showCompleted;
  const renderTask = useCallback(
    (task: Task, drag: () => void, isActive: boolean) => (
      <View style={isActive ? styles.activeRow : undefined}>
        <TaskItem
          task={task}
          onPress={onTaskPress}
          onDragHandle={drag}
          keepsCompleted={keepsCompleted}
        />
      </View>
    ),
    [onTaskPress, keepsCompleted]
  );

  return (
    <SectionedDraggableList
      sections={renderSections}
      renderHeader={renderHeader}
      renderTask={renderTask}
      onReorder={onReorder}
      onMove={onMove}
      refreshControl={refreshControl}
      contentContainerStyle={contentContainerStyle}
    />
  );
}

const styles = StyleSheet.create({
  activeRow: { opacity: 0.9, backgroundColor: '#f1f5f9' },
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
