/**
 * What a task widget says, and how much of it fits.
 *
 * Two jobs, both pure and both tested in node — `apps/mobile` has no renderer,
 * and a widget that lays itself out wrong fails silently on a home screen.
 *
 *  1. **Grouping.** The same day-groups the app's own Today and Upcoming
 *     screens use, so a widget reads as a shrunk-down version of the screen it
 *     mirrors.
 *  2. **Fitting.** A height *budget*, spent row by row. The old
 *     `rowCapacity` divided the widget height by a flat 26 dp and hoped, which
 *     was wrong in both directions the moment rows stopped being uniform — and
 *     a "+N more" computed off a wrong capacity is a lie about the user's own
 *     task list.
 *
 * Everything a row displays is decided by `@do-done/shared`'s `rowGutter` /
 * `rowSubline` / `rowEstimate`, the same functions the in-app row calls. The
 * widget adds no rules of its own; it only drops what its own headers have
 * already said.
 *
 * No `@/lib/supabase` here, deliberately: this module has to be importable in a
 * node test, and the fetching lives next door in `widget-data.ts`.
 */

import {
  addDaysLocalISO,
  isOverdue,
  rowEstimate,
  rowGutter,
  rowSubline,
  sortByPriority,
  todayLocalISO,
  type Project,
  type RowGutter,
  type Task,
} from '@do-done/shared';
import { todayUniverse } from '@do-done/task-engine';

/** How many days ahead the Upcoming widget lists individual day sections. */
const UPCOMING_HORIZON_DAYS = 7;

export interface WidgetGroup {
  key: string;
  title: string;
  tasks: Task[];
  /**
   * True when the group's title *is* a day, so the rows beneath it must not
   * repeat it. The Overdue group is deliberately false: "Overdue" isn't a
   * date, and "3 days ago" is the one genuinely actionable thing those rows
   * have to say.
   */
  namesTheDay: boolean;
}

// ── Grouping ───────────────────────────────────────────

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
    groups.push({
      key: 'overdue',
      title: 'Overdue',
      tasks: sortByPriority(overdue),
      namesTheDay: false,
    });
  }
  groups.push({
    key: 'today',
    title: 'Today',
    tasks: sortByPriority(rest),
    namesTheDay: true,
  });
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
    out.push({
      key: 'overdue',
      title: 'Overdue',
      tasks: sortByPriority(overdue),
      namesTheDay: false,
    });
  }
  for (const k of [...byDate.keys()].sort()) {
    const arr = byDate.get(k)!;
    if (arr.length === 0 && k !== today) continue;
    const title = k === today ? 'Today' : k === tomorrow ? 'Tomorrow' : dayLabel(k);
    out.push({ key: k, title, tasks: sortByPriority(arr), namesTheDay: true });
  }
  if (later.length) {
    out.push({
      key: 'later',
      title: 'Later',
      tasks: sortByPriority(later),
      namesTheDay: false,
    });
  }
  if (anytime.length) {
    out.push({
      key: 'anytime',
      title: 'Anytime',
      tasks: sortByPriority(anytime),
      namesTheDay: false,
    });
  }
  return out;
}

/**
 * The single task a "Next up" strip shows, and how many are behind it.
 *
 * Deliberately the head of the Today universe rather than a fresh ranking: the
 * strip has to agree with the Today widget sitting next to it on the same home
 * screen, and disagreeing about which task is next would be worse than showing
 * nothing.
 */
export function buildNextUp(tasks: Task[]): { task: Task | null; remaining: number } {
  const flat = buildTodayGroups(tasks).flatMap((g) => g.tasks);
  return { task: flat[0] ?? null, remaining: Math.max(0, flat.length - 1) };
}

// ── What a row costs ───────────────────────────────────

/**
 * Row heights in dp, matching `widget-ui.tsx`. They are here rather than there
 * because the fit has to be computed before anything is drawn, and a number
 * that lives in two files is a number that will disagree with itself.
 *
 * `TextWidget` has no `lineHeight`, so these are the padding-and-margin sums
 * the component actually produces, not a typographic ideal.
 */
export const ROW_HEIGHT_BARE = 24;
export const ROW_HEIGHT_WITH_SUBLINE = 34;
export const GROUP_HEADER_HEIGHT = 22;
/** The first group header has no preceding row to clear, so it sits tighter. */
export const FIRST_GROUP_HEADER_HEIGHT = 17;
export const MORE_ROW_HEIGHT = 20;
/** The "Today · 5 left  +" bar. */
export const HEADER_BAR_HEIGHT = 30;
/** The card's own top + bottom padding. */
export const CARD_PADDING_HEIGHT = 20;

/** Height available for group headers and rows, given the whole widget's. */
export function contentBudget(widgetHeightDp: number): number {
  return Math.max(0, widgetHeightDp - HEADER_BAR_HEIGHT - CARD_PADDING_HEIGHT);
}

// ── Rows ───────────────────────────────────────────────

export interface WidgetHeaderRow {
  type: 'header';
  key: string;
  title: string;
  count: number;
  overdue: boolean;
}

