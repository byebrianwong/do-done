/**
 * Pure data layer for the home-screen task widgets (Today, Upcoming).
 *
 * Fetches the active task list once and derives the same day-groupings the app's
 * own views use, so a widget reads as a shrunk-down version of the screen it
 * mirrors. No JSX here — the render primitives live in `widget-ui.tsx` and the
 * orchestration in `widget-task-handler.ts`.
 */

import {
  todayLocalISO,
  addDaysLocalISO,
  isOverdue,
  sortByPriority,
  type Task,
} from '@do-done/shared';
import { todayUniverse } from '@do-done/task-engine';
import { supabase, getTasksApi } from '@/lib/supabase';

/** How many days ahead the Upcoming widget lists individual day sections. */
const UPCOMING_HORIZON_DAYS = 7;

export interface WidgetGroup {
  key: string;
  title: string;
  tasks: Task[];
}

/** Either a signed-out marker or the fetched active tasks. */
export type WidgetTasks =
  | { signedOut: true }
  | { signedOut: false; tasks: Task[] };

/**
 * Load active tasks for a widget render, or a signed-out marker. Auth is read
 * from the local session (AsyncStorage) — no network round-trip just to learn
 * whether we're signed in.
 */
export async function loadWidgetTasks(): Promise<WidgetTasks> {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) return { signedOut: true };
  try {
    const api = await getTasksApi();
    const { data: tasks, error } = await api.list({ limit: 200, offset: 0 });
    if (error) return { signedOut: false, tasks: [] };
    return { signedOut: false, tasks };
  } catch {
    return { signedOut: false, tasks: [] };
  }
}

function effectiveDate(t: Task): string | null {
  return t.scheduled_date ?? t.deadline_date ?? null;
}

function dayLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Today widget groups: Overdue (if any) then Today — everything scheduled on or
 * before today plus the focus picks, matching the app's Today view universe.
 */
export function buildTodayGroups(tasks: Task[]): WidgetGroup[] {
  const today = todayLocalISO();
  const universe = todayUniverse(tasks, today, 3);
  const overdue = universe.filter((t) => isOverdue(t));
  const overdueIds = new Set(overdue.map((t) => t.id));
  const rest = universe.filter((t) => !overdueIds.has(t.id));

  const groups: WidgetGroup[] = [];
  if (overdue.length) {
    groups.push({ key: 'overdue', title: 'Overdue', tasks: sortByPriority(overdue) });
  }
  groups.push({ key: 'today', title: 'Today', tasks: sortByPriority(rest) });
  return groups;
}

/**
 * Upcoming widget groups: Overdue → Today → Tomorrow → each dated day within the
 * horizon → Later (beyond the horizon) → Anytime (undated). Mirrors the app's
 * Upcoming screen (minus calendar events and drag targets). Empty day sections
 * are dropped except Today, which always shows so the widget isn't blank.
 */
export function buildUpcomingGroups(tasks: Task[]): WidgetGroup[] {
  const today = todayLocalISO();
  const tomorrow = addDaysLocalISO(1);
  const horizonEnd = addDaysLocalISO(UPCOMING_HORIZON_DAYS);

  const overdue: Task[] = [];
  const byDate = new Map<string, Task[]>([
    [today, []],
    [tomorrow, []],
  ]);
  const later: Task[] = [];
  const anytime: Task[] = [];

  for (const t of tasks) {
    if (t.status === 'done' || t.status === 'cancelled') continue;
    if (isOverdue(t)) {
      overdue.push(t);
      continue;
    }
    const d = effectiveDate(t);
    if (d) {
      if (d <= horizonEnd) {
        const arr = byDate.get(d) ?? [];
        arr.push(t);
        byDate.set(d, arr);
      } else {
        later.push(t);
      }
    } else {
      anytime.push(t);
    }
  }

  const out: WidgetGroup[] = [];
  if (overdue.length) {
    out.push({ key: 'overdue', title: 'Overdue', tasks: sortByPriority(overdue) });
  }
  for (const k of [...byDate.keys()].sort()) {
    const arr = byDate.get(k)!;
    if (arr.length === 0 && k !== today) continue;
    const title = k === today ? 'Today' : k === tomorrow ? 'Tomorrow' : dayLabel(k);
    out.push({ key: k, title, tasks: sortByPriority(arr) });
  }
  if (later.length) {
    out.push({ key: 'later', title: 'Later', tasks: sortByPriority(later) });
  }
  if (anytime.length) {
    out.push({ key: 'anytime', title: 'Anytime', tasks: sortByPriority(anytime) });
  }
  return out;
}

/** A flattened render row: a group header or a single task. */
export type WidgetRow =
  | { type: 'header'; key: string; title: string; count: number; overdue: boolean }
  | { type: 'task'; task: Task };

/**
 * Rough number of content rows (group headers + task rows) that fit under the
 * widget's title bar for a given widget `height` in dp. Deliberately
 * conservative; exact fit is tuned on-device.
 */
export function rowCapacity(heightDp: number): number {
  const TITLE_BAR = 40; // the "Today  +" header
  const PADDING = 20; // top + bottom padding
  const ROW = 26; // one task row or group header
  return Math.max(1, Math.floor((heightDp - TITLE_BAR - PADDING) / ROW));
}

/**
 * Flatten day-groups into at most `maxRows` render rows. With a single group the
 * group header is omitted (the widget title already names it); with several,
 * each group contributes a header plus its tasks. Returns the rows plus the
 * count of tasks that didn't fit, for a "+N more" line.
 */
export function flattenGroups(
  groups: WidgetGroup[],
  maxRows: number
): { rows: WidgetRow[]; hiddenCount: number } {
  const nonEmpty = groups.filter((g) => g.tasks.length > 0);
  const total = nonEmpty.reduce((n, g) => n + g.tasks.length, 0);
  const showHeaders = nonEmpty.length > 1;

  const rows: WidgetRow[] = [];
  let shown = 0;

  for (const g of nonEmpty) {
    if (rows.length >= maxRows) break;
    if (showHeaders) {
      // Need room for the header plus at least one task, else stop here.
      if (rows.length + 2 > maxRows) break;
      rows.push({
        type: 'header',
        key: g.key,
        title: g.title,
        count: g.tasks.length,
        overdue: g.key === 'overdue',
      });
    }
    for (const task of g.tasks) {
      if (rows.length >= maxRows) break;
      rows.push({ type: 'task', task });
      shown++;
    }
  }

  return { rows, hiddenCount: total - shown };
}
