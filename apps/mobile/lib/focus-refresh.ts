/**
 * Whether a screen coming back into focus should refetch its list.
 *
 * `useRefreshOnFocus` used to call `refetch()` on every focus. Two things were
 * wrong with that:
 *
 * - **It ran on the first focus too**, which is the mount, and the mount has
 *   already started a fetch. `refetch()` defaults to `cancelRefetch: true`, so
 *   the second call cancelled the first and started it again: two requests for
 *   every list on a cold start and on every Today/Upcoming swap.
 * - **It ignored how old the data was.** Switching between two tabs and back
 *   refetched both lists each time, including a list fetched a second ago.
 *
 * So the first focus is skipped, and a later one refetches only when the data
 * is older than `FOCUS_REFRESH_STALE_MS`. The caller also passes
 * `cancelRefetch: false`, so a focus that does refetch joins a fetch already in
 * flight rather than restarting it. That matters for `app/quick-add.tsx`, which
 * invalidates just before it closes: restarting that fetch on the focus that
 * follows put the new task on screen a round trip late.
 *
 * Writes made on this phone do not depend on this rule. Every one of them ends
 * in `invalidateTasks()`, and an invalidated query refetches as soon as its
 * screen subscribes again (see `lib/screen-activity.ts`). This rule is for
 * changes made somewhere else, like the laptop, or by the status-sync sweep.
 */

/**
 * How old a list may be before focusing its screen refetches it.
 *
 * Ten seconds, which is shorter than the 30s `staleTime` on purpose. Tapping
 * back and forth between tabs is done in under that, and refetching then only
 * redraws the same rows. A return after longer than that is the moment a
 * change made on another device might be waiting, and the old behaviour (every
 * focus refetched) is what users are used to seeing there.
 */
export const FOCUS_REFRESH_STALE_MS = 10_000;

export function shouldRefetchOnFocus({
  firstFocus,
  dataUpdatedAt,
  now,
}: {
  /** The focus that comes with the mount. Its fetch is already running. */
  firstFocus: boolean;
  /** `dataUpdatedAt` from the query result. 0 when there is no data yet. */
  dataUpdatedAt: number;
  now: number;
}): boolean {
  if (firstFocus) return false;
  // No data on a later focus means the first fetch failed or never ran.
  if (dataUpdatedAt === 0) return true;
  return now - dataUpdatedAt >= FOCUS_REFRESH_STALE_MS;
}
