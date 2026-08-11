"use client";

import { useEffect, useRef } from "react";

/**
 * Window event telling every row for a given task that it is being deleted, so
 * it can play its exit before the list is refreshed out from under it.
 *
 * A completion is easy: the checkbox that starts it lives *in* the row, so the
 * row can animate itself. Nothing about a deletion does. It is started from the
 * right-click menu, from the editor modal (which may be open over a different
 * page entirely), from the bulk bar, and from a keyboard shortcut — none of
 * which own a row, and two of which act on rows that aren't even mounted.
 * Threading a callback down from four places to a component that may or may not
 * exist is the shape of the problem an event solves.
 *
 * It also gets the fan-out for free: a task showing in two lists at once is two
 * rows, and both of them are leaving.
 *
 * The deleter is what waits — see `useDeleteTasks`, which holds the refresh for
 * the animation's envelope. Nothing here is load-bearing for the data: a row
 * that never hears the event simply disappears the way it always did.
 */
export const TASK_DELETING_EVENT = "do-done:task-deleting";

export interface TaskDeletingDetail {
  ids: string[];
  /**
   * `start` condemns the rows; `cancel` brings them back — a delete that failed
   * to write, or an Undo tapped while the row is still collapsing.
   */
  phase: "start" | "cancel";
}

function announce(ids: string[], phase: TaskDeletingDetail["phase"]) {
  if (typeof window === "undefined" || ids.length === 0) return;
  window.dispatchEvent(
    new CustomEvent<TaskDeletingDetail>(TASK_DELETING_EVENT, {
      detail: { ids, phase },
    })
  );
}

/** Tell the rows for these tasks to start leaving. */
export function announceDeleting(ids: string[]) {
  announce(ids, "start");
}

/** Take it back — the write failed, or the user undid it in time. */
export function announceDeleteCancelled(ids: string[]) {
  announce(ids, "cancel");
}

/**
 * Subscribe a single row to its own deletion.
 *
 * The handlers are read through a ref rather than listed as dependencies: they
 * close over the row's exit state and are re-created every render, and
 * re-subscribing on each one would drop the listener for a frame — which on a
 * list that re-renders as the delete is announced is exactly the frame the
 * event arrives in.
 *
 * The ref is filled in an effect rather than during render. Effects commit
 * before the browser can dispatch the next event, so the listener below never
 * sees a stale pair — and a ref written during render is a re-render the
 * compiler can't see through.
 */
export function useTaskDeleting(
  id: string,
  handlers: { onStart: () => void; onCancel: () => void }
) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<TaskDeletingDetail>).detail;
      if (!detail?.ids.includes(id)) return;
      if (detail.phase === "start") ref.current.onStart();
      else ref.current.onCancel();
    };
    window.addEventListener(TASK_DELETING_EVENT, onEvent);
    return () => window.removeEventListener(TASK_DELETING_EVENT, onEvent);
  }, [id]);
}
