import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { BaseButton } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import {
  TASK_COMPLETE_EXIT_MS,
  TASK_DELETE_EXIT_MS,
  aisleRing,
  itemSubline,
  type Aisle,
  type Task,
} from '@do-done/shared';

import { hapticLight, hapticMedium, hapticSuccess } from '@/lib/haptics';
import { deleteTask, restoreTasks, toggleComplete } from '@/lib/task-queries';
import {
  prefersReducedMotion,
  useOptimisticCompleted,
  useRowExit,
} from '@/lib/use-row-exit';
import { SWIPE_RETURN_MS, SWIPE_RETURN_SPRING, panelForSwipe } from '@/lib/swipe-actions';
import { ProjectIcon } from '@/components/ProjectIcon';
import { StruckText } from '@/components/StruckText';
import { useUndoToast } from '@/components/UndoToast';

/**
 * One thing to buy.
 *
 * An item is a task, so ticking it off is the same gesture ticking a task off
 * is — the ring flinches and fills, a halo rings out, the title is struck
 * through, and the row holds at full height before collapsing into the cart.
 * All of it comes from the same `useRowExit` and the same constants in
 * `@do-done/shared` that `TaskItem` uses, which is what stops the most repeated
 * action in the app behaving differently depending on which screen it is on.
 * Before this the row simply changed section after a network round trip, with
 * no animation, no haptic and no way back.
 *
 * Not `TaskItem` itself, for the reason the screen is not `GroupedTaskList`:
 * that row spends its width on an urgency gutter, a project ring, a focus star
 * and a subtask breadcrumb, none of which a shopping item has. What is shared
 * is the behaviour, not the layout.
 *
 * **The ring is coloured by aisle, not by project.** On a task the ring carries
 * the project, which is the thing that differs down a list. Every item on one
 * shopping list has the *same* project, so drawing it would paint the screen one
 * colour and say nothing. See `aisleRing` in `@do-done/shared`.
 */
