// Date rendering for the MCP surface.
//
// A model reading `{"scheduled_date": "2026-08-03"}` has no way to know whether that
// is today, and asking it to compare against its own idea of the date is how
// "what do I have today?" ends up answered with "nothing seems to be dated".
// So every date the tools emit is paired with a relative label resolved against
// one explicit `today` — the user's timezone-correct day, passed in by the
// caller rather than read from the process clock (the hosted transport runs in
// UTC).
//
// Everything here is pure and takes `todayISO` explicitly, which is also what
// makes it testable without freezing the system clock.

import type { Task } from "@do-done/shared";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Parse `YYYY-MM-DD` as a UTC midnight instant. Null if unparseable. */
function parseISODate(dateISO: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (Number.isNaN(date.getTime())) return null;
  // Reject overflow ("2026-02-31" → Mar 3) so a bad date reads as bad.
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) {
    return null;
  }
  return date;
}

/**
 * Signed whole-day distance from `fromISO` to `toISO`: 0 = same day, positive =
 * `toISO` is later. Both ends are plain calendar dates, so this is exact — no
 * DST or timezone term enters into it.
 */
export function daysBetweenISO(fromISO: string, toISO: string): number | null {
  const from = parseISODate(fromISO);
  const to = parseISODate(toISO);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** Day of the week `dateISO` falls on, e.g. "Monday". Null if unparseable. */
export function weekdayName(dateISO: string): string | null {
  const date = parseISODate(dateISO);
  return date ? WEEKDAYS[date.getUTCDay()]! : null;
}

/**
 * `dateISO` described relative to `todayISO`: "today", "tomorrow",
 * "yesterday", "in 3 days", "5 days ago". Returns null for an unparseable date.
 */
export function relativeDayLabel(
  dateISO: string,
  todayISO: string
): string | null {
  const delta = daysBetweenISO(todayISO, dateISO);
  if (delta === null) return null;
  if (delta === 0) return "today";
  if (delta === 1) return "tomorrow";
  if (delta === -1) return "yesterday";
  if (delta > 0) return `in ${delta} days`;
  return `${-delta} days ago`;
}

/** `2026-08-07 (Friday, in 4 days)` — the full rendering of a single date. */
export function formatDate(dateISO: string, todayISO: string): string {
  const weekday = weekdayName(dateISO);
  const relative = relativeDayLabel(dateISO, todayISO);
  const qualifiers = [weekday, relative].filter(Boolean).join(", ");
  return qualifiers ? `${dateISO} (${qualifiers})` : dateISO;
}

/** A task is closed when it can no longer be worked on. */
export function isActiveTask(task: Pick<Task, "status">): boolean {
  return task.status !== "done" && task.status !== "cancelled";
}

/**
 * Timezone-explicit twin of `isOverdue` from @do-done/shared, which resolves
 * "today" from the process clock — wrong on the hosted transport, where the
 * process runs in UTC and the user does not.
 */
export function isOverdueOn(
  task: Pick<Task, "status" | "scheduled_date" | "deadline_date">,
  todayISO: string
): boolean {
  if (!isActiveTask(task)) return false;
  if (task.deadline_date && task.deadline_date < todayISO) return true;
  if (task.scheduled_date && task.scheduled_date < todayISO) return true;
  return false;
}

export interface TaskDates {
  /** The day the user planned to do this, `YYYY-MM-DD`, or null. */
  scheduled_date: string | null;
  scheduled_time: string | null;
  /** The hard deadline, `YYYY-MM-DD`, or null. */
  deadline_date: string | null;
  deadline_time: string | null;
  /** scheduled_date relative to today, e.g. "tomorrow". Null when undated. */
  scheduled_relative: string | null;
  /** deadline_date relative to today. Null when there is no deadline. */
  deadline_relative: string | null;
  overdue: boolean;
  /** One-line prose rendering, safe to show a model verbatim. */
  summary: string;
}

/**
 * Everything a caller needs to talk about a task's dates without doing date
 * arithmetic of its own.
 *
 * The prose reads "scheduled for …" for scheduled_date and "deadline …" for
 * deadline_date, kept deliberately distinct: conflating the two is what makes a
 * scheduled task get reported as having no date at all.
 */
export function summarizeTaskDates(
  task: Pick<
    Task,
    "status" | "scheduled_date" | "scheduled_time" | "deadline_date" | "deadline_time"
  >,
  todayISO: string
): TaskDates {
  const overdue = isOverdueOn(task, todayISO);
  const parts: string[] = [];

  if (task.scheduled_date) {
    const at = task.scheduled_time ? ` at ${task.scheduled_time}` : "";
    parts.push(`scheduled for ${formatDate(task.scheduled_date, todayISO)}${at}`);
  }
  if (task.deadline_date) {
    const at = task.deadline_time ? ` at ${task.deadline_time}` : "";
    parts.push(`deadline ${formatDate(task.deadline_date, todayISO)}${at}`);
  }
  if (parts.length === 0) parts.push("no date set");
  if (overdue) parts.push("OVERDUE");

  return {
    scheduled_date: task.scheduled_date,
    scheduled_time: task.scheduled_time,
    deadline_date: task.deadline_date,
    deadline_time: task.deadline_time,
    scheduled_relative: task.scheduled_date
      ? relativeDayLabel(task.scheduled_date, todayISO)
      : null,
    deadline_relative: task.deadline_date
      ? relativeDayLabel(task.deadline_date, todayISO)
      : null,
    overdue,
    summary: parts.join(" · "),
  };
}

/**
 * A task with its dates resolved against today — the JSON shape the list and
 * search tools return. The raw `scheduled_date`/`deadline_date` columns are already on
 * the task, so only the derived reading is added.
 */
export function withResolvedDates(
  task: Task,
  todayISO: string
): Task & {
  dates: Pick<
    TaskDates,
    "scheduled_relative" | "deadline_relative" | "overdue" | "summary"
  >;
} {
  const { scheduled_relative, deadline_relative, overdue, summary } = summarizeTaskDates(
    task,
    todayISO
  );
  return { ...task, dates: { scheduled_relative, deadline_relative, overdue, summary } };
}

/**
 * `[p1] Clean up room — scheduled for 2026-08-03 (Monday, today) (id: …)`
 * Unprefixed, so callers can bullet or number it as they like.
 */
export function describeTask(task: Task, todayISO: string): string {
  const { summary } = summarizeTaskDates(task, todayISO);
  return `[${task.priority}] ${task.title} — ${summary} (id: ${task.id})`;
}

/** Why a task landed on a given agenda day. */
export type AgendaReason = "scheduled" | "deadline" | "scheduled+deadline";

export interface AgendaEntry {
  task: Task;
  reason: AgendaReason;
}

export interface AgendaDay {
  date: string;
  weekday: string | null;
  relative: string | null;
  entries: AgendaEntry[];
}

export interface Agenda {
  todayISO: string;
  timezone: string;
  overdue: Task[];
  days: AgendaDay[];
}

/** `YYYY-MM-DD` for the given UTC-midnight instant. */
function toISO(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`;
}

/**
 * The calendar date `days` after `dateISO` (negative goes back). Returns
 * `dateISO` unchanged if it isn't a parseable date.
 */
export function addDaysISO(dateISO: string, days: number): string {
  const base = parseISODate(dateISO);
  if (!base) return dateISO;
  return toISO(new Date(base.getTime() + days * 86_400_000));
}

/** `days` consecutive ISO dates starting at `startISO`. */
function dateRange(startISO: string, days: number): string[] {
  const start = parseISODate(startISO);
  if (!start) return [];
  return Array.from({ length: days }, (_, i) =>
    toISO(new Date(start.getTime() + i * 86_400_000))
  );
}

export interface BuildAgendaOptions {
  todayISO: string;
  timezone: string;
  startISO: string;
  days: number;
  includeOverdue?: boolean;
}

/**
 * Bucket tasks into "overdue" plus one bucket per day in the window.
 *
 * A task lands on a day if *either* of its dates falls there, and `reason`
 * records which — so a task scheduled Monday against a Friday deadline shows up
 * on both days, correctly labelled each time. Overdue tasks are pulled out
 * first and never double-counted into a day bucket: their dates are in the past
 * and would otherwise fall outside the window entirely, which is exactly how
 * overdue work goes missing from an agenda.
 */
export function buildAgenda(
  tasks: Task[],
  {
    todayISO,
    timezone,
    startISO,
    days,
    includeOverdue = true,
  }: BuildAgendaOptions
): Agenda {
  const active = tasks.filter(isActiveTask);
  const overdue = includeOverdue
    ? active.filter((t) => isOverdueOn(t, todayISO))
    : [];
  const overdueIds = new Set(overdue.map((t) => t.id));
  const remaining = active.filter((t) => !overdueIds.has(t.id));

  const buckets = dateRange(startISO, days).map<AgendaDay>((date) => {
    const entries = remaining
      .filter((t) => t.scheduled_date === date || t.deadline_date === date)
      .map<AgendaEntry>((task) => ({
        task,
        reason:
          task.scheduled_date === date && task.deadline_date === date
            ? "scheduled+deadline"
            : task.scheduled_date === date
              ? "scheduled"
              : "deadline",
      }));
    return {
      date,
      weekday: weekdayName(date),
      relative: relativeDayLabel(date, todayISO),
      entries,
    };
  });

  return { todayISO, timezone, overdue, days: buckets };
}

/** Human-readable agenda, the text a tool hands back. */
export function renderAgenda(agenda: Agenda): string {
  const { todayISO, timezone, overdue, days } = agenda;
  const lines: string[] = [
    `Today is ${formatDate(todayISO, todayISO)} in ${timezone}.`,
    "",
  ];

  if (overdue.length > 0) {
    lines.push(`## Overdue (${overdue.length})`, "");
    for (const task of overdue) lines.push(`- ${describeTask(task, todayISO)}`);
    lines.push("");
  }

  for (const day of days) {
    const heading = [day.date, day.weekday, day.relative]
      .filter(Boolean)
      .join(" · ");
    lines.push(`## ${heading}`, "");
    if (day.entries.length === 0) {
      lines.push("Nothing scheduled, no deadline.");
    } else {
      for (const { task, reason } of day.entries) {
        const marker =
          reason === "scheduled+deadline"
            ? "scheduled + deadline"
            : reason === "scheduled"
              ? "scheduled"
              : "deadline";
        const at =
          (reason === "deadline" ? task.deadline_time : task.scheduled_time) ??
          null;
        lines.push(
          `- [${task.priority}] ${task.title} — ${marker}${at ? ` at ${at}` : ""} (id: ${task.id})`
        );
      }
    }
    lines.push("");
  }

  const empty =
    overdue.length === 0 && days.every((d) => d.entries.length === 0);
  if (empty) {
    lines.push(
      "Nothing dated in this window. Tasks with no date at all are not listed here — call list_tasks to see those."
    );
  }

  return lines.join("\n").trimEnd();
}
