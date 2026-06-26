import type { Task } from "@do-done/shared";
import {
  FOCUS_SCORES,
  PRIORITY_CONFIG,
  QUICK_WIN_MAX_MINUTES,
  QUICK_WIN_PARTIAL_MAX_MINUTES,
} from "@do-done/shared";
import { isOverdue, isDueToday } from "@do-done/shared";

/**
 * Quick-win bonus: small tasks that can be completed quickly bubble up so the
 * default focus list mixes "knock it out" wins in with the most overdue and
 * highest-priority work. Tasks with no estimate are neutral (no bonus).
 */
function quickWinBonus(task: Task): number {
  const mins = task.duration_minutes;
  if (mins == null) return 0;
  if (mins <= QUICK_WIN_MAX_MINUTES) return FOCUS_SCORES.QUICK_WIN;
  if (mins <= QUICK_WIN_PARTIAL_MAX_MINUTES) return FOCUS_SCORES.QUICK_WIN_PARTIAL;
  return 0;
}

function scoreTask(task: Task): number {
  let score = 0;

  if (isOverdue(task)) score += FOCUS_SCORES.OVERDUE;
  if (isDueToday(task)) score += FOCUS_SCORES.DUE_TODAY;
  if (task.status === "in_progress") score += FOCUS_SCORES.IN_PROGRESS;
  if (task.due_time) score += FOCUS_SCORES.HAS_TIME_BLOCK;

  score += PRIORITY_CONFIG[task.priority].score;
  score += quickWinBonus(task);

  return score;
}

function isActive(task: Task): boolean {
  return task.status !== "done" && task.status !== "cancelled";
}

/**
 * The Focus list: auto-ranked by urgency, with manual overrides layered on top.
 *
 * - Auto picks fill `maxItems` slots by score (most overdue, highest priority,
 *   and quick wins float to the top).
 * - `focus_override === "exclude"` → never auto-picked.
 * - `focus_override === "include"` → pinned in, *additively*. Pinning a task
 *   into focus never pushes an auto pick out: the auto picks always fill their
 *   full `maxItems`, and any pin not already among them is layered on top.
 *
 * Final order honors manual drag position (`sort_order`); ties fall back to
 * urgency so an un-touched list still reads most-important-first.
 */
export function generateFocusList(tasks: Task[], maxItems: number = 7): Task[] {
  const active = tasks.filter(isActive);

  // Auto picks: top `maxItems` by urgency among everything not excluded. Pins
  // stay in this ranking pool so a pin that already ranks in the top slots
  // isn't also added a second time below.
  const auto = active
    .filter((t) => t.focus_override !== "exclude")
    .map((task) => ({ task, score: scoreTask(task) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, maxItems))
    .map(({ task }) => task);

  // Pins are additive: any pinned task not already an auto pick joins on top,
  // so moving a task *into* focus leaves the existing picks untouched.
  const selectedIds = new Set(auto.map((t) => t.id));
  const extraPins = active.filter(
    (t) => t.focus_override === "include" && !selectedIds.has(t.id)
  );

  return [...auto, ...extraPins].sort(
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
