import { AppState } from 'react-native';
import { todayLocalISO } from '@do-done/shared';
import { getTasksApi } from './supabase';
import { queryClient } from './query-client';
import { taskKeys } from './task-queries';

/**
 * The housekeeping no write can trigger.
 *
 * **Status ↔ schedule sync**: a task whose scheduled date never moved, but
 * whose *day* arrived. Nothing happens to that row, so something has to go
 * looking. `syncScheduledToStatus()` is one filtered UPDATE and a no-op once
 * converged, and returns immediately when the feature is off (the default), so
 * running it on every resume costs a round trip and nothing else.
 *
 * **The trash purge**: deleting a task hides the row rather than destroying
 * it, so Undo can give back the same task. `purgeDeleted()` is what eventually
 * does the destroying — one filtered read that finds nothing in the ordinary
 * case. It rides along here because it wants the same trigger and is no more
 * worth its own listener than the sweep is.
 */

// The day the last sweep ran for. Module state is right here: it's per JS
// context, and a cold start should always sweep.
let lastRunDay: string | null = null;
let running = false;

/**
 * Run the sweep if it hasn't already run for today. Invalidates the task
 * queries only when something actually moved.
 */
export async function sweepStatusSync(force = false): Promise<void> {
  const today = todayLocalISO();
  if (!force && lastRunDay === today) return;
  if (running) return;
  running = true;
  try {
    const api = await getTasksApi();
    const { updated } = await api.syncScheduledToStatus();
    // Nothing on screen depends on this — the rows it destroys have been
    // invisible since the moment they were deleted — so it never invalidates.
    await api.purgeDeleted().catch(() => {});
    lastRunDay = today;
    if (updated > 0) {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    }
  } catch {
    // Housekeeping the user didn't ask for by name — never surface it. The
    // next resume tries again.
  } finally {
    running = false;
  }
}

/**
 * Sweep on launch and on every return to the foreground. Resume is when a
 * stale list is most visible, and it's the only moment the app reliably
 * notices that midnight went past while it was backgrounded.
 *
 * Returns an unsubscribe function.
 */
export function startStatusSyncSweeps(): () => void {
  void sweepStatusSync(true);
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void sweepStatusSync();
  });
  return () => sub.remove();
}
