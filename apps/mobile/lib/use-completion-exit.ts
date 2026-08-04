import { useCallback, useRef, useState } from 'react';
import { AccessibilityInfo, type LayoutChangeEvent } from 'react-native';
import {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import {
  TASK_COMPLETE_CHECK_MS,
  TASK_COMPLETE_COLLAPSE_MS,
  TASK_COMPLETE_HOLD_MS,
} from '@do-done/shared';

/**
 * Reduce-motion, read synchronously.
 *
 * The row has to decide whether to animate inside the tap handler — an `await`
 * there would cost the frame the whole feature exists to use. So the setting is
 * cached at module load and kept fresh by the OS listener.
 */
let reduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
  reduceMotion = v;
});
AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
  reduceMotion = v;
});

/** True when the OS asks us not to animate. */
export function prefersReducedMotion(): boolean {
  return reduceMotion;
}

/**
 * The completion exit for a task row: hold at full height reading as done, then
 * collapse to nothing so the rows below slide up into the gap.
 *
 * The row animates its own height rather than the list animating around it.
 * That matters here more than on web — these rows live inside a
 * `DraggableFlatList`, which owns its children's transforms, and a layout
 * animation on the list would be fighting it. Shrinking in place needs no
 * cooperation from the list at all.
 *
 * Height can't be animated from `auto`, so the row reports its natural height
 * via {@link CompletionExit.onLayout} and the collapse interpolates from that.
 * `maxHeight` rather than `height` so the row keeps sizing itself to its content
 * while idle — an unclamped sentinel means "no constraint".
 */
const UNCLAMPED = 10_000;

export interface CompletionExit {
  /** Spread onto the row's outermost `Animated.View`. */
  style: ReturnType<typeof useAnimatedStyle>;
  /**
   * True once the row is shrinking. Drives `overflow: 'hidden'`, which is what
   * makes the clamped height crop rather than just overlap — and which must be
   * off the rest of the time so it can't interfere with the swipe actions the
   * row renders beside itself.
   */
  collapsing: boolean;
  /** Wire to the same view's `onLayout` so the collapse knows how far to go. */
  onLayout: (e: LayoutChangeEvent) => void;
  /** Begin the hold-then-collapse. No-op under reduce motion. */
  start: () => void;
  /** Snap back to full height — for a write that failed. */
  cancel: () => void;
  /** Scale for the check mark; 0 when open, springs to 1 when completed. */
  checkStyle: ReturnType<typeof useAnimatedStyle>;
  /** Drive the check from the row's (optimistic) completed state. */
  setChecked: (checked: boolean) => void;
}

export function useCompletionExit(initiallyChecked: boolean): CompletionExit {
  const progress = useSharedValue(0);
  const naturalHeight = useSharedValue(0);
  const checkScale = useSharedValue(initiallyChecked ? 1 : 0);
  const [collapsing, setCollapsing] = useState(false);

  const style = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    maxHeight:
      progress.value === 0
        ? UNCLAMPED
        : naturalHeight.value * (1 - progress.value),
  }));

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
    opacity: checkScale.value,
  }));

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      // Only while at rest: mid-collapse the measured height IS the animation's
      // output, and feeding it back would ratchet the row to nothing.
      if (progress.value === 0) {
        naturalHeight.value = e.nativeEvent.layout.height;
      }
    },
    [naturalHeight, progress]
  );

  const setChecked = useCallback(
    (checked: boolean) => {
      if (prefersReducedMotion()) {
        checkScale.value = checked ? 1 : 0;
        return;
      }
      checkScale.value = checked
        ? withSpring(1, { damping: 9, stiffness: 260 })
        : withTiming(0, { duration: TASK_COMPLETE_CHECK_MS });
    },
    [checkScale]
  );

  const start = useCallback(() => {
    if (prefersReducedMotion()) return;
    setCollapsing(true);
    progress.value = withDelay(
      TASK_COMPLETE_HOLD_MS,
      withTiming(1, {
        duration: TASK_COMPLETE_COLLAPSE_MS,
        easing: Easing.out(Easing.quad),
      })
    );
  }, [progress]);

  const cancel = useCallback(() => {
    setCollapsing(false);
    progress.value = withTiming(0, { duration: 150 });
  }, [progress]);

  return { style, collapsing, onLayout, start, cancel, checkStyle, setChecked };
}

/**
 * Optimistic completed state for a row whose list drops it on a delay.
 *
 * During the hold the cache still reports the task as open, so the row would
 * render as open through its own completion animation. This overrides that
 * until the real value catches up (or the write fails and it's reverted).
 */
export function useOptimisticCompleted(actual: boolean) {
  const [override, setOverride] = useState<boolean | null>(null);
  const lastActual = useRef(actual);
  // The cache moved — either it caught up with the guess or it contradicted it.
  // Either way the server is now the better answer, so drop the override.
  // Adjusted during render (not in an effect) so the row never paints one frame
  // of stale state. See react.dev "adjusting state when a prop changes".
  if (lastActual.current !== actual) {
    lastActual.current = actual;
    if (override !== null) setOverride(null);
  }
  return [override ?? actual, setOverride] as const;
}