export interface WidgetTaskRow {
  type: 'task';
  task: Task;
  /** Resolved here so the component never has to search the project list. */
  project: Project | null;
  gutter: RowGutter;
  /** Already joined; empty string means the row draws no second line at all. */
  subline: string;
  estimate: string;
}

export type WidgetRow = WidgetHeaderRow | WidgetTaskRow;

export interface LayoutOptions {
  /**
   * Drop the estimate column. A two-cell-wide widget has no width to spare for
   * a right-hand column, and the title is what people are reading.
   */
  hideEstimate?: boolean;
  /** Drop every subline — see `COMPACT_BUDGET_DP`. Derived, never passed in. */
  hideSubline?: boolean;
  now?: Date;
}

/** Minimum width in dp at which the estimate column earns its space. */
export const ESTIMATE_MIN_WIDTH_DP = 200;

/**
 * Below this much content height, rows print their title and nothing else.
 *
 * A subline costs 42% more row height, which on a 3×2 cell is the difference
 * between three tasks and one. The app's rule is that an unset field takes no
 * space; a widget's version of it is that a field with nowhere to go isn't
 * drawn smaller, it isn't drawn. There are exactly two densities and no
 * truncated middle ground — the alternative is a widget whose rows are a
 * different height on every phone.
 */
export const COMPACT_BUDGET_DP = 130;

/**
 * Everything a row says, before anyone asks whether it fits.
 *
 * The project name stays in the subline even though the ring already carries
 * the project's colour and emoji — exactly as the in-app row does it. The ring
 * is the fast cue; the name is the readable one, and a project with no emoji
 * would otherwise be nothing but a colour the user has to have memorised.
 *
 * The one thing dropped is the scheduled *day* under a header that just named
 * it, which is this widget's version of the "Today" chip the app deleted.
 */
export function buildTaskRow(
  task: Task,
  group: WidgetGroup,
  projects: Project[],
  opts: LayoutOptions = {}
): WidgetTaskRow {
  const now = opts.now;
  const project = task.project_id
    ? projects.find((p) => p.id === task.project_id) ?? null
    : null;
  return {
    type: 'task',
    task,
    project,
    gutter: rowGutter(task, now),
    subline: opts.hideSubline
      ? ''
      : rowSubline(task, {
          projectName: project?.name ?? null,
          hideScheduledDay: group.namesTheDay,
          now,
        }).join(' · '),
    estimate: opts.hideEstimate ? '' : rowEstimate(task),
  };
}

export function rowHeight(row: WidgetRow, isFirst: boolean): number {
  if (row.type === 'header') {
    return isFirst ? FIRST_GROUP_HEADER_HEIGHT : GROUP_HEADER_HEIGHT;
  }
  return row.subline ? ROW_HEIGHT_WITH_SUBLINE : ROW_HEIGHT_BARE;
}

/**
 * Fill `budgetDp` with as many rows as genuinely fit, and count what didn't.
 *
 * Two rules carried over from the row-count version because they were right:
 * a single group draws no header (the widget's own title already named it), and
 * a header is never emitted without room for at least one task under it — a
 * section heading with nothing beneath it is worse than the section being
 * absent.
 *
 * The "+N more" line reserves its own height *before* the last row is placed,
 * because a widget that fills itself to the edge and then discovers it has
 * something to say has nowhere left to say it.
 */
export function layoutRows(
  groups: WidgetGroup[],
  projects: Project[],
  budgetDp: number,
  opts: LayoutOptions = {}
): { rows: WidgetRow[]; hiddenCount: number } {
  const nonEmpty = groups.filter((g) => g.tasks.length > 0);
  const total = nonEmpty.reduce((n, g) => n + g.tasks.length, 0);
  const showHeaders = nonEmpty.length > 1;
  // Density is decided here, from the budget, so no caller can get it wrong.
  const rowOpts: LayoutOptions = {
    ...opts,
    hideSubline: budgetDp < COMPACT_BUDGET_DP,
  };

  const rows: WidgetRow[] = [];
  let used = 0;
  let shown = 0;

  outer: for (const group of nonEmpty) {
    const built = group.tasks.map((t) => buildTaskRow(t, group, projects, rowOpts));

    if (showHeaders) {
      const header: WidgetHeaderRow = {
        type: 'header',
        key: group.key,
        title: group.title,
        count: group.tasks.length,
        overdue: group.key === 'overdue',
      };
      const headerCost = rowHeight(header, rows.length === 0);
      // A header only earns its height if a task can follow it.
      const withFirstTask = headerCost + rowHeight(built[0], false);
      if (used + withFirstTask > budgetDp) break;
      rows.push(header);
      used += headerCost;
    }

    for (const row of built) {
      const cost = rowHeight(row, rows.length === 0);
      const remainingAfter = total - shown - 1;
      // Reserve the "+N more" line while placing the row that would need it.
      const reserve = remainingAfter > 0 ? MORE_ROW_HEIGHT : 0;
      if (used + cost + reserve > budgetDp) break outer;
      rows.push(row);
      used += cost;
      shown++;
    }
  }

  // A header with nothing under it can survive the loop when its group's tasks
  // all failed the reserve check. Drop it rather than draw a bare heading.
  while (rows.length && rows[rows.length - 1].type === 'header') rows.pop();

  return { rows, hiddenCount: total - shown };
}
