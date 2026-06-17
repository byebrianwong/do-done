import React, { useCallback, useMemo, useRef } from 'react';
import type { RefreshControlProps } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';

import TaskItem from '@/components/TaskItem';
import SectionedDraggableList, {
  type DraggableSection,
} from '@/components/SectionedDraggableList';
import { invalidateTasks, reorderTasks, updateTask } from '@/lib/task-queries';
import { applyDisplay, isManualSort } from '@do-done/shared';
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
    case 'when_date':
      return { when_date: drop.value };
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
    const meta = new Map(groups.map((g) => [g.key, { color: g.color, drop: g.drop }]));
    return { sections, meta };
  }, [tasks, config, projects]);

  const metaRef = useRef(meta);
  metaRef.current = meta;
  const manualRef = useRef(isManualSort(config));
  manualRef.current = isManualSort(config);

  const onReorder = useCallback((_key: string, ids: string[]) => {
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
        <TaskItem task={task} onPress={onTaskPress} onDragHandle={drag} />
      </View>
    ),
    [onTaskPress]
  );

  return (
    <SectionedDraggableList
      sections={sections}
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
