/**
 * Which rows should open up when they mount, rather than appear at full height.
 *
 * A row that mounts has no way to tell *why*. It can be arriving because a
 * write put it there (an undone completion, a task just typed into quick-add,
 * a shopping item moving into the cart), or it can be a row the list unmounted
 * while it was off screen and has just drawn again as the user scrolled back.
 * Only the first is news. Animating the second would make every scroll grow
 * rows out of nothing.
 *
 * So the write paths say which ids are arriving, here, and a row asks once as
 * it mounts. Nothing else marks an id, so a virtualized remount never animates.
 *
 * Two windows, both short:
 *
 * - **{@link ARRIVAL_WINDOW_MS}**, from the mark to the first mount. Long
 *   enough to cover the round trip a quick-add waits on: that row only
 *   exists once the refetch lands.
 * - **{@link ARRIVAL_GRACE_MS}**, from the first mount. A task can be in two
 *   mounted lists at once (every tab screen stays mounted, so Today and All
 *   both draw a new task scheduled today), and both rows should open. After
 *   that the mark is spent, so scrolling the row away and back does nothing.
 *
 * Module state rather than a context because the writers are plain modules
 * (`task-queries.ts`) with no React tree to reach a provider from.
 */

import type { Task } from '@do-done/shared';

export const ARRIVAL_WINDOW_MS = 8_000;
export const ARRIVAL_GRACE_MS = 600;

/** id → the instant its mark stops counting. */
const marks = new Map<string, number>();

/** Say these ids are about to appear in a list because of a write. */
export function markArriving(ids: Iterable<string>, now = Date.now()): void {
  for (const [id, until] of marks) if (until <= now) marks.delete(id);
  for (const id of ids) marks.set(id, now + ARRIVAL_WINDOW_MS);
}

/**
 * Should a row for this id that is mounting now play the arrival?
 *
 * The first claim shortens the mark to the grace window rather than deleting
 * it, so a second list drawing the same task in the same moment opens too.
 */
export function claimArrival(id: string, now = Date.now()): boolean {
  const until = marks.get(id);
  if (until === undefined) return false;
  if (until <= now) {
    marks.delete(id);
    return false;
  }
  marks.set(id, Math.min(until, now + ARRIVAL_GRACE_MS));
  return true;
}

/** For tests. */
export function clearArrivals(): void {
  marks.clear();
}

/**
 * Put a task back into a cached list it was dropped from, where it was.
 *
 * `before` is the list as it stood before the task left it. The task goes in
 * after the nearest row that preceded it then and is still here now, so rows
 * added or removed in the meantime don't throw it to the wrong end. With none
 * of them left it goes first, which is where it was.
 *
 * Returns null when there is nothing to do: the task is already back (a
 * refetch got there first), or it was never in this list.
 */
export function reinsertTask(
  current: Task[],
  before: Task[],
  id: string
): Task[] | null {
  if (current.some((t) => t.id === id)) return null;
  const at = before.findIndex((t) => t.id === id);
  if (at < 0) return null;
  const task = before[at];
  for (let j = at - 1; j >= 0; j--) {
    const p = current.findIndex((t) => t.id === before[j].id);
    if (p >= 0) {
      return [...current.slice(0, p + 1), task, ...current.slice(p + 1)];
    }
  }
  return [task, ...current];
}
