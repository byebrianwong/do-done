/**
 * The task editor's subtask list, as plain functions over a `Task[]`.
 *
 * The section holds its own list in React state, apart from the query cache,
 * so a tick or a delete has to be applied to it before the write goes out and
 * taken back if the write fails. These are the apply and revert halves. They
 * live here rather than in the component because `apps/mobile` has no renderer,
 * so this is the only place the rules can be tested.
 */
import type { Task, TaskStatus } from '@do-done/shared';

/** Done and cancelled both draw the ticked ring, so both untick. */
export function isSubtaskDone(task: Pick<Task, 'status'>): boolean {
  return task.status === 'done' || task.status === 'cancelled';
}

/**
 * The status a tap moves a subtask to. An untick lands on `not_started`, which
 * is what `TasksApi.reopen` does when it has no earlier status to restore.
 */
export function nextSubtaskStatus(task: Pick<Task, 'status'>): TaskStatus {
  return isSubtaskDone(task) ? 'not_started' : 'done';
}

/** The list with one subtask moved to `status`, as the write will leave it. */
export function applySubtaskStatus(
  list: readonly Task[],
  id: string,
  status: TaskStatus,
  now: Date = new Date()
): Task[] {
  return list.map((t) =>
    t.id === id
      ? {
          ...t,
          status,
          completed_at: status === 'done' ? now.toISOString() : null,
        }
      : t
  );
}

/**
 * Take back a failed tick: put `before` back, but only while the row still
 * shows the status this write applied.
 *
 * Two quick taps send two writes. If the first fails after the second was
 * applied, the row already shows the second intent, and reverting it to the
 * first one's starting point would undo a tap that may well succeed.
 */
export function revertSubtaskStatus(
  list: readonly Task[],
  before: Task,
  applied: TaskStatus
): Task[] {
  return list.map((t) => (t.id === before.id && t.status === applied ? before : t));
}

/** The list without `id`, and where the row was, so a revert can put it back. */
export function removeSubtask(
  list: readonly Task[],
  id: string
): { list: Task[]; removed: Task | null; index: number } {
  const index = list.findIndex((t) => t.id === id);
  if (index === -1) return { list: [...list], removed: null, index: -1 };
  return {
    list: [...list.slice(0, index), ...list.slice(index + 1)],
    removed: list[index],
    index,
  };
}

/**
 * Put a removed subtask back where it was. A no-op when it is already there,
 * so a revert and a refetch landing in either order cannot show it twice.
 */
export function reinsertSubtask(
  list: readonly Task[],
  task: Task,
  index: number
): Task[] {
  if (list.some((t) => t.id === task.id)) return [...list];
  const at = Math.max(0, Math.min(index, list.length));
  return [...list.slice(0, at), task, ...list.slice(at)];
}

/** Append a created subtask, unless it is already in the list. */
export function appendSubtask(list: readonly Task[], task: Task): Task[] {
  return list.some((t) => t.id === task.id) ? [...list] : [...list, task];
}

/**
 * What the add field should hold after a create failed.
 *
 * The field was cleared when the create went out, so the user may have typed
 * the next subtask since. That text wins: the failed title is named in the
 * error instead. Only an empty field gets the failed title back.
 */
export function draftAfterFailedAdd(current: string, failedTitle: string): string {
  return current.trim().length > 0 ? current : failedTitle;
}
