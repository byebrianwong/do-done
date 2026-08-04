import React, { useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Ionicons } from '@expo/vector-icons';
import {
  PRIORITY_CONFIG,
  STATUS_CONFIG,
  TASK_COMPLETE_EXIT_MS,
  addDaysLocalISO,
  formatCompletedDate,
  formatDuration,
  formatTimeOfDay,
  todayLocalISO,
} from '@do-done/shared';
import type { Project, Task as SharedTask, UpdateTaskInput } from '@do-done/shared';
import { hapticLight, hapticMedium, hapticSuccess } from '@/lib/haptics';
import {
  createProject,
  deleteTask,
  toggleComplete,
  updateTask,
  useParentTask,
  useProjects,
} from '@/lib/task-queries';
import { useTaskSelection } from '@/lib/task-selection';
import {
  prefersReducedMotion,
  useCompletionExit,
  useOptimisticCompleted,
} from '@/lib/use-completion-exit';
import { LinkifiedText } from './LinkifiedText';
import { ProjectPickerSheet } from './ProjectPickerSheet';
import { useUndoToast } from './UndoToast';

export type Task = SharedTask;

interface TaskItemProps {
  task: Task;
  onPress?: (task: Task) => void;
  /** When provided, renders a drag handle that calls this to begin reordering. */
  onDragHandle?: () => void;
  /** Marks the row with a ⭐ — used by Today to flag focus-picked tasks. */
  focused?: boolean;
  /**
   * Set when this list keeps a task after it's completed (search results, or a
   * view with "show completed" on). Such a row must not play the
   * collapse-and-vanish exit — it would animate itself to nothing and then just
   * sit there invisible, since nothing ever unmounts it.
   *
   * Web expresses the same thing through a context (`lib/task-row-behavior`)
   * because its rows sit several components deep inside the sortable wrappers;
   * here every call site holds the row directly, so a prop is the whole story.
   */
  keepsCompleted?: boolean;
}

function buildReschedule(
  task: Task,
  target: { kind: 'date'; date: string } | { kind: 'remove' }
): UpdateTaskInput {
  if (target.kind === 'remove') {
    return {
      scheduled_date: null,
      deadline_date: null,
      deadline_time: null,
    };
  }
  const input: UpdateTaskInput = { scheduled_date: target.date };
  if (task.deadline_date && task.deadline_date < target.date) {
    input.deadline_date = target.date;
  }
  return input;
}

