"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  TASK_COMPLETE_COLLAPSE_MS,
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
  }, [clearTimers]);

  return { phase, collapsing: phase === "collapsing", start, cancel };
}
