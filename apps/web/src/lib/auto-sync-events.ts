"use client";

import { useEffect } from "react";
import { useUndoToast } from "@/components/undo-toast";

/**
 * Window event carrying a line about a change the status ↔ schedule rule made
 * that the user didn't ask for — re-dating a task into the horizon moves it to
 * the target status, and a task whose day comes near moves on its own.
 *
 * An automatic move that says nothing is indistinguishable from the app losing
 * the edit, which is how this feature read as a bug: a status set by hand
 * sprang back with nothing on screen to explain it.
 *
 * An event rather than a returned value, for the same reason deletion uses one
 * (`task-delete-events.ts`): there is no single web write door. Fifteen
 * components call `getClientTasksApi().update()` directly, so plumbing a toast
 * through each would be fifteen chances to forget — and the one that forgot
 * would be silently back to the old behaviour. Announcing it at the seam every
 * one of them gets its API from covers all of them at once.
 *
 * Nothing here affects the data. A page with no listener mounted
 * writes exactly as it did before; it just doesn't say so.
 */
export const AUTO_SYNC_EVENT = "do-done:auto-sync";

export interface AutoSyncDetail {
  message: string;
}

/** Say that the rule changed something. */
export function announceAutoSync(message: string | null | undefined) {
  if (!message || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AutoSyncDetail>(AUTO_SYNC_EVENT, { detail: { message } })
  );
}

/**
 * Put those lines in the toast. Mounted once in the app layout — the events
 * fan out from writes anywhere, and two listeners would show every notice
 * twice.
 */
export function AutoSyncToasts() {
  const toast = useUndoToast();
  useEffect(() => {
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<AutoSyncDetail>).detail;
      if (detail?.message) toast.show({ message: detail.message });
    };
    window.addEventListener(AUTO_SYNC_EVENT, onEvent);
    return () => window.removeEventListener(AUTO_SYNC_EVENT, onEvent);
    // `toast` is a fresh object on every provider render, but re-subscribing is
    // cheap here and — unlike the sweep runner's effect — re-running this one
    // starts nothing.
  }, [toast]);
  return null;
}
