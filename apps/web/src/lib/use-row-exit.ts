"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SPARK_MS,
  TASK_COMPLETE_COLLAPSE_MS,
  TASK_COMPLETE_HALO_MS,
  TASK_COMPLETE_HOLD_MS,
  TASK_DELETE_COLLAPSE_MS,
  TASK_DELETE_HOLD_MS,
} from "@do-done/shared";

/**
 * Where a row is in its exit animation.
 *
 * - `idle`       — not leaving.
 * - `holding`    — leaving, but still at full height: completed and visibly so,
 *                  or dimmed and condemned.
 * - `collapsing` — height and opacity on their way to zero; the rows below are
 *                  travelling up for exactly this long.
 */
export type ExitPhase = "idle" | "holding" | "collapsing";

/**
 * Why the row is leaving, which is the whole difference between the two exits.
 *
 * They share a shape — hold, then collapse — and nothing else: the timings, the
 * direction of travel and what the row looks like while it holds are all read
 * off this. See the deletion block in `@do-done/shared`'s constants for why
 * they must never be confusable at a glance.
 */
export type ExitKind = "complete" | "delete";

const TIMINGS: Record<ExitKind, { hold: number; collapse: number }> = {
  complete: { hold: TASK_COMPLETE_HOLD_MS, collapse: TASK_COMPLETE_COLLAPSE_MS },
  delete: { hold: TASK_DELETE_HOLD_MS, collapse: TASK_DELETE_COLLAPSE_MS },
};

export interface RowExit {
  phase: ExitPhase;
  /** Which exit is running. Meaningless while `phase` is `idle`. */
  kind: ExitKind;
  /** True once the row should be rendered at zero height. */
  collapsing: boolean;
  /**
   * True from the first frame of a deletion until the row is gone — the hold
   * included, which is the point: the hold is where the row still has its
   * height and has to *say* it is going.
   */
  deleting: boolean;
  /**
   * Start the exit. `onGone` fires when the row is invisible and the caller may
   * drop it from the list for real. With reduced motion the whole timeline is
   * skipped and `onGone` fires on the spot.
   */
  start: (onGone: () => void, kind?: ExitKind) => void;
  /** Abort and snap back to full height — for a write that failed, or an undo. */
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
   * moment-not-state reasoning as {@link RowExit.pulsing}, but this one is also
   * *gated* — see `sparkReason` in `@do-done/shared`, which decides whether a
   * given completion earned it at all.
   */
  sparking: boolean;
  /** Throw the burst once. */
  spark: () => void;
}

/** Honour the OS setting; SSR has no matchMedia, so assume motion is fine. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Drives the hold-then-collapse timeline a row plays on its way out, whether it
 * is leaving because it was completed or because it was deleted.
 *
 * The row animates its own height rather than the list animating around it, so
 * this needs no cooperation from whatever is rendering the rows — dnd-kit
 * sortables included.
 *
 * Timers are cleared on unmount, but note what that does *not* cover: the
 * caller must have already written the change to the server before calling
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

export function useRowExit(): RowExit {
  const [phase, setPhase] = useState<ExitPhase>("idle");
  const [kind, setKind] = useState<ExitKind>("complete");
  const [pulsing, pulse, clearPulse] = useMoment(TASK_COMPLETE_HALO_MS);
  const [sparking, spark, clearSpark] = useMoment(SPARK_MS);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const start = useCallback(
    (onGone: () => void, nextKind: ExitKind = "complete") => {
      clearTimers();
      setKind(nextKind);
      if (prefersReducedMotion()) {
        onGone();
        return;
      }
      const { hold, collapse } = TIMINGS[nextKind];
      setPhase("holding");
      timers.current.push(
        setTimeout(() => setPhase("collapsing"), hold),
        setTimeout(onGone, hold + collapse)
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
    kind,
    collapsing: phase === "collapsing",
    deleting: kind === "delete" && phase !== "idle",
    start,
    cancel,
    pulsing,
    pulse,
    sparking,
    spark,
  };
}
