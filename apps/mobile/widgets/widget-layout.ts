/**
 * What a task widget says, and which rows its list holds.
 *
 * Two jobs, both pure and both tested in node — `apps/mobile` has no renderer,
 * and a widget that lays itself out wrong fails silently on a home screen.
 *
 *  1. **Grouping.** The same day-groups the app's own Today and Upcoming
 *     screens use, so a widget reads as a shrunk-down version of the screen it
 *     mirrors.
 *  2. **Listing.** The rows go into a list that scrolls, so the widget's
 *     height no longer decides which tasks appear. It decides only how much
 *     each row says (`COMPACT_BUDGET_DP`). The list stops at
 *     `WIDGET_MAX_LIST_ROWS` and says how many it left off.
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
  aisleRing,
  isOverdue,
  itemAisle,
  itemSubline,
  rowEstimate,
  rowGutter,
  rowSubline,
  sortByPriority,
  todayLocalISO,
  type AisleMemory,
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
  /**
   * These are shopping-list items, not tasks. Two things follow, and both are
   * the same rule the app's own list screen follows: the ring carries the
   * **aisle** rather than the project (every item on one list shares a project,
   * so drawing it would paint the widget one colour and say nothing), and the
   * subline is `itemSubline` — the shops and the day — rather than `rowSubline`.
   */
  listItems?: boolean;
  /**
   * These list items are on a checklist rather than a shopping list, so the
   * ring is the plain neutral one. A checklist has no aisles, and guessing one
   * for "passport" would colour the row for no reason.
   */
  checklist?: boolean;
  /**
   * Leave the project out of every subline. For a widget whose *title* is the
   * project: naming it again on each row spends the width that the row's own
   * date and estimate need. The date-shaped twin is `namesTheDay`.
   */
  hideProject?: boolean;
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
 *
 * `now` defaults to the clock. `lib/wear-snapshot.ts` passes the next local
 * midnight to build the list the watch switches to when the day turns over.
 */
