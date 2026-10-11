/**
 * What the phone sends the watch, and how it is built.
 *
 * **The phone decides what a row says; the watch only draws it.** Every row in
 * this snapshot arrives with its subline, its gutter and its ring colour
 * already computed, by the same `rowSubline` / `rowGutter` / `ringColor` the
 * in-app row and the home-screen widgets call. The alternative — porting those
 * rules to Kotlin — is the drift this repo spends a shared package avoiding, and
 * it would be the worst case of it: a second implementation, in a second
 * language, on the one surface nothing in CI can render.
 *
 * It also makes the watch cheap. A Wear OS tile renders on a battery the size of
 * a coin, and it gets handed strings rather than a task list and a rule set.
 *
 * This module is pure so the node suite can cover it. The impure half — reading
 * the session, fetching tasks, handing the JSON to the native module — is
 * `lib/wear.ts`.
 */

import {
  isOverdue,
  projectIconText,
  rowGutter,
  rowSubline,
  todayLocalISO,
  type Project,
  type RowGutter,
  type Task,
} from '@do-done/shared';
import {
  buildTodayGroups,
  buildUpcomingGroups,
  type WidgetGroup,
} from '@/widgets/widget-layout';
import { LIGHT_THEME, ringColor } from '@/widgets/widget-theme';

/**
 * Bumped when the shape below changes in a way an older watch build cannot
 * read. The watch drops a snapshot whose version it does not know and keeps the
 * last one it understood, which is a stale list rather than an empty one —
 * `wear/.../SnapshotStore.kt` is the other half.
 *
 * The two halves ship separately: the phone bundle goes out over OTA and the
 * watch APK does not, so a phone running ahead of the watch is the ordinary
 * state after every JS release, not an edge case.
 */
export const WEAR_SNAPSHOT_VERSION = 1;

/**
 * How many rows a list may carry.
 *
 * A `DataItem` payload is capped at 100 KB by the Wearable Data Layer, and
 * exceeding it fails the put rather than truncating it — so the whole watch
 * goes stale, silently, for the users with the most tasks.
 *
 * A snapshot carries three lists for two days (see `next`), so up to 240 rows.
 * With every subline part filled in (time, deadline, recurrence, a long project
 * name) and 80-character titles, that measured about 63 KB. The test holds it
 * under 75 KB. Nobody scrolls past forty rows on a watch anyway.
 */
export const WEAR_MAX_ROWS_PER_LIST = 40;

/** A title longer than this is cut at a word boundary. See {@link clampTitle}. */
export const WEAR_MAX_TITLE_CHARS = 80;

export type WearListKey = 'today' | 'upcoming' | 'inbox';

/** One task, as the watch will draw it. No task fields, only presentation. */
export interface WearRow {
  id: string;
  title: string;
  /** `rowSubline`'s parts, already joined. Empty when the task has no others. */
  subline: string;
  /** `rowGutter`'s answer, drawn by the watch as the same four marks. */
  gutter: Exclude<RowGutter, null> | '';
  /** The project's colour as `#rrggbb`, or the deliberate no-project neutral. */
  ring: string;
  /**
   * The project's emoji, or empty.
   *
   * **A Phosphor icon comes through as empty on purpose.** Drawing one needs
   * `PHOSPHOR_PATHS`, ~697 KB of generated path data that would have to be
   * ported into the watch APK to draw a glyph at 14 dp. A bare coloured ring is
   * already a first-class state here (a project with no icon renders exactly
   * that), so the degradation is one the design has a name for rather than a
   * gap.
   */
  icon: string;
}

/** A section header and its rows, mirroring the widgets' `WidgetGroup`. */
export interface WearGroup {
  title: string;
  rows: WearRow[];
}

export interface WearList {
  key: WearListKey;
  title: string;
  groups: WearGroup[];
}

/**
 * The numbers the tile and the complications need, which no list can supply:
 * a complication slot is a few characters on a watch face, not a list.
 */
