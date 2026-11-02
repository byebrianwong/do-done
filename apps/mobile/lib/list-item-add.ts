import type { CreateTaskInput, Task } from '@do-done/shared';

/**
 * The rows an optimistic list add puts in the cache before the server answers.
 *
 * Pure, so the node suite covers it. `addListItem` in `list-queries.ts` is the
 * only caller.
 */

/**
 * Marks a row that exists only on this phone so far. A real id is a uuid, so
 * the two cannot collide.
 */
export const PENDING_ITEM_PREFIX = 'pending:';

/** Whether a row is a stand-in the server has not answered for yet. */
export function isPendingItem(id: string): boolean {
  return id.startsWith(PENDING_ITEM_PREFIX);
}

/**
 * The stand-in row for an item that is being created.
 *
 * It carries what the row draws: the title, the tags (a typed `@store` shows in
 * the subline at once), the list and the default status. `sort_order` is 0, the
 * column default a created row gets, and `created_at` is now, so the stand-in
 * sorts where the real row will.
 */
export function pendingListItem({
  tempId,
  listId,
  input,
  now,
}: {
  tempId: string;
  listId: string;
  input: Omit<CreateTaskInput, 'project_id'>;
  now: Date;
}): Task {
  const iso = now.toISOString();
  return {
    id: tempId,
    user_id: '',
    title: input.title,
    description: input.description ?? null,
    // The column default, which is what the insert gets.
    status: input.status ?? 'inbox',
    priority: input.priority ?? 'p4',
    project_id: listId,
    scheduled_date: input.scheduled_date ?? null,
    scheduled_time: input.scheduled_time ?? null,
    deadline_date: input.deadline_date ?? null,
    deadline_time: input.deadline_time ?? null,
    duration_minutes: input.duration_minutes ?? null,
    recurrence_rule: input.recurrence_rule ?? null,
    calendar_event_id: null,
    tags: input.tags ?? [],
    parent_task_id: null,
    depth: 0,
    sort_order: 0,
    focus_override: null,
    created_at: iso,
    updated_at: iso,
    completed_at: null,
    is_list_item: true,
  };
}

/**
 * A fetched list with the stand-ins still waiting on the server appended.
 *
 * Without this a refetch that lands while an add is in the air (the previous
 * add's own invalidate, in a burst) drops the stand-in, and the row blinks out
 * until its write comes back.
 */
export function withPendingItems(rows: Task[], pending: readonly Task[]): Task[] {
  if (pending.length === 0) return rows;
  const have = new Set(rows.map((t) => t.id));
  const missing = pending.filter((t) => !have.has(t.id));
  return missing.length === 0 ? rows : [...rows, ...missing];
}

/**
 * Swap the stand-in for the row the server returned.
 *
 * In place, so the row keeps its position. If the real row is already there
 * (a refetch that landed after the insert), the stand-in is dropped instead,
 * so the item is never drawn twice. That is the dedupe-by-id rule from
 * CLAUDE.md's *Known traps*.
 */
export function settlePendingItem(
  rows: Task[] | undefined,
  tempId: string,
  real: Task
): Task[] | undefined {
  if (!rows) return rows;
  if (rows.some((t) => t.id === real.id)) {
    return rows.filter((t) => t.id !== tempId);
  }
  const at = rows.findIndex((t) => t.id === tempId);
  if (at === -1) return [...rows, real];
  const next = rows.slice();
  next[at] = real;
  return next;
}

/** Take the stand-in out again, when the write failed. */
export function dropPendingItem(
  rows: Task[] | undefined,
  tempId: string
): Task[] | undefined {
  if (!rows || !rows.some((t) => t.id === tempId)) return rows;
  return rows.filter((t) => t.id !== tempId);
}
