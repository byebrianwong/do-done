import React, { useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Ionicons } from '@expo/vector-icons';
import {
  PRIORITY_CONFIG,
  STATUS_CONFIG,
  addDaysLocalISO,
  formatCompletedDate,
  formatDuration,
  formatWhenTime,
  resolveQuickSchedule,
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
}

function buildReschedule(
  task: Task,
  target: { kind: 'date'; date: string } | { kind: 'remove' }
): UpdateTaskInput {
  if (target.kind === 'remove') {
    return {
      when_date: null,
      due_date: null,
      due_time: null,
    };
  }
  const input: UpdateTaskInput = { when_date: target.date };
  if (task.due_date && task.due_date < target.date) {
    input.due_date = target.date;
  }
  return input;
}

function TaskItem({ task, onPress, onDragHandle, focused }: TaskItemProps) {
  const statusCfg = STATUS_CONFIG[task.status];
  const statusColor = statusCfg?.color ?? '#94a3b8';
  const priorityColor = PRIORITY_CONFIG[task.priority].color;
  const priorityLit = { p1: 4, p2: 3, p3: 2, p4: 1 }[task.priority];
  const completed = task.status === 'done';
  const [menuOpen, setMenuOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const toast = useUndoToast();
  const swipeRef = useRef<SwipeableMethods | null>(null);

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
    void toggleComplete(task.id, nextCompleted).catch(() => {});
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

  const rescheduleActions: {
    label: string;
    run: () => void;
    destructive?: boolean;
  }[] = [
    { label: 'Move to Today', run: () => applyTarget({ kind: 'date', date: todayLocalISO() }) },
    { label: 'Move to Tomorrow', run: () => applyTarget({ kind: 'date', date: addDaysLocalISO(1) }) },
    { label: 'Move to This week', run: () => applyTarget({ kind: 'date', date: resolveQuickSchedule('this_week') }) },
    { label: 'Remove dates', run: () => applyTarget({ kind: 'remove' }) },
    { label: 'Delete', run: confirmDelete, destructive: true },
  ];

  function openLongPressMenu() {
    if (Platform.OS === 'ios') {
      const labels = [...rescheduleActions.map((a) => a.label), 'Cancel'];
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: labels,
          cancelButtonIndex: labels.length - 1,
          destructiveButtonIndex: rescheduleActions.findIndex(
            (a) => a.destructive
          ),
          title: task.title,
        },
        (i) => {
          if (i < rescheduleActions.length) rescheduleActions[i].run();
        }
      );
      return;
    }
    // Android: a native Alert with >3 buttons renders malformed and can't be
    // reliably dismissed, so present a custom bottom sheet instead.
    setMenuOpen(true);
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
      task.when_date ||
      task.due_date
  );

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      leftThreshold={72}
      rightThreshold={40}
      overshootLeft={false}
      overshootRight={false}
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
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={() => onPress?.(task)}
      onLongPress={openLongPressMenu}
      delayLongPress={350}
    >
      <Pressable
        onPress={handleToggle}
        hitSlop={8}
        style={[
          styles.checkbox,
          {
            borderColor: completed ? '#d4d4d4' : statusColor,
            backgroundColor: completed ? '#d4d4d4' : 'transparent',
          },
        ]}
      >
        {completed ? <Text style={styles.check}>✓</Text> : null}
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
          <Text
            style={[styles.title, completed && styles.titleDone]}
            numberOfLines={2}
          >
            {task.title}
          </Text>
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
              <Text style={styles.dueDate}>
                {task.completed_at ? formatCompletedDate(task.completed_at) : 'Today'}
              </Text>
            ) : task.when_date ? (
              <Text style={styles.dueDate}>
                {formatDueDate(task.when_date)}
                {task.when_time ? ` ${formatWhenTime(task.when_time)}` : ''}
              </Text>
            ) : task.due_date ? (
              <Text style={styles.dueDate}>
                {formatDueDate(task.due_date)}
                {task.due_time ? ` ${task.due_time}` : ''}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      {onDragHandle ? (
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
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable
          style={styles.menuBackdrop}
          onPress={() => setMenuOpen(false)}
        >
          <Pressable style={styles.menuSheet} onPress={() => {}}>
            <Text style={styles.menuTitle} numberOfLines={1}>
              {task.title}
            </Text>
            {rescheduleActions.map((a) => (
              <Pressable
                key={a.label}
                style={styles.menuRow}
                onPress={() => {
                  setMenuOpen(false);
                  a.run();
                }}
              >
                <Text
                  style={[
                    styles.menuRowText,
                    a.destructive && styles.menuRowDestructive,
                  ]}
                >
                  {a.label}
                </Text>
              </Pressable>
            ))}
            <Pressable
              style={[styles.menuRow, styles.menuCancel]}
              onPress={() => setMenuOpen(false)}
            >
              <Text style={styles.menuCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
  );
}

export default React.memo(TaskItem);

function formatDueDate(dateStr: string): string {
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
  dueDate: { fontSize: 13, color: '#6b7280' },
  dragHandle: {
    paddingHorizontal: 6,
    paddingVertical: 8,
    marginLeft: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 14,
    paddingBottom: 28,
    paddingHorizontal: 16,
  },
  menuTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  menuRow: {
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  menuRowText: { fontSize: 16, color: '#111827', fontWeight: '500' },
  menuRowDestructive: { color: '#dc2626' },
  menuCancel: {
    marginTop: 6,
    backgroundColor: '#f9fafb',
    alignItems: 'center',
  },
  menuCancelText: { fontSize: 16, color: '#6b7280', fontWeight: '600' },
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