export function ListItemRow({
  item,
  aisle,
  onOpen,
  onCorrect,
  onToggled,
}: {
  item: Task;
  /** Where this item was filed. Null for the trailing "Other" group. */
  aisle: Aisle | null;
  /** Tap on the words: the full editor. */
  onOpen: () => void;
  /** Long press: the aisle / store correction sheet. */
  onCorrect: () => void;
  /** Ticking writes to the pantry, so the drawer has to reload. */
  onToggled: () => void;
}) {
  // Optimistic, because the row deliberately stays mounted for the length of
  // the completion animation — the cache still says "to buy" while the row is
  // busy showing that it has been bought.
  const [completed, setCompleted] = useOptimisticCompleted(
    item.status === 'done' || item.status === 'cancelled'
  );
  const exit = useRowExit(completed);
  const toast = useUndoToast();
  const swipeRef = useRef<SwipeableMethods | null>(null);
  // A completion the swipe has asked for and the row's journey home hasn't
  // finished paying for yet — see `completeAfterReturn` on the task row.
  const returnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (returnTimer.current) clearTimeout(returnTimer.current);
    },
    []
  );

  const ring = aisleRing(aisle);
  // The store and the day as one muted line, the same shape `rowSubline` gives
  // every other row in the app. Empty for most items, so nothing renders.
  const subline = itemSubline(item).join(' · ');

  /**
   * Tick the item off once the row has sprung back to where it was.
   *
   * The same rule the task row follows: a swipe past the threshold says two
   * things and they are sequential — the row is let go of, and *then* it is
   * bought. Firing both on the release frame makes the travel read as the row
   * catching up with something that already happened.
   */
  function completeAfterReturn() {
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
    // Whatever asked for this is the one that gets it: a ring tap during the
    // swipe's return must not be undone by the swipe that was still owed.
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
    // Only on the way in. Un-ticking is a correction, not an achievement.
    //
    // The halo rings, and nothing else does: `sparkReason` returns null for a
    // list item on purpose, because the last thing in the basket is the last
    // thing in *every* basket, forever — see *Shopping lists* in CLAUDE.md. The
    // streak is not claimed here either. Buying milk must not hold a run of
    // working days alive.
    if (nextCompleted) exit.punch();

    // The row leaves the section it is in either way — a bought item moves to
    // "Got it", an un-ticked one moves back to its aisle — so it collapses in
    // both directions, and `toggleComplete` patches its status into the list
    // cache once the animation is spent.
    const leaving = !prefersReducedMotion();
    if (leaving) exit.start();

    const holdMs = leaving ? TASK_COMPLETE_EXIT_MS : 0;
    void toggleComplete(item.id, nextCompleted, { holdMs })
      .then(() => {
        // The toast is the row's receipt, so it waits for the write to land.
        // Announcing up front means an offline tap puts "Bought" on screen
        // beside a row that just snapped back, and hands the user an Undo for
        // something that never happened.
        if (nextCompleted) {
          toast.show({ message: `Bought “${item.title}”`, undo: undoComplete });
        }
      })
      .catch(() => {
        // Write failed and the row is staying — put it back where it was.
        setCompleted(!nextCompleted);
        exit.setChecked(!nextCompleted);
        exit.cancel();
      })
      // The pantry is written inside `TasksApi.update`, so the drawer has to
      // reload either way: on success because a gap was just recorded, on
      // failure because nothing was and the cache must stop claiming it was.
      .finally(onToggled);
  }

  /**
   * Undo for the completion toast. The un-tick is queued behind the completion
   * it undoes (see `toggleComplete`), so tapping this the instant the toast
   * appears can't have the two writes land out of order.
   */
  async function undoComplete() {
    try {
      await toggleComplete(item.id, false, { restoreStatus: item.status });
      setCompleted(false);
      exit.setChecked(false);
      exit.cancel();
      onToggled();
    } catch {
      // Say so. A silent failure here reads as a dead button.
      toast.show({
        message: `Couldn't undo — “${item.title}” is still bought.`,
      });
    }
  }

  /**
   * Delete the item, with no confirmation and a real way back.
   *
   * Distinct from "Put away", which soft-deletes everything in the cart and is
   * how a list empties after a trip. This is for the thing you no longer want
   * to buy at all, and it is the only way to remove an item without first
   * ticking it off — which would have recorded it in the pantry as bought.
   */
  function handleDelete() {
    hapticMedium();
    const animating = !prefersReducedMotion();
    if (animating) exit.startDelete();
    void deleteTask(item.id, { holdMs: animating ? TASK_DELETE_EXIT_MS : 0 })
      .then((ids) => {
        toast.show({
          message: `Deleted “${item.title}”`,
          undo: async () => {
            try {
              await restoreTasks(ids);
            } catch {
              toast.show({ message: `Couldn't bring “${item.title}” back` });
            }
          },
        });
      })
      .catch(() => {
        // The row is staying — put it back where it was.
        exit.cancel();
        toast.show({ message: `Couldn't delete “${item.title}”` });
      });
  }

  // Swipe right for the single tick-off action, which the row plays itself and
  // then closes. A plain View, not a button: nothing here is tapped — the
  // gesture fires it.
  const renderLeftActions = () => (
    <View style={[styles.swipeAction, styles.swipeCompleteAction]}>
      <Ionicons
        name={completed ? 'arrow-undo' : 'checkmark-sharp'}
        size={22}
        color="#fff"
      />
      <Text style={styles.swipeActionText}>
        {completed ? 'Put back' : 'Got it'}
      </Text>
    </View>
  );

  /*
    Swipe left for Delete, and nothing else. The task row offers Today and
    Tomorrow beside it; a thing to buy has no day worth moving, so the panel is
    one tile.

    `BaseButton`, not `Pressable`, for the reason written out on the task row's
    `SwipeActionButton`: the panel is rendered inside the swipeable, whose pan
    is its ancestor, and React Native cancels a press responder the moment an
    ancestor gesture activates. A tap whose thumb was still gliding out of the
    swipe that opened the panel was swallowed whole, with nothing on screen to
    say it had been seen.
  */
  const renderRightActions = () => (
    <BaseButton
      style={[styles.swipeAction, styles.swipeDeleteAction]}
      onPress={() => {
        swipeRef.current?.close();
        handleDelete();
      }}
      shouldActivateOnStart
      disallowInterruption
      rippleColor="rgba(255,255,255,0.28)"
    >
      <Ionicons name="trash-outline" size={20} color="#fff" />
      <Text style={styles.swipeActionText}>Delete</Text>
    </BaseButton>
  );

  return (
    // Collapse shell for the row's exit. The row shrinks its own height, so the
    // rows below travel up on their own. `overflow: hidden` is what makes the
    // clamped height crop rather than overlap — and it is applied only while
    // collapsing, so it can't clip the swipe panels the rest of the time.
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
        // A spring you can see, rather than the library's default — which
        // Reanimated integrates as critically damped, so it has no deceleration
        // to read at all. See `lib/swipe-actions.ts`.
        animationOptions={SWIPE_RETURN_SPRING}
        renderLeftActions={renderLeftActions}
        renderRightActions={renderRightActions}
        onSwipeableWillOpen={(direction) => {
          // `direction` is the direction of the *gesture*, not the panel that
          // opened. `panelForSwipe` is the one place that mapping is written
          // down — reading it backwards fails silently and completely.
          if (panelForSwipe(direction) === 'complete') {
            swipeRef.current?.close();
            completeAfterReturn();
          }
        }}
      >
        <Pressable
          onPress={onOpen}
          onLongPress={() => {
            hapticMedium();
            onCorrect();
          }}
          delayLongPress={300}
          style={({ pressed }) => [
            styles.row,
            pressed && styles.pressed,
            // Outranks the press: a row that is going has nothing useful left
            // to say about being held.
            exit.deleting && styles.deletingRow,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.title}`}
        >
          {/* The press target keeps the spacing; the ring inside it does the
              moving, so squashing it can't shift the title beside it. */}
          <Pressable
            onPress={() => {
              handleToggle();
            }}
            // The ring is 22px and the thumb is not, and this one gets tapped
            // while walking. The target reaches the full height of the row and
            // past its left edge.
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 10 }}
            style={styles.ringSlot}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: completed }}
            accessibilityLabel={`Mark ${item.title} as ${
              completed ? 'not bought' : 'bought'
            }`}
          >
            {/* A hairline copy of the ring, expanding out of it and dissolving.
                Behind the ring and outside its bounds, so it reads as something
                the tick sent outwards rather than a border that grew. */}
            <Animated.View
              style={[styles.halo, { borderColor: ring.color }, exit.haloStyle]}
              pointerEvents="none"
            />
            <Animated.View
              style={[
                styles.ring,
                {
                  borderColor: ring.color,
                  // Filled with the aisle's own colour, so the cart stays as
                  // colour-coded as the list above it.
                  backgroundColor: completed ? ring.color : 'transparent',
                },
                exit.ringStyle,
              ]}
            >
              {/* The aisle's icon holds the ring until the item is bought, when
                  the check takes the space. The check is always mounted and
                  scaled to nothing while the item is open, so ticking it off
                  animates a transform rather than a mount — a view that appears
                  has no "before" to spring from. */}
              {ring.icon && !completed ? (
                <ProjectIcon icon={ring.icon} size={12} color={ring.color} />
              ) : null}
              <Animated.Text
                style={[styles.check, styles.ringCheck, exit.checkStyle]}
              >
                ✓
              </Animated.Text>
            </Animated.View>
          </Pressable>
          {/*
            The title and subline are a column, so the column takes the row's
            spare width and the Text inside it must not.

            `styles.title` therefore has no `flex: 1`, and must not get one back.
            Flex-basis resolves against the container's main axis, so `flex: 1`
            here would set a vertical basis of 0 and collapse the title to
            height 0. Same trap as the task row's title.
          */}
          <View style={styles.body}>
            {/* Drawn rather than switched on — React Native cannot animate
                `textDecorationLine`. See `StruckText`. */}
            <StruckText
              text={item.title}
              struck={completed}
              strikeColor={TITLE_DONE_COLOR}
              style={[styles.title, completed && styles.titleDone]}
              numberOfLines={2}
            />
            {subline !== '' ? (
              <Text style={styles.subline} numberOfLines={1}>
                {subline}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </ReanimatedSwipeable>
    </Animated.View>
  );
}

export default React.memo(ListItemRow);

/** Struck-out title, and the rule drawn through it — one colour, named once. */
const TITLE_DONE_COLOR = '#9ca3af';

const styles = StyleSheet.create({
  // Crops the row as the collapse clamps its height; without it the content
  // overlaps the row below instead of appearing to leave.
  exitShell: { overflow: 'hidden' as const },
  row: {
    flexDirection: 'row',
    // Not 'center'. A row can be two lines of title plus a subline, and a ring
    // centred against that looks detached from the word it ticks off.
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    // Roomier than a task row on purpose: this one gets tapped while walking.
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  pressed: { backgroundColor: '#f9fafb' },
  // Held to a tint: the row still has to be readable while it is condemned,
  // because reading it is what the hold is for. red-50.
  deletingRow: { backgroundColor: '#fef2f2' },
  swipeAction: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 16,
  },
  swipeActionText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  swipeCompleteAction: { width: 96, backgroundColor: '#16a34a' },
  swipeDeleteAction: { width: 88, backgroundColor: '#dc2626' },
  // Spacing lives out here so the ring's squash can't nudge the title.
  ringSlot: { alignItems: 'center', justifyContent: 'center' },
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
  // Both are centred in the same 22px circle and only one is ever visible, so
  // the check is taken out of flow rather than laid out beside the icon.
  ringCheck: { position: 'absolute' },
  check: { color: '#fff', fontSize: 13, fontWeight: '700' },
  // Fills the row's width, so the title inside it does not have to. See above.
  body: { flex: 1, gap: 2 },
  title: { fontSize: 15, color: '#111827' },
  titleDone: { color: TITLE_DONE_COLOR },
  subline: { fontSize: 12, color: '#6b7280' },
});