export interface WearCounts {
  /** Open tasks in the Today universe, overdue included. */
  openToday: number;
  /** Tasks completed today, for the progress ring. */
  doneToday: number;
  /** How many of `openToday` are late. */
  overdue: number;
  /** The head of the Today list — the same task the Next up widget names. */
  nextTitle: string;
}

/**
 * The three lists and the counts, as they read on one day.
 *
 * A snapshot carries two of these: the day it was built on, and the next one.
 */
export interface WearDayView {
  /** The phone's local day this view describes, `YYYY-MM-DD`. */
  day: string;
  /**
   * Epoch ms of the local midnight that ends `day`. Past it, this view is
   * yesterday's: its "Today" group, its overdue count and every "Tomorrow" in a
   * subline are a day off.
   */
  validUntil: number;
  lists: WearList[];
  counts: WearCounts;
}

export interface WearSnapshot extends WearDayView {
  v: number;
  /** Epoch ms, so the watch can say how old the list it is showing is. */
  generatedAt: number;
  /**
   * The same tasks, grouped and worded as they will read after midnight.
   *
   * **This is what keeps the tile and the complications right overnight.**
   * Nothing rebuilds a snapshot at midnight: the phone sends one on a write, on
   * a foreground, or when the watch app asks. So a tile glanced at before the
   * phone is opened in the morning would otherwise show yesterday's Today list.
   * The watch switches to this view at `validUntil` without waking anything,
   * and asks the phone for a fresh snapshot the next time it is drawn.
   *
   * It is a forecast from today's rows, not a second query. Anything that
   * changes a task at midnight on its own (the status-sync sweep) is not in it
   * until the phone sends the real thing.
   */
  next: WearDayView;
}

export interface BuildWearSnapshotInput {
  tasks: Task[];
  projects: Project[];
  /** Defaults to the clock. Tests pass a fixed instant. */
  now?: Date;
}

/**
 * Turn a task list into the three lists, the counts, and every row's finished
 * presentation, for today and for tomorrow.
 *
 * The two dated lists reuse the widgets' grouping rather than re-deriving it,
 * for the reason `buildNextUp` gives: a watch and a home screen showing
 * different answers to "what is next" is worse than either showing nothing.
 *
 * `now` reaches the grouping as well as the rows. If only the rows got it, a
 * task could land in the Overdue group while its own subline read "Today".
 */
export function buildWearSnapshot({
  tasks,
  projects,
  now = new Date(),
}: BuildWearSnapshotInput): WearSnapshot {
  const tomorrow = startOfLocalDay(now, 1);
  return {
    v: WEAR_SNAPSHOT_VERSION,
    generatedAt: now.getTime(),
    ...buildDayView(tasks, projects, now, tomorrow),
    next: buildDayView(tasks, projects, tomorrow, startOfLocalDay(now, 2)),
  };
}

/**
 * Local midnight, `offsetDays` after the day `from` falls on.
 *
 * Built from the date parts rather than by adding 24 hours, so a day with a
 * daylight-saving change still ends at midnight.
 */
function startOfLocalDay(from: Date, offsetDays: number): Date {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + offsetDays);
}

function buildDayView(
  tasks: Task[],
  projects: Project[],
  at: Date,
  end: Date
): WearDayView {
  const todayGroups = buildTodayGroups(tasks, at);
  const upcomingGroups = buildUpcomingGroups(tasks, at);
  const inboxGroups = buildInboxGroups(tasks);

  const lists: WearList[] = [
    { key: 'today', title: 'Today', groups: toGroups(todayGroups, projects, at) },
    {
      key: 'upcoming',
      title: 'Upcoming',
      groups: toGroups(upcomingGroups, projects, at),
    },
    { key: 'inbox', title: 'Inbox', groups: toGroups(inboxGroups, projects, at) },
  ];

  return {
    day: todayLocalISO(at),
    validUntil: end.getTime(),
    lists,
    counts: buildCounts(tasks, todayGroups, at),
  };
}

