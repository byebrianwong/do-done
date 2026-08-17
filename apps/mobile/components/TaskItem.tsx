import React, { useEffect, useRef } from 'react';
import {
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
  OVERDUE_COLOR,
  PRIORITY_CONFIG,
  TASK_COMPLETE_EXIT_MS,
  TASK_DELETE_EXIT_MS,
  addDaysLocalISO,
  shouldSpark,
  rowEstimate,
  rowGutter,
  rowSubline,
  todayLocalISO,
} from '@do-done/shared';
import type { Task as SharedTask, UpdateTaskInput } from '@do-done/shared';
import { hapticLight, hapticMedium, hapticSuccess } from '@/lib/haptics';
import { claimStreakDay } from '@/lib/completion-streak';
import {
  ROW_DRAG_HOLD_MS,
  rowLongPressAction,
  rowTapAction,
} from '@/lib/row-gesture';
import {
  SWIPE_RETURN_MS,
  SWIPE_RETURN_SPRING,
  panelForSwipe,
} from '@/lib/swipe-actions';
import {
  deleteTask,
  restoreTasks,
  toggleComplete,
  updateTask,
  useParentTask,
  useProjects,
} from '@/lib/task-queries';
import { useTaskSelection } from '@/lib/task-selection';
import {
  prefersReducedMotion,
  useRowExit,
  useOptimisticCompleted,
} from '@/lib/use-row-exit';
import { CompletionSpark } from './CompletionSpark';
import { StruckText } from './StruckText';
import { useUndoToast } from './UndoToast';
import { ProjectIcon } from '@/components/ProjectIcon';

export type Task = SharedTask;

/**
 * The row has exactly two coloured slots, and each carries one variable.
 *
 * The **ring** is identity: the project's colour, and its emoji when it has
 * one. Hue is a nominal channel — it says which, not how much — so it fits a
 * project, a label with no ordering, natively.
 *
 * The **gutter** is urgency: a red dot when the task is late, then a bar whose
 * length falls with the rank. Priority is ordinal, so it is drawn with position
 * and length instead of hue. P4 renders nothing on purpose — it is the column
 * default, so it marks the tasks nobody triaged, and a mark that appears on
 * every row has stopped saying anything.
 *
 * Only the geometry is local here: the colours come from the shared
 * `PRIORITY_CONFIG`, so this column can never disagree with the picker that
 * sets it or with the same row drawn on web and on the home screen.
 *
 * Everything else that used to be a chip is one muted line of prose under the
 * title (`rowSubline`), where an unset field takes no space at all.
 */
const GUTTER_STYLE = {
  overdue: { color: OVERDUE_COLOR, size: 7, dot: true },
  p1: { color: PRIORITY_CONFIG.p1.color, size: 16, dot: false },
  p2: { color: PRIORITY_CONFIG.p2.color, size: 10, dot: false },
  p3: { color: PRIORITY_CONFIG.p3.color, size: 6, dot: false },
} as const;

/** The ring for a task with no project: chosen, not a missing value. */
const NO_PROJECT_COLOR = '#94a3b8';

/** Struck-out title, and the rule drawn through it — one colour, named once. */
const TITLE_DONE_COLOR = '#9ca3af';

