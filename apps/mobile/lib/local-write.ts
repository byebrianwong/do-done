/**
 * When this device last wrote a task, so the "updating" bar can tell a refetch
 * that is news from one that is only confirming what is already on screen.
 *
 * Every write here patches the cache optimistically and then invalidates, so
 * the refetch that follows has nothing to show the user: the row already moved.
 * Putting the bar up for it says "something might change" about a list that
 * has just changed, and on a list the user is ticking through it went up and
 * came down again for every tick.
 *
 * `invalidateTasks()` stamps the time, because it is the one call every write
 * ends in. Pull-to-refresh and the focus refetch call `refetch()` instead, so
 * they still get the bar.
 *
 * Its own module, with no imports, because `ListPlaceholder.tsx` reads it and
 * must not pull Supabase in through `task-queries.ts`.
 */

/**
 * How long after a local write a fetch counts as its reconcile. A reconcile is
 * one round trip, which is well inside this on any connection where the bar
 * would be worth showing at all.
 */
export const LOCAL_RECONCILE_WINDOW_MS = 5_000;

let lastLocalWriteAt = -Infinity;

/** Called from `invalidateTasks()`. */
export function noteLocalWrite(now = Date.now()): void {
  lastLocalWriteAt = now;
}

/** For tests. */
export function resetLocalWrite(): void {
  lastLocalWriteAt = -Infinity;
}

/**
 * Is a fetch that starts at `now` the reconcile of a write this device just
 * made? Decided once, when the fetch starts: a write landing halfway through an
 * unrelated refresh should not take the bar down.
 */
export function isLocalReconcile(now = Date.now()): boolean {
  return now - lastLocalWriteAt < LOCAL_RECONCILE_WINDOW_MS;
}
