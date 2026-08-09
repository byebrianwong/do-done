import { completionDays, isStreakDay, todayLocalISO } from '@do-done/shared';
import { getTasksApi } from './supabase';

/**
 * Whether a completion is the one keeping the user's run of days alive.
 *
 * A module singleton rather than a hook or a query, for the same reason
 * `completionChains` in `task-queries` is one: the row has to decide whether to
 * spark *inside* the tap handler, on the frame of the tap, and an await there
 * costs exactly the frame the animation exists to use. So the history is loaded
 * once and read synchronously.
 *
 * Web does this with a provider (`lib/completion-streak.tsx`) because its
 * layout already owns a stack of them and demo mode swaps the API underneath;
 * here there is one account per process and nothing to scope it to.
 */

/** `null` means "not loaded", deliberately distinct from "no days at all". */
let days: Set<string> | null = null;
let loading: Promise<void> | null = null;

/** How far back to look. Comfortably more than any run we'd celebrate. */
const HISTORY_LIMIT = 120;

/**
 * Read the recent completion history once.
 *
 * Safe to call repeatedly — the second call joins the first. Called at launch
 * from `_layout`, so the answer is ready long before anyone ticks anything off.
 */
export function loadCompletionStreak(): Promise<void> {
  if (days) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    try {
      const api = await getTasksApi();
      const { data, error } = await api.listCompleted({ limit: HISTORY_LIMIT });
      if (error) return;
      days = new Set(completionDays(data.map((t) => t.completed_at)));
    } catch {
      // A streak is a garnish on an animation. If the history can't be read the
      // rule simply never fires; nothing else about completing a task depends
      // on it.
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/**
 * Ask, and record, in one call: true when this completion keeps a streak alive,
 * and today is marked either way.
 *
 * One call rather than a read plus a note, because *any* completion starts the
 * day — including one that sparked for another reason. Splitting them would let
 * a second completion a moment later claim the same day again.
 *
 * Call only when completing. Reopening a task is a correction and must not mark
 * a day the user hasn't actually worked.
 */
export function claimStreakDay(): boolean {
  if (!days) return false;
  const today = todayLocalISO();
  const keeper = isStreakDay([...days], today);
  days.add(today);
  return keeper;
}

/** Drop the cached history — on sign-out, so the next account starts clean. */
export function resetCompletionStreak(): void {
  days = null;
  loading = null;
}
