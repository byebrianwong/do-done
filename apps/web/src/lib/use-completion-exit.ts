"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
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
export function useCompletionExit(): CompletionExit {
  const [phase, setPhase] = useState<ExitPhase>("idle");
  const [pulsing, setPulsing] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // The halo keeps its own timer. `start` clears the exit's timers and is
  // called immediately after `pulse` — sharing one list would cancel the
  // pulse's own clean-up and strand the halo on screen for good.
  const haloTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  useEffect(
    () => () => {
      clearTimers();
      if (haloTimer.current) clearTimeout(haloTimer.current);
    },
    [clearTimers]
  );

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
    if (haloTimer.current) clearTimeout(haloTimer.current);
    setPulsing(false);
  }, [clearTimers]);

  const pulse = useCallback(() => {
    if (prefersReducedMotion()) return;
    if (haloTimer.current) clearTimeout(haloTimer.current);
    setPulsing(true);
    // Unmounted once it has run, so a re-render mid-flight can't restart it and
    // a row that stays put (a list that keeps completed tasks) isn't left
    // holding an element that has finished doing anything.
    haloTimer.current = setTimeout(() => setPulsing(false), TASK_COMPLETE_HALO_MS);
  }, []);

  return { phase, collapsing: phase === "collapsing", start, cancel, pulsing, pulse };
}
