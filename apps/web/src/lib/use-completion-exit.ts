"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SPARK_MS,
  TASK_COMPLETE_COLLAPSE_MS,
  TASK_COMPLETE_HALO_MS,
  TASK_COMPLETE_HOLD_MS,
} from "@do-done/shared";

/**
 * Where a row is in the completion animation.
 *
 * - `idle`       — not leaving.
 * - `holding`    — completed and visibly so, still at full height.
 * - `collapsing` — height and opacity on their way to zero; the rows below are
 *                  travelling up for exactly this long.
 */
export type ExitPhase = "idle" | "holding" | "collapsing";

export interface CompletionExit {
  phase: ExitPhase;
  /** True once the row should be rendered at zero height. */
  collapsing: boolean;
  /**
   * Start the exit. `onGone` fires when the row is invisible and the caller may
   * drop it from the list for real. With reduced motion the whole timeline is
   * skipped and `onGone` fires on the spot.
   */
  start: (onGone: () => void) => void;
  /** Abort and snap back to full height — for a write that failed. */
  cancel: () => void;
  /**
   * True for the frames the halo is ringing out of the checkbox.
   *
   * A boolean rather than "is this row completed" on purpose: the halo marks
   * the *moment* a task was ticked off, so a list of already-done rows must
   * paint without a single one of them. Nothing else can tell those two states
   * apart, since a completed row looks the same however it got that way.
   */
  pulsing: boolean;
  /** Ring the halo once. Called when the user completes the task, not on mount. */
  pulse: () => void;
  /**
   * True for the frames the celebratory burst is in the air. Same
   * moment-not-state reasoning as {@link CompletionExit.pulsing}, but this one
   * is also *gated* — see `sparkReason` in `@do-done/shared`, which decides
   * whether a given completion earned it at all.
   */
  sparking: boolean;
  /** Throw the burst once. */
  spark: () => void;
}

/** Honour the OS setting; SSR has no matchMedia, so assume motion is fine. */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Drives the hold-then-collapse timeline a completed row plays on its way out.
 *
 * The row animates its own height rather than the list animating around it, so
 * this needs no cooperation from whatever is rendering the rows — dnd-kit
 * sortables included.
 *
 * Timers are cleared on unmount, but note what that does *not* cover: the
 * caller must have already written the completion to the server before calling
 * `start`. Nothing here is load-bearing for the data, only for the pixels.
 */
/**
 * A flag that is true for `ms` and then isn't, for marking a moment rather than
 * a state.
 *
 * Each one owns its timer. The exit's `start` clears the exit's timers and runs
 * immediately after these fire, so anything sharing that list would have its
 * own clean-up cancelled and be stranded on screen for the life of the row.
 */
function useMoment(ms: number): [boolean, () => void, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOn(false);
  }, []);

  const fire = useCallback(() => {
    if (prefersReducedMotion()) return;
    if (timer.current) clearTimeout(timer.current);
    setOn(true);
    // Unmounted once it has run, so a re-render mid-flight can't restart it and
    // a row that stays put (a list that keeps completed tasks) isn't left
    // holding an element that has finished doing anything.
    timer.current = setTimeout(() => setOn(false), ms);
  }, [ms]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return [on, fire, clear];
}

export function useCompletionExit(): CompletionExit {
  const [phase, setPhase] = useState<ExitPhase>("idle");
  const [pulsing, pulse, clearPulse] = useMoment(TASK_COMPLETE_HALO_MS);
  const [sparking, spark, clearSpark] = useMoment(SPARK_MS);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const start = useCallback(
    (onGone: () => void) => {
      clearTimers();
      if (prefersReducedMotion()) {
        onGone();
        return;
      }
      setPhase("holding");
      timers.current.push(
        setTimeout(() => setPhase("collapsing"), TASK_COMPLETE_HOLD_MS),
        setTimeout(onGone, TASK_COMPLETE_HOLD_MS + TASK_COMPLETE_COLLAPSE_MS)
      );
    },
    [clearTimers]
  );

  const cancel = useCallback(() => {
    clearTimers();
    setPhase("idle");
    // A write that failed gets no celebration.
    clearPulse();
    clearSpark();
  }, [clearTimers, clearPulse, clearSpark]);

  return {
    phase,
    collapsing: phase === "collapsing",
    start,
    cancel,
    pulsing,
    pulse,
    sparking,
    spark,
  };
}
