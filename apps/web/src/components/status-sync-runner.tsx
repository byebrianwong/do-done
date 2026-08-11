"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { todayLocalISO } from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";

/**
 * The two pieces of housekeeping that no write can trigger.
 *
 * **Status ↔ schedule sync**: a task whose scheduled date never moved, but
 * whose *day* arrived. Nothing happens to that row, so something has to go
 * looking. `syncScheduledToStatus()` is one filtered UPDATE and a no-op once
 * converged, and it returns 0 immediately when the feature is off (the
 * default).
 *
 * **The trash purge**: deleting a task now hides the row rather than
 * destroying it, so Undo can give back the same task. Something has to come
 * along afterwards and do the destroying, and `purgeDeleted()` is it — one
 * filtered read that finds nothing in the ordinary case, then the hard delete
 * and the Storage clear for anything past the retention window.
 *
 * They ride together because they want the same trigger: mount, tab focus, and
 * a slow tick for a tab left open. Neither is worth its own listener set, and
 * the purge is deliberately driven from the app rather than a server timer —
 * same reasoning as the sweep, and it needs no infrastructure a preview deploy
 * won't have.
 *
 * Renders nothing. Mounted once in the app layout rather than per view, so the
 * sweep doesn't fire again on every client-side navigation.
 */
export function StatusSyncRunner() {
  const router = useRouter();
  // The day the last sweep ran for. A sweep is only worth repeating once the
  // day has changed or the user has been away.
  const lastRunDay = useRef<string | null>(null);
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function sweep(force: boolean) {
      const today = todayLocalISO();
      if (!force && lastRunDay.current === today) return;
      if (running.current) return;
      running.current = true;
      try {
        const api = await getClientTasksApi();
        const { updated } = await api.syncScheduledToStatus();
        // Nothing on screen depends on this one — the rows it destroys have
        // been invisible since the moment they were deleted — so it never
        // forces a refresh, and a failure is as quiet as the sweep's.
        await api.purgeDeleted().catch(() => {});
        if (cancelled) return;
        lastRunDay.current = today;
        // Only pay for a refresh when something actually moved.
        if (updated > 0) router.refresh();
      } catch {
        // Never surface this — it's housekeeping the user didn't ask for by
        // name, and the next focus event will try again.
      } finally {
        running.current = false;
      }
    }

    void sweep(true);

    // Coming back to the tab is the moment a stale list is most visible, and
    // the cheapest place to notice that midnight went past while it sat idle.
    const onFocus = () => void sweep(false);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    // For a tab left open across midnight, where no focus event ever fires.
    const tick = setInterval(() => void sweep(false), 60_000);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(tick);
    };
  }, [router]);

  return null;
}
