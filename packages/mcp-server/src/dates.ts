// Date rendering for the MCP surface.
//
// A model reading `{"when_date": "2026-08-03"}` has no way to know whether that
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
  task: Pick<Task, "status" | "when_date" | "due_date">,
  todayISO: string
): boolean {
  if (!isActiveTask(task)) return false;
  if (task.due_date && task.due_date < todayISO) return true;
  if (task.when_date && task.when_date < todayISO) return true;
  return false;
}

export interface TaskDates {
  /** The day the user planned to do this, `YYYY-MM-DD`, or null. */
  when_date: string | null;
  when_time: string | null;
  /** The hard deadline, `YYYY-MM-DD`, or null. */
  due_date: string | null;
  due_time: string | null;
  /** when_date relative to today, e.g. "tomorrow". Null when undated. */
  when_relative: string | null;
  /** due_date relative to today. Null when there is no deadline. */
  due_relative: string | null;
  overdue: boolean;
  /** One-line prose rendering, safe to show a model verbatim. */
  summary: string;
}

/**
 * Everything a caller needs to talk about a task's dates without doing date
 * arithmetic of its own.
 *
 * The prose reads "scheduled for …" for when_date and "due …" for due_date,
 * kept deliberately distinct: conflating the two is what makes a scheduled task
 * get reported as having no date at all.
 */
export function summarizeTaskDates(
  task: Pick<
    Task,
    "status" | "when_date" | "when_time" | "due_date" | "due_time"
  >,
  todayISO: string
): TaskDates {
  const overdue = isOverdueOn(task, todayISO);
  const parts: string[] = [];

  if (task.when_date) {
    const at = task.when_time ? ` at ${task.when_time}` : "";
    parts.push(`scheduled for ${formatDate(task.when_date, todayISO)}${at}`);
  }
  if (task.due_date) {
    const at = task.due_time ? ` at ${task.due_time}` : "";
    parts.push(`due ${formatDate(task.due_date, todayISO)}${at}`);
  }
  if (parts.length === 0) parts.push("no date set");
  if (overdue) parts.push("OVERDUE");

  return {
    when_date: task.when_date,
    when_time: task.when_time,
    due_date: task.due_date,
    due_time: task.due_time,
    when_relative: task.when_date
      ? relativeDayLabel(task.when_date, todayISO)
      : null,
    due_relative: task.due_date
      ? relativeDayLabel(task.due_date, todayISO)
      : null,
    overdue,
    summary: parts.join(" · "),
  };
}

/**
 * A task with its dates resolved against today — the JSON shape the list and
 * search tools return. The raw `when_date`/`due_date` columns are already on
 * the task, so only the derived reading is added.
 */
export function withResolvedDates(
  task: Task,
  todayISO: string
): Task & {
  dates: Pick<
    TaskDates,
    "when_relative" | "due_relative" | "overdue" | "summary"
  >;
} {
  const { when_relative, due_relative, overdue, summary } = summarizeTaskDates(
    task,
    todayISO
  );
  return { ...task, dates: { when_relative, due_relative, overdue, summary } };
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
export type AgendaReason = "when" | "due" | "when+due";

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
      .filter((t) => t.when_date === date || t.due_date === date)
      .map<AgendaEntry>((task) => ({
        task,
        reason:
          task.when_date === date && task.due_date === date
            ? "when+due"
            : task.when_date === date
              ? "when"
              : "due",
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
      lines.push("Nothing scheduled or due.");
    } else {
      for (const { task, reason } of day.entries) {
        const marker =
          reason === "when+due"
            ? "scheduled + due"
            : reason === "when"
              ? "scheduled"
              : "due";
        const at =
          (reason === "due" ? task.due_time : task.when_time) ?? null;
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
