// The order a user's tasks are in when nothing else sorts them.
//
// Every task has its own `sort_order`, and the order is `(sort_order, id)`
// across the user's whole account. A view in manual order, and each group in a
// grouped view, shows its tasks in that order. Every other sort uses it to
// break ties. So two tasks keep their relative position everywhere until one
// of them is moved past the other.
//
// The database owns the keys: `task_place_new` gives a new row one,
// `place_task` moves one task, and `adopt_task_order` re-deals a set of tasks
// (supabase/migrations/20261120000001_task_order.sql). What is here is the
// same arithmetic, for the key a client shows before the server answers, and
// the comparator every list sorts with.

import type { Task } from "./schemas.js";

/** The gap between keys after a renumber, and the step past an open end. */
export const TASK_ORDER_STEP = 1024;

type Ordered = Pick<Task, "id" | "sort_order">;

/**
 * The comparator for a user's task order.
 *
 * `id` breaks a tie, which only happens when two devices place a task into the
 * same gap at once. Comparing the id strings matches Postgres, which orders a
 * uuid by its bytes: a lowercase uuid's hex text sorts the same way, and that
 * is the form Supabase returns.
 */
export function compareTaskOrder(a: Ordered, b: Ordered): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** A copy of `tasks` in the user's task order. */
export function sortByTaskOrder<T extends Ordered>(tasks: readonly T[]): T[] {
  return [...tasks].sort(compareTaskOrder);
}

/**
 * A key strictly between `lo` and `hi`, `TASK_ORDER_STEP` past an open end, or
 * null when there is none.
 *
 * Null means the gap has run out: adjacent float8 values have no midpoint, and
 * `lo >= hi` has no inside at all. The server renumbers in that case. This is
 * `task_rank_between` in the migration; keep the two in step.
 */
export function rankBetween(lo: number | null, hi: number | null): number | null {
  if (lo === null && hi === null) return 0;
  if (lo === null) return (hi as number) - TASK_ORDER_STEP;
  if (hi === null) return lo + TASK_ORDER_STEP;
  if (lo >= hi) return null;
  const mid = lo + (hi - lo) / 2;
  if (mid <= lo || mid >= hi) return null;
  return mid;
}

/** Where a dropped task landed, and the key to show until the server answers. */
export interface Placement {
  /** The task it now follows in the list it was dropped into, or null at the top. */
  after: string | null;
  /** The task it now precedes, or null at the bottom. */
  before: string | null;
  /** A key that puts it between those two in this list. */
  rank: number;
}

/**
 * Plan a drop: `orderedIds` is the list after the drop, with `movedId` in its
 * new slot, and `keyOf` reads the keys the client currently holds.
 *
 * The rank only has to be right for this list, because the server works out
 * the real key from the neighbours (see `place_task`). When the client's keys
 * leave no room, the rank falls back to the neighbour's key, so the row is at
 * worst one slot off until the refetch.
 *
 * Returns null when `movedId` is not in the list.
 */
export function planPlacement(
  orderedIds: readonly string[],
  movedId: string,
  keyOf: (id: string) => number | undefined
): Placement | null {
  const at = orderedIds.indexOf(movedId);
  if (at < 0) return null;
  const after = at > 0 ? orderedIds[at - 1] : null;
  const before = at < orderedIds.length - 1 ? orderedIds[at + 1] : null;
  if (after === null && before === null) {
    return { after, before, rank: keyOf(movedId) ?? 0 };
  }
  const lo = after === null ? null : keyOf(after) ?? null;
  const hi = before === null ? null : keyOf(before) ?? null;
  const rank =
    lo === null && hi === null
      ? keyOf(movedId) ?? 0
      : rankBetween(lo, hi) ?? lo ?? (hi as number);
  return { after, before, rank };
}

/**
 * The keys `adopt_task_order` will deal: the listed tasks' own keys, sorted,
 * handed out in the listed order. Ids `keyOf` does not know are skipped.
 *
 * This is what a sorted view becomes when it is dragged into manual order. The
 * tasks swap keys among themselves, so tasks the view does not show keep their
 * places.
 */
export function adoptedRanks(
  orderedIds: readonly string[],
  keyOf: (id: string) => number | undefined
): Map<string, number> {
  const known = orderedIds.filter((id) => keyOf(id) !== undefined);
  const slots = known.map((id) => keyOf(id) as number).sort((a, b) => a - b);
  return new Map(known.map((id, i) => [id, slots[i]]));
}
