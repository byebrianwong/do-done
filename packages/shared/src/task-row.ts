import type { Task } from "./schemas.js";
import { STATUS_CONFIG } from "./constants.js";
import {
  formatCompletedDate,
  formatDuration,
  formatRelativeDay,
  formatTimeOfDay,
  isOverdue,
} from "./utils.js";

/**
 * The task row's two decisions, as pure functions.
 *
 * A row has one slot for identity (the ring: the project's colour, and its
 * emoji when it has one) and one narrow gutter for urgency. Everything else
 * that used to be a chip is now a single line of prose under the title, which
 * is what `rowSubline` builds.
 *
 * These live here rather than in the row component because `apps/mobile` has
 * no renderer to test a component with, and because web will want the same
 * answers when its row follows.
 */

// ── The gutter ─────────────────────────────────────────

/**
 * What the leading gutter draws, or null for the great majority of rows.
 *
 * Priority is ordinal, so it is encoded by position and length here rather
 * than by hue in the ring — hue is a nominal channel and the ring already
 * spends it on the project.
 *
 * **P4 deliberately renders nothing, and P3 does.** They are not a matched
 * pair, whatever the names suggest: `tasks.priority` is `not null default
 * 'p4'`, so P4 is what a task gets by *not* being triaged — the widget, a
 * deep link and every MCP create land there. A mark for P4 would be a mark
 * for absence, on very nearly every row in the app, and a signal that fires
 * everywhere has stopped being one. P3 is the lowest rank someone actually
 * chose, so it is the lowest one worth drawing.
 *
 * P4 is one value doing two jobs — the rank called "Low", and the absence of a
 * choice — and nothing can tell them apart, because a task cannot *not* have a
 * priority: the column is `not null default 'p4'`, there is no null and no
 * `none`. Splitting the two apart would let all four ranks draw here, and it
 * is a migration plus every priority surface; until someone wants that, this
 * is the honest line.
 */
export type RowGutter = "overdue" | "p1" | "p2" | "p3" | null;

/**
 * Overdue outranks priority, and it is the only thing in this column that is
 * ever red. A P1 that is merely urgent gets a red *bar*; a task that is late
 * gets the dot — one column, one meaning, two weights.
 */
export function rowGutter(task: Task, now: Date = new Date()): RowGutter {
  if (task.status === "done" || task.status === "cancelled") return null;
  if (isOverdue(task, now)) return "overdue";
  if (task.priority === "p1") return "p1";
  if (task.priority === "p2") return "p2";
  if (task.priority === "p3") return "p3";
  return null;
}

// ── Dates, said the short way ───────────────────────────

/**
 * A compact calendar label: "Today", "Tomorrow", "Yesterday", then "Fri Aug 14"
 * within the coming week and "Aug 27" beyond it. Deliberately shorter than
 * `formatRelativeDay` ("in 3 days"), which is prose for a sentence rather
 * than a label meant to be scanned down a column.
 *
 * The near days carry the weekday **and** the date, per the rule
 * `formatCompletedDate` already follows: a bare "Fri" reads as a day of the
 * week with no way to tell *which* one from a list that spans several.
 *
 * Returns "" for an unparseable date so callers can drop the part entirely.
 */
