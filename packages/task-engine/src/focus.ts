import type { Task } from "@do-done/shared";
import { FOCUS_SCORES, PRIORITY_CONFIG } from "@do-done/shared";
import { isOverdue, isDueToday } from "@do-done/shared";

function scoreTask(task: Task): number {
  let score = 0;

  if (isOverdue(task)) score += FOCUS_SCORES.OVERDUE;
  if (isDueToday(task)) score += FOCUS_SCORES.DUE_TODAY;
  if (task.status === "in_progress") score += FOCUS_SCORES.IN_PROGRESS;
  if (task.due_time) score += FOCUS_SCORES.HAS_TIME_BLOCK;

  score += PRIORITY_CONFIG[task.priority].score;

  return score;
}

function isActive(task: Task): boolean {
  return task.status !== "done" && task.status !== "cancelled";
}

/**
 * The Focus list: auto-ranked by urgency, with manual overrides layered on top.
 *
 * - `focus_override === "include"` → pinned in, regardless of score.
 * - `focus_override === "exclude"` → never auto-picked.
 * - Auto picks fill the remaining slots (up to `maxItems` total) by score.
 *
 * Final order honors manual drag position (`sort_order`); ties fall back to
 * urgency so an un-touched list still reads most-important-first.
 */
export function generateFocusList(tasks: Task[], maxItems: number = 7): Task[] {
  const active = tasks.filter(isActive);

  const pinned = active.filter((t) => t.focus_override === "include");
  const pinnedIds = new Set(pinned.map((t) => t.id));

  const auto = active
    .filter((t) => !pinnedIds.has(t.id) && t.focus_override !== "exclude")
    .map((task) => ({ task, score: scoreTask(task) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, maxItems - pinned.length))
    .map(({ task }) => task);

  return [...pinned, ...auto].sort(
    (a, b) => a.sort_order - b.sort_order || scoreTask(b) - scoreTask(a)
  );
}

export interface TodayPartition {
  overdue: Task[];
  focus: Task[];
  other: Task[];
}

/**
 * Split a (today-scoped, already-filtered) task set into the three Today
 * sections. Overdue always wins: an overdue task stays in Overdue regardless of
 * `focus_override`. Focus — computed over the non-overdue remainder — honors the
 * include/exclude pins via {@link generateFocusList}; everything else is "other".
 */
export function partitionToday(
  tasks: Task[],
  focusMax: number = 3
): TodayPartition {
  const active = tasks.filter(isActive);
  const overdue = active.filter(isOverdue);
  const overdueIds = new Set(overdue.map((t) => t.id));
  const nonOverdue = active.filter((t) => !overdueIds.has(t.id));
  const focus = generateFocusList(nonOverdue, focusMax);
  const focusIds = new Set(focus.map((t) => t.id));
  const other = nonOverdue.filter((t) => !focusIds.has(t.id));
  return { overdue, focus, other };
}

/**
 * Tasks eligible for the Today view: everything overdue, everything scheduled on
 * or before `today`, plus the focus picks (which include any
 * `focus_override === "include"` task — even an undated one a user pinned in).
 *
 * `today` is a device-local ISO date string (YYYY-MM-DD); pass the caller's
 * `todayLocalISO()` so "today" matches the user's real day, not UTC.
 */
export function todayUniverse(
  allTasks: Task[],
  today: string,
  focusMax: number = 3
): Task[] {
  const active = allTasks.filter(isActive);
  const overdue = active.filter(isOverdue);
  const overdueIds = new Set(overdue.map((t) => t.id));
  const nonOverdue = active.filter((t) => !overdueIds.has(t.id));
  const focusIds = new Set(
    generateFocusList(nonOverdue, focusMax).map((t) => t.id)
  );
  const scheduledOrFocus = nonOverdue.filter((t) => {
    if (focusIds.has(t.id)) return true;
    const d = t.when_date ?? t.due_date ?? null;
    return d !== null && d <= today;
  });
  return [...overdue, ...scheduledOrFocus];
}
