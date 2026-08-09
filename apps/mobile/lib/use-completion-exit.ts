import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, type LayoutChangeEvent } from 'react-native';
import {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import {
  SPARK_MS,
  TASK_COMPLETE_ANTICIPATE_MS,
  TASK_COMPLETE_ANTICIPATE_SCALE,
  TASK_COMPLETE_CHECK_MS,
  TASK_COMPLETE_COLLAPSE_MS,
  TASK_COMPLETE_HALO_MS,
  TASK_COMPLETE_HOLD_MS,
  TASK_COMPLETE_SLIDE_PX,
  TASK_COMPLETE_SLIDE_SCALE,
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
  /**
   * Scale for the ring itself: it squashes and springs back as the task is
   * ticked off, so the control answers the finger instead of only reporting
   * that something changed.
   *
   * Unlike web — where the squash hangs off `:active` and really is the press —
   * this is folded into the completion. A 22px ring is under the thumb at
   * exactly the moment a press-driven squash would be visible, and swipe-to-
   * complete has no press to anticipate from at all.
   */
  ringStyle: ReturnType<typeof useAnimatedStyle>;
  /** A hairline ring expanding out of the checkbox. Spread onto the halo view. */
  haloStyle: ReturnType<typeof useAnimatedStyle>;
  /**
   * Squash-and-spring the ring, and ring the halo once.
   *
   * Only on the way in: reopening a task is a correction, not an achievement.
   */
  punch: () => void;
  /**
   * True while the celebratory burst is in the air, so the row can mount the
   * particles for exactly those frames and drop them afterwards.
   *
   * Separate from {@link CompletionExit.punch} because the burst is *gated*:
   * the halo rings on every completion, this one only on a completion that
   * earned it. See `sparkReason` in `@do-done/shared`.
   */
  sparking: boolean;
  /** 0 → 1 across the burst. The particles derive their own arcs from it. */
  sparkProgress: SharedValue<number>;
  /** Throw the burst. */
  spark: () => void;
}

export function useCompletionExit(initiallyChecked: boolean): CompletionExit {
  const progress = useSharedValue(0);
  const naturalHeight = useSharedValue(0);
  const checkScale = useSharedValue(initiallyChecked ? 1 : 0);
  const ringScale = useSharedValue(1);
  const halo = useSharedValue(0);
  const sparkProgress = useSharedValue(0);
  const [collapsing, setCollapsing] = useState(false);
  const [sparking, setSparking] = useState(false);
  const sparkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (sparkTimer.current) clearTimeout(sparkTimer.current);
    },
    []
  );

  const style = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    maxHeight:
      progress.value === 0
        ? UNCLAMPED
        : naturalHeight.value * (1 - progress.value),
    // Two more reads of the same `progress`, which is what makes the exit read
    // as filed rather than deleted: the row travels as its height closes. It
    // costs nothing — `transform` never touches layout, so the collapse
    // underneath is unaffected, and the rows below still travel for exactly
    // TASK_COMPLETE_COLLAPSE_MS.
    //
    // Rightward continues the direction the finger was already going, since
    // swipe-right is the complete gesture; a tap inherits the same vector.
    transform: [
      { translateX: progress.value * TASK_COMPLETE_SLIDE_PX },
      { scale: 1 - progress.value * (1 - TASK_COMPLETE_SLIDE_SCALE) },
    ],
  }));

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
    opacity: checkScale.value,
  }));

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
  }));

  // 0 → 1 drives both, so the halo can't get out of step with itself.
  const haloStyle = useAnimatedStyle(() => ({
    opacity: halo.value === 0 ? 0 : 0.6 * (1 - halo.value),
    transform: [{ scale: 1 + halo.value * 1.5 }],
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
    // A write that failed gets no celebration.
    halo.value = 0;
    ringScale.value = withTiming(1, { duration: TASK_COMPLETE_ANTICIPATE_MS });
    if (sparkTimer.current) clearTimeout(sparkTimer.current);
    sparkProgress.value = 0;
    setSparking(false);
  }, [progress, halo, ringScale, sparkProgress]);

  const spark = useCallback(() => {
    if (prefersReducedMotion()) return;
    if (sparkTimer.current) clearTimeout(sparkTimer.current);
    // Reset without animating, or a second burst sweeps the particles backwards
    // from wherever the last one had got to.
    sparkProgress.value = 0;
    setSparking(true);
    sparkProgress.value = withTiming(1, {
      duration: SPARK_MS,
      easing: Easing.bezier(0.18, 0.7, 0.35, 1),
    });
    // Unmounted once it has run: ten views per row is cheap for half a second
    // and pure waste for the rest of the row's life.
    sparkTimer.current = setTimeout(() => setSparking(false), SPARK_MS);
  }, [sparkProgress]);

  const punch = useCallback(() => {
    if (prefersReducedMotion()) return;
    ringScale.value = withSequence(
      withTiming(TASK_COMPLETE_ANTICIPATE_SCALE, {
        duration: TASK_COMPLETE_ANTICIPATE_MS,
      }),
      // The same spring the check uses, so the ring and the mark inside it read
      // as one object rather than two things that happened at once.
      withSpring(1, { damping: 9, stiffness: 260 })
    );
    // Reset without animating first, or a second completion in quick succession
    // would sweep the halo backwards from wherever it had got to.
    halo.value = 0;
    halo.value = withTiming(1, {
      duration: TASK_COMPLETE_HALO_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [ringScale, halo]);

  return {
    style,
    collapsing,
    onLayout,
    start,
    cancel,
    checkStyle,
    setChecked,
    ringStyle,
    haloStyle,
    punch,
    sparking,
    sparkProgress,
    spark,
  };
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
