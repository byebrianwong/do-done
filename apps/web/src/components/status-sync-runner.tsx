"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { todayLocalISO } from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";

/**
 * The half of status ↔ schedule sync that no write can trigger: a task whose
 * scheduled date never moved, but whose *day* arrived. Nothing happens to that
 * row — so something has to go looking.
 *
 * Runs on mount, when the tab regains focus, and when the local date rolls
 * over while the tab is open. `syncScheduledToStatus()` is one filtered UPDATE
 * and a no-op once converged, so an extra pass costs a round trip and nothing
 * else; it returns 0 immediately when the feature is off, which is the default.
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
