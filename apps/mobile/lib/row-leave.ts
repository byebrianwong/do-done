/**
 * Whether a field patch takes a row out of the section it is drawn in.
 *
 * A row cannot answer this on its own. Whether "Tomorrow" moves it depends on
 * the list around it: on Today it leaves, on a date-grouped Upcoming it moves
 * to another day, and on All grouped by status it stays exactly where it is.
 * So each list hands its rows a {@link LeavesSection} predicate, built from the
 * same function the list uses to place a row, and the row plays its exit only
 * when the answer is yes.
 *
 * Pure, so the node suite covers it. There is no renderer in `apps/mobile`.
 */
import { applyDisplay, type DisplayConfig, type DisplayContext } from '@do-done/shared';
import type { Task, UpdateTaskInput } from '@do-done/shared';
import { todayUniverse } from '@do-done/task-engine';

/** Given the row as it will be after the write, does it leave its section? */
export type LeavesSection = (before: Task, after: Task) => boolean;

/** Where a list places a task, or null when the list does not show it. */
export type SectionOf = (task: Task) => string | null;

/** The task as it will read once `input` has landed. */
export function patchedTask(task: Task, input: UpdateTaskInput): Task {
  return { ...task, ...input } as Task;
}

/**
 * A row leaves when its section changes, including when it stops being shown
 * at all. A row that was not shown to begin with has nothing to leave.
 */
export function leavesBySection(sectionOf: SectionOf): LeavesSection {
  return (before, after) => {
    const from = sectionOf(before);
    return from !== null && sectionOf(after) !== from;
  };
}

/** `tasks` with `task` in place of the row that has its id. */
function withReplaced(tasks: Task[], task: Task): Task[] {
  return tasks.map((t) => (t.id === task.id ? task : t));
}

/**
 * Whether a task is in Today's universe, judged against the whole list with
 * this task substituted in. Focus picks are ranked across every task, so the
 * answer for one row depends on the others.
 */
export function inTodayUniverse(
  allTasks: Task[],
  task: Task,
  today: string
): boolean {
  return todayUniverse(withReplaced(allTasks, task), today).some(
    (t) => t.id === task.id
  );
}

/**
 * The section key `applyDisplay` would put one task under, or null when the
 * config's filters hide it. `applyDisplay` filters before it groups, so
 * running it over a single task answers both questions at once.
 */
export function displayGroupOf(
  task: Task,
  config: DisplayConfig,
  ctx?: DisplayContext
): string | null {
  for (const g of applyDisplay([task], config, ctx)) {
    if (g.tasks.length > 0) return g.key;
  }
  return null;
}