function TaskItem({
  task,
  onPress,
  onDragHandle,
  focused,
  keepsCompleted = false,
}: TaskItemProps) {
  const statusCfg = STATUS_CONFIG[task.status];
  const statusColor = statusCfg?.color ?? '#94a3b8';
  const priorityColor = PRIORITY_CONFIG[task.priority].color;
  const priorityLit = { p1: 4, p2: 3, p3: 2, p4: 1 }[task.priority];
  // Optimistic, because the list deliberately holds the row for the length of
  // the completion animation — the cache still says "not done" while the row is
  // busy showing that it is.
  const [completed, setCompleted] = useOptimisticCompleted(
    task.status === 'done'
  );
  const exit = useCompletionExit(task.status === 'done');
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const toast = useUndoToast();
  const swipeRef = useRef<SwipeableMethods | null>(null);

  // Multi-select: long-press enters selection mode and selects the row; while a
  // selection is active a tap toggles the row (instead of opening the editor)
  // and the leading circle becomes a selection checkbox.
  const selection = useTaskSelection();
  const selected = selection.isSelected(task.id);
  const selectionActive = selection.isActive;

  function handleRowPress() {
    if (selectionActive) {
      hapticLight();
      selection.toggle(task.id);
      return;
    }
    onPress?.(task);
  }

  function handleRowLongPress() {
    // Enter (or extend) selection mode. This replaces the single-task reschedule
    // menu — those actions now live on the bulk bar + swipe actions.
    hapticMedium();
    selection.toggle(task.id);
  }

  function handleLeadingPress() {
    if (selectionActive) {
      hapticLight();
      selection.toggle(task.id);
      return;
    }
    handleToggle();
  }

  // Projects come from the shared query cache (deduped across rows). The chip
  // only renders when this task has a project; adding one from scratch lives
  // in the edit modal, matching the web row.
  const { data: projects } = useProjects();
  const project = task.project_id
    ? (projects ?? []).find((p) => p.id === task.project_id) ?? null
    : null;

  // Subtask reference: resolve the parent so the row reads "↳ parent" and is
  // recognisable as a subtask wherever it appears in a list.
  const isSubtask = !!task.parent_task_id;
  const { data: parentTask } = useParentTask(task.parent_task_id);
  const parentTitle = parentTask?.title ?? null;

  function handleProjectSelect(projectId: string | null) {
    hapticLight();
    void updateTask(task.id, { project_id: projectId }).catch(() => {});
  }

  async function handleProjectCreate(
    name: string,
    color: string
  ): Promise<Project | null> {
    try {
      return await createProject({ name, color });
    } catch {
      return null;
    }
  }

  // All mutations flow through the shared query cache (lib/task-queries): each
  // fires an optimistic patch (the row vanishes from the relevant list
  // instantly), rolls back on error, and reconciles on settle. No local
  // optimistic state or onChange reload needed.

  function handleToggle() {
    const nextCompleted = !completed;
    if (nextCompleted) hapticSuccess();
    else hapticLight();

    // Paint first, on this frame: the check springs in and the row takes on its
    // completed styling before anything touches the network or the cache.
    setCompleted(nextCompleted);
    exit.setChecked(nextCompleted);

    // In a list that keeps completed tasks there is nothing to leave: the row
    // stays put wearing its completed styling, and the cache can drop it (from
    // whatever list it *is* leaving) immediately.
    const leaving = !keepsCompleted && !prefersReducedMotion();
    if (leaving) exit.start();

    // The write goes out now regardless; only the row's disappearance waits for
    // the animation.
    const holdMs = leaving ? TASK_COMPLETE_EXIT_MS : 0;
    void toggleComplete(task.id, nextCompleted, { holdMs }).catch(() => {
      // Write failed and the row is staying — put it back where it was.
      setCompleted(!nextCompleted);
      exit.setChecked(!nextCompleted);
      exit.cancel();
    });

    if (nextCompleted) {
      toast.show({
        message: `Completed “${task.title}”`,
        undo: () => void toggleComplete(task.id, false).catch(() => {}),
      });
    }
  }

  function applyTarget(target: Parameters<typeof buildReschedule>[1]) {
    hapticLight();
    void updateTask(task.id, buildReschedule(task, target)).catch(() => {});
  }

  function confirmDelete() {
    const run = () => {
      hapticMedium();
      void deleteTask(task.id).catch(() => {});
    };
    Alert.alert(
      'Delete task?',
      `“${task.title}” will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: run },
      ]
    );
  }

  // Swipe-right reveals a single complete/reopen action; a full swipe past the
  // threshold triggers it via onSwipeableWillOpen('left') below.
  const renderLeftActions = () => (
    <View style={[styles.swipeAction, styles.swipeLeftAction]}>
      <Ionicons
        name={completed ? 'arrow-undo' : 'checkmark-sharp'}
        size={22}
        color="#fff"
      />
      <Text style={styles.swipeActionText}>{completed ? 'Reopen' : 'Done'}</Text>
    </View>
  );

  // Swipe-left reveals tappable Today + Tomorrow + Delete buttons.
  const renderRightActions = () => (
    <View style={styles.swipeRightActions}>
      {!completed ? (
        <>
          <Pressable
            style={[styles.swipeAction, styles.swipeTodayAction]}
            onPress={() => {
              swipeRef.current?.close();
              applyTarget({ kind: 'date', date: todayLocalISO() });
            }}
          >
            <Ionicons name="today-outline" size={20} color="#fff" />
            <Text style={styles.swipeActionText}>Today</Text>
          </Pressable>
          <Pressable
            style={[styles.swipeAction, styles.swipeTomorrowAction]}
            onPress={() => {
              swipeRef.current?.close();
              applyTarget({ kind: 'date', date: addDaysLocalISO(1) });
            }}
          >
            <Ionicons name="arrow-forward-outline" size={20} color="#fff" />
            <Text style={styles.swipeActionText}>Tomorrow</Text>
          </Pressable>
        </>
      ) : null}
      <Pressable
        style={[styles.swipeAction, styles.swipeDeleteAction]}
        onPress={() => {
          swipeRef.current?.close();
          hapticMedium();
          confirmDelete();
        }}
      >
        <Ionicons name="trash-outline" size={20} color="#fff" />
        <Text style={styles.swipeActionText}>Delete</Text>
      </Pressable>
    </View>
  );

  const showStatus =
    task.status !== 'not_started' && task.status !== 'inbox';
  // The row stacks into two lines: the title gets its own line (up to two)
  // so it's never crowded out, and every secondary attribute wraps onto an
  // indented second line below it.
  const hasMeta = Boolean(
    task.duration_minutes ||
      task.recurrence_rule ||
      project ||
      showStatus ||
      completed ||
      task.scheduled_date ||
      task.deadline_date
  );

  return (
    // Collapse shell for the completion exit. The row shrinks its own height to
    // zero, so the rows below travel up on their own — DraggableFlatList never
    // has to know anything happened. `overflow: hidden` is what makes the
    // clamped height actually crop rather than just overlap.
    <Animated.View
      style={[exit.collapsing && styles.exitShell, exit.style]}
      onLayout={exit.onLayout}
    >
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      leftThreshold={72}
      rightThreshold={40}
      overshootLeft={false}
      overshootRight={false}
      // Swiping a row while multi-selecting is ambiguous — disable it so the
      // whole row is a selection target in selection mode.
      enabled={!selectionActive}
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}
      onSwipeableWillOpen={(direction) => {
        if (direction === 'left') {
          // Full swipe to the right toggles completion, then snaps closed.
          swipeRef.current?.close();
          handleToggle();
        }
      }}
    >
    <Pressable
      style={({ pressed }) => [
        styles.container,
        selected && styles.selectedRow,
        pressed && styles.pressed,
      ]}
      onPress={handleRowPress}
      onLongPress={handleRowLongPress}
      delayLongPress={350}
    >
      <Pressable
        onPress={handleLeadingPress}
        hitSlop={8}
        style={[
          styles.checkbox,
          selectionActive
            ? {
                borderRadius: 6,
                borderColor: selected ? '#6366f1' : '#cbd5e1',
                backgroundColor: selected ? '#6366f1' : 'transparent',
              }
            : {
                borderColor: completed ? '#d4d4d4' : statusColor,
                backgroundColor: completed ? '#d4d4d4' : 'transparent',
              },
        ]}
      >
        {/* The check is always mounted and scaled to nothing when the task is
            open, so ticking it off animates a transform instead of a mount — a
            view that appears has no "before" to spring from. Selection mode
            drives it directly; it's a state, not an event worth animating. */}
        {selectionActive ? (
          selected ? <Text style={styles.check}>✓</Text> : null
        ) : (
          <Animated.Text style={[styles.check, exit.checkStyle]}>✓</Animated.Text>
        )}
      </Pressable>
      <View style={styles.priorityBars}>
        {[0, 1, 2, 3].map((i) => {
          const lit = i < priorityLit;
          const h = 3 + i * 2;
          return (
            <View
              key={i}
              style={[
                styles.priorityBar,
                { height: h, backgroundColor: lit ? priorityColor : '#e5e7eb' },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.content}>
        {isSubtask ? (
          <View style={styles.subtaskRef}>
            <Ionicons name="return-down-forward" size={12} color="#9ca3af" />
            <Text style={styles.subtaskRefText} numberOfLines={1}>
              {parentTitle ?? 'Subtask'}
            </Text>
          </View>
        ) : null}
        <View style={styles.titleRow}>
          {focused && !completed ? (
            <Ionicons name="star" size={13} color="#f59e0b" />
          ) : null}
          <LinkifiedText
            text={task.title}
            style={[styles.title, completed && styles.titleDone]}
            numberOfLines={2}
          />
        </View>
        {hasMeta ? (
          <View style={styles.metaRow}>
            {task.duration_minutes ? (
              <View style={styles.metaChip}>
                <Text style={styles.metaChipLabel}>
                  ~{formatDuration(task.duration_minutes)}
                </Text>
              </View>
            ) : null}
            {task.recurrence_rule ? (
              <Ionicons name="repeat" size={13} color="#9ca3af" />
            ) : null}
            {project ? (
              <Pressable
                onPress={() => setProjectPickerOpen(true)}
                hitSlop={6}
                style={styles.projectChip}
              >
                <View
                  style={[styles.projectDot, { backgroundColor: project.color }]}
                />
                <Text style={styles.projectChipLabel} numberOfLines={1}>
                  {project.name}
                </Text>
              </Pressable>
            ) : null}
            {showStatus ? (
              <View
                style={[
                  styles.statusChip,
                  { backgroundColor: STATUS_CONFIG[task.status].color + '22' },
                ]}
              >
                <Text
                  style={[
                    styles.statusChipLabel,
                    { color: STATUS_CONFIG[task.status].color },
                  ]}
                >
                  {STATUS_CONFIG[task.status].label}
                </Text>
              </View>
            ) : null}
            {/* A completed task shows WHEN it was finished, not its (now
                irrelevant, usually "overdue") scheduled date. Falls back to
                "Today" until the optimistic completion settles and stamps
                completed_at. */}
            {completed ? (
              <Text style={styles.deadlineDate}>
                {task.completed_at ? formatCompletedDate(task.completed_at) : 'Today'}
              </Text>
            ) : task.scheduled_date ? (
              <Text style={styles.deadlineDate}>
                {formatTaskDate(task.scheduled_date)}
                {task.scheduled_time ? ` ${formatTimeOfDay(task.scheduled_time)}` : ''}
              </Text>
            ) : task.deadline_date ? (
              <Text style={styles.deadlineDate}>
                {formatTaskDate(task.deadline_date)}
                {task.deadline_time ? ` ${task.deadline_time}` : ''}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      {onDragHandle && !selectionActive ? (
        <Pressable
          onLongPress={() => {
            hapticMedium();
            onDragHandle();
          }}
          delayLongPress={150}
          hitSlop={8}
          style={styles.dragHandle}
        >
          <Ionicons name="reorder-three" size={22} color="#cbd5e1" />
        </Pressable>
      ) : null}
      <ProjectPickerSheet
        visible={projectPickerOpen}
        projects={projects ?? []}
        selectedId={task.project_id}
        onSelect={handleProjectSelect}
        onClose={() => setProjectPickerOpen(false)}
        onCreate={handleProjectCreate}
      />
    </Pressable>
    </ReanimatedSwipeable>
    </Animated.View>
  );
}

export default React.memo(TaskItem);

function formatTaskDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.getTime() === today.getTime()) return 'Today';
  if (date.getTime() === tomorrow.getTime()) return 'Tomorrow';
  if (date < today) return 'Overdue';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  // Crops the row as the completion collapse clamps its height; without this
  // the content just overlaps the row below instead of appearing to leave.
  // Applied only while collapsing — see `CompletionExit.collapsing`.
  exitShell: { overflow: 'hidden' as const },
  container: {
    flexDirection: 'row',
    // Top-align so the checkbox + priority bars sit on the title's first
    // line when the row grows to two lines.
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  pressed: { backgroundColor: '#f9fafb' },
  selectedRow: { backgroundColor: '#eef2ff' },
  swipeAction: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 16,
  },
  swipeActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  swipeLeftAction: {
    width: 96,
    backgroundColor: '#16a34a',
  },
  swipeRightActions: {
    flexDirection: 'row',
  },
  swipeTodayAction: {
    width: 80,
    backgroundColor: '#6366f1',
  },
  swipeTomorrowAction: {
    width: 92,
    backgroundColor: '#f59e0b',
  },
  swipeDeleteAction: {
    width: 80,
    backgroundColor: '#dc2626',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: { color: '#fff', fontSize: 13, fontWeight: '700' },
  priorityBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    marginRight: 10,
    // Nudge down to center the short bars on the title's first line.
    marginTop: 4,
    width: 18,
    height: 14,
  },
  priorityBar: {
    width: 3,
    borderRadius: 1,
  },
  content: {
    flex: 1,
    flexDirection: 'column',
    gap: 3,
  },
  subtaskRef: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginBottom: 1,
  },
  subtaskRefText: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: '500',
    flexShrink: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  title: { fontSize: 16, lineHeight: 22, color: '#111827', flex: 1 },
  titleDone: { color: '#9ca3af', textDecorationLine: 'line-through' },
  deadlineDate: { fontSize: 13, color: '#6b7280' },
  dragHandle: {
    paddingHorizontal: 6,
    paddingVertical: 8,
    marginLeft: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaChip: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  metaChipLabel: {
    fontSize: 10,
    color: '#6b7280',
    fontWeight: '600',
  },
  projectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 120,
  },
  projectDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  projectChipLabel: {
    fontSize: 12,
    color: '#6b7280',
    flexShrink: 1,
  },
  statusChip: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  statusChipLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