export function shortDayLabel(date: string, now: Date = new Date()): string {
  const target = new Date(date + "T00:00:00");
  if (Number.isNaN(target.getTime())) return "";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const sameYear = target.getFullYear() === today.getFullYear();
  return target.toLocaleDateString("en-US", {
    ...(diff > 1 && diff < 7 ? { weekday: "short" } : {}),
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

// ── Recurrence ─────────────────────────────────────────

/**
 * The recurrence presets both the editor's picker and the row's subline read
 * from. They live here so the label a row prints can never drift from the
 * option the picker set.
 */
export const RECURRENCE_PRESETS: { label: string; rule: string | null }[] = [
  { label: "None", rule: null },
  { label: "Daily", rule: "FREQ=DAILY" },
  { label: "Weekdays", rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  { label: "Weekly", rule: "FREQ=WEEKLY" },
  { label: "Monthly", rule: "FREQ=MONTHLY" },
];

export function recurrenceShortLabel(rule: string | null): string {
  if (!rule) return "None";
  return RECURRENCE_PRESETS.find((p) => p.rule === rule)?.label ?? "Custom";
}

// ── The subline ────────────────────────────────────────

export interface RowSublineContext {
  /**
   * The project's name, or null/undefined to leave it out — which is what a
   * project-grouped list wants, since its header already said it.
   */
  projectName?: string | null;
  /**
   * Drop the scheduled *day* and keep only its time — for a surface that has
   * already named the day this row is on: a section header reading "Tomorrow",
   * or the Today screen itself. The date-shaped twin of `projectName: null`.
   *
   * **This is the only thing that hides a day, and it is the caller's call.**
   * `schedulePart` used to swallow "Today" wherever it appeared, on the
   * reasoning that the word carries nothing on the Today screen — which is
   * true there and wrong everywhere else. On Inbox, All, a project, a tag or
   * a search result, a task scheduled today then rendered exactly like an
   * undated one, while tomorrow's said "Tomorrow": the one day a list most
   * needs to point out was the one day it didn't.
   *
   * An overdue row ignores this and still prints its age — "Overdue" is not a
   * date, and how late a task is is the one genuinely actionable thing those
   * rows say.
   *
   * Deliberately does not touch the deadline, which is a different field and
   * a different day.
   */
  hideScheduledDay?: boolean;
  now?: Date;
}

/**
 * Every secondary fact about a task, as the parts of one muted line, in the
 * order a person would say them. The caller joins with a middot.
 *
 * The rule that matters is that **an unset field contributes nothing** — no
 * placeholder, no empty chip, no reserved space. Most tasks have a title and
 * one other fact, so most rows are one short line; the row that genuinely
 * carries five things is the row that earns five.
 *
 * A finished task says when it was finished and stops. Its scheduled date is
 * no longer actionable and printing it would label most of a Completed list
 * "3 days ago", which says nothing about the work.
 */
/**
 * The labels `formatCompletedDate` returns that are words rather than dates,
 * and so read as part of the sentence "Done …" rather than as a date.
 */
const RELATIVE_COMPLETED = new Set(["Today", "Yesterday"]);

export function rowSubline(
  task: Task,
  ctx: RowSublineContext = {}
): string[] {
  const now = ctx.now ?? new Date();
  const parts: string[] = [];

  if (task.status === "done") {
    const when = task.completed_at
      ? formatCompletedDate(task.completed_at, now)
      : "";
    // "Done today" reads better than "Done Today", but only the relative
    // words are a sentence fragment — lowercasing everything turned a real
    // date into "Done fri, aug 7", which reads as a typo sitting directly
    // above a correctly-cased one.
    parts.push(when ? `Done ${RELATIVE_COMPLETED.has(when) ? when.toLowerCase() : when}` : "Done");
  } else if (task.status === "cancelled") {
    parts.push("Cancelled");
  } else {
    const when = schedulePart(task, now, ctx.hideScheduledDay ?? false);
    if (when) parts.push(when);
    if (task.deadline_date) {
      const label = shortDayLabel(task.deadline_date, now);
      if (label) parts.push(`Deadline ${label}`);
    }
  }

  if (task.recurrence_rule) {
    parts.push(`Repeats ${recurrenceShortLabel(task.recurrence_rule).toLowerCase()}`);
  }
  if (ctx.projectName) parts.push(ctx.projectName);

  // Status is worth saying only when the user moved it somewhere deliberate.
  // "Not started" is the default and "Inbox" is already the screen you're on.
  if (
    task.status !== "not_started" &&
    task.status !== "inbox" &&
    task.status !== "done" &&
    task.status !== "cancelled"
  ) {
    parts.push(STATUS_CONFIG[task.status].label);
  }

  return parts;
}

/**
 * The scheduled day and time, said as briefly as it can be.
 *
 * "Today" is a day like any other here — it is dropped only where the surface
 * says it already named the day (`hideScheduledDay`), never on the strength of
 * being today. An overdue task prints its age instead of its date, because
 * "3 days ago" is the actionable form, and it says so under a header too:
 * "Overdue" names no day for the row to be repeating.
 */
function schedulePart(task: Task, now: Date, hideDay: boolean): string {
  const date = task.scheduled_date;
  const time = task.scheduled_time ? formatTimeOfDay(task.scheduled_time) : "";
  if (!date) return time;

  if (isOverdue(task, now)) {
    const age = formatRelativeDay(date, now);
    const phrase = age ? capitalise(age) : shortDayLabel(date, now);
    return time ? `${phrase}, ${time}` : phrase;
  }
  // The caller's header has already named this day, so the time — if there is
  // one — is the only part left that says anything.
  if (hideDay) return time;

  const day = shortDayLabel(date, now);
  return time ? `${day} ${time}` : day;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The row's right-hand column: one estimate, or nothing. Kept here so the
 * tabular figures a list lines up are always formatted the same way.
 */
export function rowEstimate(task: Task): string {
  return task.duration_minutes ? formatDuration(task.duration_minutes) : "";
}