/**
 * Inbox is one unheaded group, not a grouping.
 *
 * Every other list here is grouped by day, and the Inbox is the one screen in
 * the app that is explicitly *untriaged* — a day header over rows nobody has
 * dated yet would be inventing an axis the list does not have.
 */
function buildInboxGroups(tasks: Task[]): WidgetGroup[] {
  const rows = tasks.filter((t) => t.status === 'inbox' && !t.is_list_item);
  if (rows.length === 0) return [];
  return [{ key: 'inbox', title: '', tasks: rows, namesTheDay: false }];
}

function toGroups(
  groups: WidgetGroup[],
  projects: Project[],
  now: Date
): WearGroup[] {
  const out: WearGroup[] = [];
  let budget = WEAR_MAX_ROWS_PER_LIST;

  for (const group of groups) {
    if (budget <= 0) break;
    const rows = group.tasks
      .slice(0, budget)
      .map((task) => toRow(task, group, projects, now));
    // An empty group still carries a header in the widgets, because there it is
    // a drop target. Nothing on a watch can be dropped into, so an empty
    // section is a line of text that says nothing.
    if (rows.length === 0) continue;
    budget -= rows.length;
    out.push({ title: group.title, rows });
  }
  return out;
}

function toRow(
  task: Task,
  group: WidgetGroup,
  projects: Project[],
  now: Date
): WearRow {
  const project = task.project_id
    ? projects.find((p) => p.id === task.project_id) ?? null
    : null;
  return {
    id: task.id,
    title: clampTitle(task.title),
    // The same three arguments `buildTaskRow` passes, so a row reads the same on
    // the wrist as it does on the home screen.
    subline: rowSubline(task, {
      projectName: project?.name ?? null,
      hideScheduledDay: group.namesTheDay,
      now,
    }).join(' · '),
    gutter: rowGutter(task, now) ?? '',
    // Always the light table. The watch app is dark, but `ringColor`'s dark
    // variant lifts a colour toward white for a dark *card* — on a black watch
    // face that lift washes the twelve palette hues into each other, and the
    // ring is the only thing telling two projects apart.
    ring: ringColor(project, LIGHT_THEME),
    icon: projectIconText(project?.icon),
  };
}

// ── Counts ─────────────────────────────────────────────

function buildCounts(
  tasks: Task[],
  todayGroups: WidgetGroup[],
  now: Date
): WearCounts {
  const open = todayGroups.flatMap((g) => g.tasks);
  const today = todayLocalISO(now);
  return {
    openToday: open.length,
    doneToday: tasks.filter((t) => isDoneOn(t, today)).length,
    overdue: open.filter((t) => isOverdue(t, now)).length,
    nextTitle: open[0] ? clampTitle(open[0].title) : '',
  };
}

/**
 * Completed on the reader's local day, not on a UTC one.
 *
 * `completed_at` is an instant and the watch is asking a calendar question, so
 * this buckets the same way `packages/shared/src/streak.ts` does: a task ticked
 * off at 11pm belongs to the day the user was living in.
 */
function isDoneOn(task: Task, dayISO: string): boolean {
  if (task.status !== 'done' || !task.completed_at || task.is_list_item) {
    return false;
  }
  const at = new Date(task.completed_at);
  if (Number.isNaN(at.getTime())) return false;
  return todayLocalISO(at) === dayISO;
}

// ── Trimming ───────────────────────────────────────────

/**
 * Cut a long title at a word boundary and mark the cut.
 *
 * A watch line holds about twenty characters, so a long title wraps to three or
 * four lines and pushes the next task off the screen. Cutting mid-word reads as
 * a rendering fault rather than as a shortened title, which is why the boundary
 * is looked for before falling back to a hard cut.
 */
export function clampTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= WEAR_MAX_TITLE_CHARS) return trimmed;
  const cut = trimmed.slice(0, WEAR_MAX_TITLE_CHARS);
  const space = cut.lastIndexOf(' ');
  // A single very long word has no boundary to find; a hard cut is all there is.
  return (space > WEAR_MAX_TITLE_CHARS / 2 ? cut.slice(0, space) : cut) + '…';
}