interface TaskItemProps {
  task: Task;
  onPress?: (task: Task) => void;
  /**
   * When provided, the list can reorder and a long press on the row begins the
   * drag. There is no handle: see `lib/row-gesture.ts` for why the hold belongs
   * to this rather than to selection.
   */
  onDragStart?: () => void;
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
  /**
   * Drop the project from the subline — for a list already grouped by project,
   * where the header has just said it.
   */
  hideProject?: boolean;
  /**
   * The same for the scheduled day: set it where the surface has already named
   * the day this row is on — a section header reading "Tomorrow", or the Today
   * screen. Everywhere else a row prints its own day, "Today" included, since
   * that is the one a list most needs to point out.
   */
  hideScheduledDay?: boolean;
  /**
   * Open tasks in this row's section, **including this one**, as it stood
   * before the tap. One means completing this empties the section, which earns
   * the celebratory burst. Omitted on surfaces with no sections (the inbox,
   * search), where that rule simply can't fire.
   */
  openInSection?: number | null;
  /** The same for the row's project. One means this completion finishes it. */
  openInProject?: number | null;
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
  onDragStart,
  focused,
  keepsCompleted = false,
  hideProject = false,
  hideScheduledDay = false,
  openInSection = null,
  openInProject = null,
}: TaskItemProps) {
  // Optimistic, because the list deliberately holds the row for the length of
  // the completion animation — the cache still says "not done" while the row is
  // busy showing that it is.
  const [completed, setCompleted] = useOptimisticCompleted(
    task.status === 'done'
  );
  const exit = useRowExit(task.status === 'done');
  const toast = useUndoToast();
  const swipeRef = useRef<SwipeableMethods | null>(null);
  // A completion the swipe has asked for and the row's journey home hasn't
  // finished paying for yet — see `completeAfterReturn`.
  const returnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (returnTimer.current) clearTimeout(returnTimer.current);
    },
    []
  );

  // Multi-select is an explicit mode, armed from the list's ⋯ menu rather than
  // by holding a row. While it is armed a tap toggles the row (instead of
  // opening the editor) and the leading ring becomes a selection checkbox.
  const selection = useTaskSelection();
  const selected = selection.isSelected(task.id);
  const selectionActive = selection.isActive;

  // The hold reorders. Both decisions live in `lib/row-gesture.ts` so the rule
  // is written down once and can be tested — there is no renderer here.
  const longPress = rowLongPressAction({
    selecting: selectionActive,
    draggable: !!onDragStart,
  });

  function handleRowPress() {
    if (rowTapAction({ selecting: selectionActive }) === 'toggle-selection') {
      hapticLight();
      selection.toggle(task.id);
      return;
    }
    onPress?.(task);
  }

  function handleRowLongPress() {
    if (longPress !== 'drag') return;
    // The tick that tells the user the row is now theirs to move — the lift
    // itself is the only other feedback the gesture gives.
    hapticMedium();
    onDragStart?.();
  }

  function handleLeadingPress() {
    if (selectionActive) {
      hapticLight();
      selection.toggle(task.id);
      return;
    }
    handleToggle();
  }

  // Projects come from the shared query cache (deduped across rows). The ring
  // takes the project's colour and emoji; a task with no project keeps a
  // neutral ring rather than looking broken.
  const { data: projects } = useProjects();
  const project = task.project_id
    ? (projects ?? []).find((p) => p.id === task.project_id) ?? null
    : null;
  const ringColor = project?.color ?? NO_PROJECT_COLOR;

  // Subtask reference: resolve the parent so the row reads "↳ parent" and is
  // recognisable as a subtask wherever it appears in a list.
  const isSubtask = !!task.parent_task_id;
  const { data: parentTask } = useParentTask(task.parent_task_id);
  const parentTitle = parentTask?.title ?? null;

  // All mutations flow through the shared query cache (lib/task-queries): each
  // fires an optimistic patch (the row vanishes from the relevant list
  // instantly), rolls back on error, and reconciles on settle. No local
  // optimistic state or onChange reload needed.

  /**
   * Tick the task off once the row has sprung back to where it was.
   *
   * A swipe that passes the threshold has two things to say and they are
   * sequential: the row is let go of, and *then* the task is done. Firing both
   * on the release frame is what made the return read as a snap — by the time
   * the eye had followed the row home the check had already sprung, the halo
   * had rung out and the strike-through was drawn, so the travel looked like
   * the row catching up with something that had already happened rather than
   * the gesture completing.
   *
   * A timer rather than the library's `onSwipeableClose`: that fires when the
   * spring is *numerically* at rest, which is later than the frame the row
   * visibly lands on, and never at all if anything interrupts it — a swipe that
   * silently failed to complete the task is much worse than one that completes
   * it a frame early. {@link SWIPE_RETURN_MS} is derived from the spring
   * instead, in `swipe-actions.ts`.
   */
  function completeAfterReturn() {
    // Reduce motion has no travel to wait for: the row is already home.
    if (prefersReducedMotion()) {
      handleToggle();
      return;
    }
    if (returnTimer.current) clearTimeout(returnTimer.current);
    returnTimer.current = setTimeout(() => {
      returnTimer.current = null;
      handleToggle();
    }, SWIPE_RETURN_MS);
  }

  function handleToggle() {
    // Whatever asked for this is the one that gets it. Without this a ring tap
    // during the return would tick the task off and the pending swipe would
    // then untick it.
    if (returnTimer.current) {
      clearTimeout(returnTimer.current);
      returnTimer.current = null;
    }
    const nextCompleted = !completed;
    if (nextCompleted) hapticSuccess();
    else hapticLight();

    // Paint first, on this frame: the check springs in, the ring flinches and
    // rings out, and the strike-through starts drawing — all before anything
    // touches the network or the cache.
    setCompleted(nextCompleted);
    exit.setChecked(nextCompleted);
    // Only on the way in. Reopening is a correction, not an achievement.
    if (nextCompleted) {
      exit.punch();
      // Claimed unconditionally: *any* completion starts today, including one
      // that would have sparked for another reason. Asking only when the other
      // rules missed would let a second completion moments later claim the
      // same day again.
      //
      // Unconditional within the task universe, that is. Buying milk must not
      // hold a run of working days alive — and unlike the burst, which
      // `sparkReason` gates internally, claiming has a side effect, so the
      // list item has to be turned away before the call rather than after it.
      const streakDay = task.is_list_item ? false : claimStreakDay();
      // …and the burst on top, for the completions that earned one. Read now,
      // not at render time: by the time the write lands the row has already
      // told its list it is done.
      if (shouldSpark(task, { openInSection, openInProject, streakDay })) {
        exit.spark();
      }
    }

    // In a list that keeps completed tasks there is nothing to leave: the row
    // stays put wearing its completed styling, and the cache can drop it (from
    // whatever list it *is* leaving) immediately.
    const leaving = !keepsCompleted && !prefersReducedMotion();
    if (leaving) exit.start();

    // The write goes out now regardless; only the row's disappearance waits for
    // the animation.
    const holdMs = leaving ? TASK_COMPLETE_EXIT_MS : 0;
    void toggleComplete(task.id, nextCompleted, { holdMs })
      .then(() => {
        // The toast is the row's receipt, so it waits for the write to land.
        // Announcing the completion up front meant an offline tap put
        // "Completed" on screen beside a row that had just snapped back — and
        // handed the user an Undo for something that never happened. Nothing is
        // lost by waiting: the hold keeps the row on screen until this resolves,
        // so the toast still arrives as the row leaves.
        if (nextCompleted) {
          toast.show({ message: `Completed “${task.title}”`, undo: undoComplete });
        }
      })
      .catch(() => {
        // Write failed and the row is staying — put it back where it was.
        setCompleted(!nextCompleted);
        exit.setChecked(!nextCompleted);
        exit.cancel();
      });
  }

  /**
   * Undo for the completion toast. The reopen is queued behind the completion
   * it undoes (see `toggleComplete`), so tapping this the instant the toast
   * appears can't have the two writes land out of order.
   *
   * `task.status` is the row as it stood before the tap — the cache drops the
   * completed row rather than restating it — so the task comes back at the
   * status it actually had, In progress included.
   */
  async function undoComplete() {
    try {
      await toggleComplete(task.id, false, { restoreStatus: task.status });
      setCompleted(false);
      exit.setChecked(false);
      exit.cancel();
    } catch {
      // Say so. A silent failure here reads as a dead button — the user taps
      // Undo, the task stays gone, and nothing tells them why.
      toast.show({
        message: `Couldn't undo — “${task.title}” is still completed.`,
      });
    }
  }

  /**
   * Reschedule from the swipe panel's Today / Tomorrow buttons.
   *
   * A failure has to say so. The row leaves the list the instant the button is
   * tapped — that is the whole feedback the gesture gives — so a write that
   * doesn't land looks exactly like one that did until the list is next looked
   * at from somewhere else. `.catch(() => {})` was doing that silently, which
   * is what let a reschedule that never sent anything at all pass for working;
   * `updateTask` puts the row back, and this says why it came back.
   */
  function applyTarget(target: Parameters<typeof buildReschedule>[1]) {
    hapticLight();
    void updateTask(task.id, buildReschedule(task, target)).catch(() => {
      toast.show({ message: `Couldn't reschedule “${task.title}”` });
    });
  }

  /**
   * Delete the task, with no confirmation and a real way back.
   *
   * The dialog that used to stand here existed for one stated reason: the
   * delete was a hard delete, so there was no row left to offer back and
   * nothing an Undo could have done. That is no longer true — the row survives
   * and `restoreTasks` gives back *this* task, its subtasks and its files — so
   * the dialog would now be a second question about something the toast can
   * simply take back. Asking first and offering an undo afterwards is asking
   * twice.
   */
  function handleDelete() {
    hapticMedium();
    // Paint first, the same way completing does: the row dims where it stands,
    // then closes leftward, and the cache patch that drops it waits out that
    // envelope. Before this the optimistic patch fired on the same tick as the
    // tap, so the row simply stopped existing.
    const animating = !prefersReducedMotion();
    if (animating) exit.startDelete();
    void deleteTask(task.id, { holdMs: animating ? TASK_DELETE_EXIT_MS : 0 })
      .then((ids) => {
        // The toast is the row's receipt, so it waits for the write — the same
        // rule completion follows. Announcing up front would hand the user an
        // Undo for something that never happened.
        toast.show({
          message: `Deleted “${task.title}”`,
          undo: async () => {
            try {
              await restoreTasks(ids);
            } catch {
              toast.show({
                message: `Couldn't bring “${task.title}” back`,
              });
            }
          },
        });
      })
      .catch(() => {
        // The row is staying — put it back where it was.
        exit.cancel();
        toast.show({ message: `Couldn't delete “${task.title}”` });
      });
  }

  // Swipe-right reveals a single complete/reopen action; a full swipe past the
  // threshold sends the row home and ticks the task off as it lands — see
  // `onSwipeableWillOpen` below.
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
          handleDelete();
        }}
      >
        <Ionicons name="trash-outline" size={20} color="#fff" />
        <Text style={styles.swipeActionText}>Delete</Text>
      </Pressable>
    </View>
  );

  // What the row actually says, decided in @do-done/shared so the strings can
  // be tested — apps/mobile has no renderer to test a component with.
  const gutter = completed ? null : rowGutter(task);
  const subline = rowSubline(task, {
    projectName: hideProject ? null : project?.name ?? null,
    hideScheduledDay,
  }).join(' · ');
  const estimate = completed ? '' : rowEstimate(task);

  return (
    // Collapse shell for the row's exit. The row shrinks its own height to
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
      // The row travels on a spring you can see, rather than the library's
      // default — which Reanimated integrates as critically damped and which
      // therefore has no deceleration to read at all. See `swipe-actions.ts`.
      animationOptions={SWIPE_RETURN_SPRING}
      // Swiping a row while multi-selecting is ambiguous — disable it so the
      // whole row is a selection target in selection mode.
      enabled={!selectionActive}
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}
      onSwipeableWillOpen={(direction) => {
        // `direction` is the direction of the *gesture*, not the panel that
        // opened — see lib/swipe-actions. Swiping right reveals the single
        // Done/Reopen action, which the row plays on its own and then closes;
        // swiping left opens the Today / Tomorrow / Delete buttons and waits to
        // be tapped.
        if (panelForSwipe(direction) === 'complete') {
          // Turn the row around on the frame the finger leaves it: the open
          // this event announces has barely started, so the row springs back
          // from where it was let go rather than from the panel's full width.
          swipeRef.current?.close();
          completeAfterReturn();
        }
      }}
    >
    <Pressable
      style={({ pressed }) => [
        styles.container,
        selected && styles.selectedRow,
        pressed && styles.pressed,
        // Outranks selection and the press both — a row that is going has
        // nothing useful left to say about being picked or held, and this is
        // the only moment red means "leaving" rather than "overdue".
        exit.deleting && styles.deletingRow,
      ]}
      onPress={handleRowPress}
      // Undefined rather than a no-op when there is nothing to hold for: a
      // Pressable with an `onLongPress` swallows the press that would otherwise
      // have fired `onPress`, so a list that can't reorder would eat a slow tap.
      onLongPress={longPress === 'drag' ? handleRowLongPress : undefined}
      delayLongPress={ROW_DRAG_HOLD_MS}
    >
      {/* The urgency column. Always the same width, so nothing shifts when a
          task stops being late — and empty on the great majority of rows. */}
      <View style={styles.gutter}>
        {gutter ? (
          <View
            style={{
              backgroundColor: GUTTER_STYLE[gutter].color,
              height: GUTTER_STYLE[gutter].size,
              width: GUTTER_STYLE[gutter].dot ? 7 : 3,
              borderRadius: GUTTER_STYLE[gutter].dot ? 4 : 2,
            }}
          />
        ) : null}
      </View>
      {/* The press target keeps the spacing; the ring inside it does the
          moving, so squashing it can't shift the title beside it. */}
      <Pressable onPress={handleLeadingPress} hitSlop={8} style={styles.ringSlot}>
        {/* A hairline copy of the ring, expanding out of it and dissolving.
            Behind the ring and outside its bounds, so it reads as something the
            completion sent outwards rather than a border that grew. */}
        {!selectionActive ? (
          <Animated.View
            style={[styles.halo, { borderColor: ringColor }, exit.haloStyle]}
            pointerEvents="none"
          />
        ) : null}
        {/* Mounted only for the frames it is in the air — see `exit.spark`. */}
        {exit.sparking ? (
          <CompletionSpark progress={exit.sparkProgress} color={ringColor} />
        ) : null}
        <Animated.View
          style={[
            styles.ring,
            selectionActive
              ? {
                  borderRadius: 6,
                  borderColor: selected ? '#6366f1' : '#cbd5e1',
                  backgroundColor: selected ? '#6366f1' : 'transparent',
                }
              : {
                  borderColor: ringColor,
                  // Completion fills with the project's colour, the same way for
                  // every priority: done is a state, not a rank.
                  backgroundColor: completed ? ringColor : 'transparent',
                },
            // Selection is a state, not an event — only the completion punch
            // animates the ring.
            selectionActive ? null : exit.ringStyle,
          ]}
        >
          {/* The project's emoji holds the ring until the task is done, when the
              check takes the space. The check is always mounted and scaled to
              nothing while the task is open, so ticking it off animates a
              transform instead of a mount — a view that appears has no "before"
              to spring from. Selection mode drives it directly; it's a state,
              not an event worth animating. */}
          {selectionActive ? (
            selected ? <Text style={styles.check}>✓</Text> : null
          ) : (
            <>
              {project?.icon && !completed ? (
                <ProjectIcon icon={project.icon} size={11} color={ringColor} />
              ) : null}
              <Animated.Text
                style={[styles.check, styles.ringCheck, exit.checkStyle]}
              >
                ✓
              </Animated.Text>
            </>
          )}
        </Animated.View>
      </Pressable>
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
          {/* The strike-through is drawn rather than switched on — see
              `StruckText` for why mobile has to draw the rule itself. */}
          <StruckText
            text={task.title}
            struck={completed}
            strikeColor={TITLE_DONE_COLOR}
            style={[
              styles.title,
              // Being late is said in weight as well as in the gutter, so it
              // reads from further away than a coloured chip ever did.
              gutter === 'overdue' && styles.titleOverdue,
              completed && styles.titleDone,
            ]}
            numberOfLines={2}
          />
        </View>
        {subline ? (
          <Text style={styles.subline} numberOfLines={1}>
            {subline}
          </Text>
        ) : null}
      </View>

      {/* One right-aligned figure, in tabular digits, so a day's estimates
          form a column you can add up by eye. */}
      {estimate ? <Text style={styles.estimate}>{estimate}</Text> : null}
    </Pressable>
    </ReanimatedSwipeable>
    </Animated.View>
  );
}