export function buildTodayGroups(
  tasks: Task[],
  now: Date = new Date()
): WidgetGroup[] {
  const today = todayLocalISO(now);
  const universe = todayUniverse(tasks, today, 3, now);
  const overdue = universe.filter((t) => isOverdue(t, now));
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
 * `now` works as it does for {@link buildTodayGroups}.
 */
export function buildUpcomingGroups(
  tasks: Task[],
  now: Date = new Date()
): WidgetGroup[] {
  const today = todayLocalISO(now);
  const tomorrow = addDaysLocalISO(1, now);
  const horizonEnd = addDaysLocalISO(UPCOMING_HORIZON_DAYS, now);

  const overdue: Task[] = [];
  const byDate = new Map<string, Task[]>([
    [today, []],
    [tomorrow, []],
  ]);
  const later: Task[] = [];
  const anytime: Task[] = [];

  for (const t of tasks) {
    if (t.status === 'done' || t.status === 'cancelled') continue;
    if (isOverdue(t, now)) {
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
 * Row heights in dp, matching `widget-ui.tsx`. A subline row is the tallest
 * thing the list holds, which is what sets the list's minimum height.
 *
 * `TextWidget` has no `lineHeight`, so these are the padding-and-margin sums
 * the component actually produces, not a typographic ideal.
 */
export const ROW_HEIGHT_BARE = 24;
export const ROW_HEIGHT_WITH_SUBLINE = 34;
/** The "Today · 5 left  +" bar. */
export const HEADER_BAR_HEIGHT = 30;
/** The card's own top + bottom padding. */
export const CARD_PADDING_HEIGHT = 20;

/** Height available for group headers and rows, given the whole widget's. */
export function contentBudget(widgetHeightDp: number): number {
  return Math.max(0, widgetHeightDp - HEADER_BAR_HEIGHT - CARD_PADDING_HEIGHT);
}

/**
 * The height to give the scrolling list under the header bar.
 *
 * The library throws if a `ListWidget` measures 0 tall, and the throw leaves the
 * widget blank. It also requires every item to be no taller than the list. So
 * the list is never shorter than its tallest row, even on a cell so small that
 * the row then runs past the card's bottom edge. A clipped row is a better
 * failure than an empty cell. The declared minimum heights in `app.config.ts`
 * (110 and 150 dp) leave 60 dp or more, so this floor only matters if a
 * launcher reports a size below them.
 */
export function listHeight(widgetHeightDp: number): number {
  return Math.max(contentBudget(widgetHeightDp), ROW_HEIGHT_WITH_SUBLINE);
}

/**
 * A picker row: a ring, a name, and nothing else. Shorter than a task row
 * because it can never carry a subline.
 */
export const PICKER_ROW_HEIGHT = 26;

/**
 * The most tasks one list widget draws. Past this the list ends in "+N more",
 * which opens the screen the widget mirrors.
 *
 * Each row is drawn to two images (light and dark) and written to disk on
 * every widget update, and an update follows every task write. Upcoming's
 * Anytime group can hold most of the 200 tasks `loadWidgetTasks` reads, which
 * would be 400 images per write. Fifty rows is several screens of scrolling on
 * any widget size.
 */
export const WIDGET_MAX_LIST_ROWS = 50;

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
  /**
   * What the leading circle draws — resolved here because it is decided
   * per row and per *kind* of row, and the component should not have to know
   * which kind it is holding. `color` is the raw chosen colour; the theme
   * lifts it for the dark card. `icon` is a `ph:` token or an emoji.
   */
  ring: { color: string | null; icon: string | null };
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
  /**
   * Aisles the user has taught, for a shopping-list group. Absent is the
   * correct fallback, not a failure: the lexicon still guesses.
   */
  aisleMemory?: AisleMemory;
  now?: Date;
}

/** Minimum width in dp at which the estimate column is worth its space. */
export const ESTIMATE_MIN_WIDTH_DP = 200;

/**
 * Below this much content height, rows print their title and nothing else.
 *
 * A subline costs 42% more row height (34 dp against 24), so a short cell
 * shows noticeably fewer rows at once with them. The list scrolls, so nothing
 * is lost either way, but a widget is read at a glance and a glance does not
 * scroll. The app's rule is that an unset field takes no
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

  if (group.listItems) {
    // A shopping item, so both coloured slots change hands. The ring carries
    // the aisle — computed per item rather than taken from the section, because
    // `groupByAisle` collapses to one unlabelled group on a short list and
    // reading the group would then leave every row grey. The gutter is left
    // alone: an item can still be late, and `rowGutter` says so the same way.
    const ring = aisleRing(
      group.checklist ? null : itemAisle(task, opts.aisleMemory)
    );
    return {
      type: 'task',
      task,
      project,
      ring: { color: ring.color, icon: ring.icon },
      gutter: rowGutter(task, now),
      subline: opts.hideSubline ? '' : itemSubline(task, { now }).join(' · '),
      // An estimate on a thing to buy is not a thing anyone sets.
      estimate: '',
    };
  }

  return {
    type: 'task',
    task,
    project,
    ring: { color: project?.color ?? null, icon: project?.icon ?? null },
    gutter: rowGutter(task, now),
    subline: opts.hideSubline
      ? ''
      : rowSubline(task, {
          projectName: group.hideProject ? null : project?.name ?? null,
          hideScheduledDay: group.namesTheDay,
          now,
        }).join(' · '),
    estimate: opts.hideEstimate ? '' : rowEstimate(task),
  };
}

/**
 * Every row the widget's list holds, and how many tasks it left off.
 *
 * `budgetDp` is the height under the header bar. It no longer limits the rows,
 * because the list scrolls. It decides only whether rows carry a subline.
 *
 * A single group draws no header, because the widget's own title already named
 * it. A header is never the last row: the cap is checked before a group starts,
 * so a group that begins always gets at least one task under its heading.
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
  let shown = 0;

  outer: for (const group of nonEmpty) {
    if (shown >= WIDGET_MAX_LIST_ROWS) break;
    if (showHeaders) {
      rows.push({
        type: 'header',
        key: group.key,
        title: group.title,
        // The whole group, even when the cap cuts it short. The header says
        // what is in the section; "+N more" says what the list left off.
        count: group.tasks.length,
        overdue: group.key === 'overdue',
      });
    }
    for (const task of group.tasks) {
      if (shown >= WIDGET_MAX_LIST_ROWS) break outer;
      rows.push(buildTaskRow(task, group, projects, rowOpts));
      shown++;
    }
  }

  return { rows, hiddenCount: total - shown };
}