export default React.memo(TaskItem);

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
    paddingVertical: 11,
    paddingLeft: 8,
    paddingRight: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  pressed: { backgroundColor: '#f9fafb' },
  selectedRow: { backgroundColor: '#eef2ff' },
  // Held to a tint: the row still has to be readable while it is condemned,
  // because reading it is what the hold is for. red-50.
  deletingRow: { backgroundColor: '#fef2f2' },
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
  gutter: {
    width: 10,
    // A fixed 22px band so the mark lines up with the ring on the title's
    // first line, and nothing shifts when a task stops being late.
    height: 22,
    marginRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Spacing lives out here so the ring's squash can't nudge the title.
  ringSlot: {
    marginRight: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    opacity: 0,
  },
  ringEmoji: { fontSize: 10, lineHeight: 12 },
  // Both are centred in the same 22px circle and only one is ever visible, so
  // the check is taken out of flow rather than laid out beside the emoji.
  ringCheck: { position: 'absolute' },
  check: { color: '#fff', fontSize: 13, fontWeight: '700' },
  content: {
    flex: 1,
    flexDirection: 'column',
    gap: 2,
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
  // No `flex: 1` here. This style is handed to `StruckText`, which wraps the
  // text in a View of its own — a *column* container — so `flex: 1` stops
  // meaning "fill the row" and starts meaning `flexBasis: 0` on the vertical
  // axis, collapsing the title to height 0. Filling the row is `StruckText`'s
  // root's job, and it does it. (This was left behind when the title stopped
  // being a bare Text directly inside `titleRow`; every row without a second
  // element in that row — i.e. every row without a ★ — rendered no title at
  // all, on every screen.)
  title: { fontSize: 15, lineHeight: 20, color: '#111827' },
  titleOverdue: { fontWeight: '600' },
  // No `textDecorationLine` — the rule is drawn by `StruckText` so it can be
  // animated, which the platform's own decoration cannot be.
  titleDone: { color: TITLE_DONE_COLOR },
  subline: { fontSize: 12, lineHeight: 16, color: '#9ca3af' },
  estimate: {
    fontSize: 12,
    lineHeight: 20,
    color: '#9ca3af',
    marginLeft: 10,
    minWidth: 32,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  // Sentence case, matching web and every other label on the row. The status
  // was the one chip shouting, and upper-casing made the longest one
  // ("In progress") half again as wide for no added meaning.
});
