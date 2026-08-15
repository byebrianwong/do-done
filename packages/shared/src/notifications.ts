// ── Notification settings and digest copy ────────────────
//
// Two digests, both off by default: a **daily** one naming what is on today,
// and a **weekly** one shaped like the week ahead. Settings live on
// `user_preferences` (`notify_*`); the copy is built here so a digest can't
// read one way on the phone and another on the laptop — and, more immediately,
// so the date arithmetic and the wording are testable in node, which is the
// only place `apps/mobile` can test anything (see CLAUDE.md → Testing).
//
// **A digest with nothing to report is not sent.** A notification that arrives
// every morning to say the day is empty is the fastest possible way to get the
// feature switched off, and it teaches the user to swipe the app's
// notifications away unread — which is also how the location reminders stop
// working. Both builders return `null` for an empty window and the scheduler
// skips that occurrence. The settings screen says so, so silence still reads
// as the rule rather than as a bug.

import {
  CLOCK_TIME_PATTERN,
  NotificationSettingsSchema,
  type NotificationSettings,
  type Task,
} from "./schemas.js";

// ── Clock times ────────────────────────────────────────
//
// A digest time is a *wall-clock* time in the user's own timezone, stored as
// `HH:MM` text. Not a Postgres `time` (which PostgREST hands back as
// "08:00:00", a third format for every consumer to strip) and not a minutes-
// past-midnight integer (which nothing can read in a psql session).

export interface ClockTime {
  hour: number;
  minute: number;
}

/** `"08:30"` → `{ hour: 8, minute: 30 }`. Null on anything else. */
export function parseClockTime(value: string): ClockTime | null {
  const m = CLOCK_TIME_PATTERN.exec(value);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/** `{ hour: 8, minute: 30 }` → `"08:30"`. The storage form. */
export function formatClockTime(hour: number, minute: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(hour)}:${p(minute)}`;
}

/**
 * `"08:30"` → `"8:30 AM"`. The display form, written by hand rather than via
 * `Intl` so a settings row reads the same on Hermes as it does in a test.
 */
export function formatClockLabel(value: string): string {
  const t = parseClockTime(value);
  if (!t) return value;
  const suffix = t.hour < 12 ? "AM" : "PM";
  const h12 = t.hour % 12 === 0 ? 12 : t.hour % 12;
  return `${h12}:${String(t.minute).padStart(2, "0")} ${suffix}`;
}

/** 0 = Sunday, matching `user_preferences.week_end_day` and `Date#getDay`. */
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const WEEKDAY_SHORT_NAMES = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

/**
 * The weekday of a `YYYY-MM-DD` date string, 0 = Sunday.
 *
 * Parsed as UTC deliberately. `new Date("2026-08-15")` is already UTC midnight,
 * but `new Date("2026-08-15T00:00:00")` is *local* midnight, and the two
 * disagree about the weekday for every user west of Greenwich. A date-only
 * string names a calendar day with no instant attached, so the only safe way
 * to read a weekday off it is to keep both ends in the same frame.
 */
export function weekdayOfISO(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** `dateISO` shifted by `days`, staying in the same UTC frame as above. */
export function shiftISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const at = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

// ── Settings ───────────────────────────────────────────
//
// `NotificationSettingsSchema` itself lives in schemas.ts, beside
// `StatusSyncSettingsSchema` and for the same reason — `UserPreferencesSchema`
// extends it, and this module needs `Task` from there.

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings =
  NotificationSettingsSchema.parse({});

/**
 * Read digest settings off anything shaped like a preferences row — a real
 * `UserPreferences`, a `select("*")` against a database that hasn't run the
 * migration yet, or null.
 *
 * Every field carries its own `.catch()`, unlike `parseStatusSyncSettings`,
 * which resets the whole object when any one field is bad. The difference is
 * what a reset costs: there, defaults mean "the rule is off", which is safe.
 * Here it would silently switch off a digest the user *did* turn on, and the
 * only symptom is a notification that stops arriving — the exact failure this
 * whole change exists to fix.
 */
export function parseNotificationSettings(row: unknown): NotificationSettings {
  const result = NotificationSettingsSchema.safeParse(row ?? {});
  return result.success ? result.data : DEFAULT_NOTIFICATION_SETTINGS;
}

/** True when there is any digest to schedule at all. */
export function isDigestEnabled(settings: NotificationSettings): boolean {
  return settings.notify_daily_digest || settings.notify_weekly_digest;
}

// ── Digest copy ────────────────────────────────────────

export interface DigestContent {
  title: string;
  body: string;
}

const CLOSED_STATUSES = new Set(["done", "cancelled", "archived"]);

/** How many task titles a body names before it collapses into "+N more". */
export const DIGEST_BODY_TASKS = 3;

function isOpen(task: Task): boolean {
  return !CLOSED_STATUSES.has(task.status);
}

/**
 * The dates a task answers to. A task has two independent date fields and
 * either can put it on a day — see CLAUDE.md → Dates. Mirrors the `.or(...)`
 * in `TasksApi.getToday` / `getDatedBetween` so the digest counts exactly the
 * rows those views would show.
 */
function taskDates(task: Task): string[] {
  const out: string[] = [];
  if (task.scheduled_date) out.push(task.scheduled_date);
  if (task.deadline_date) out.push(task.deadline_date);
  return out;
}

function landsOnOrBefore(task: Task, dateISO: string): boolean {
  return taskDates(task).some((d) => d <= dateISO);
}

function landsBefore(task: Task, dateISO: string): boolean {
  return taskDates(task).some((d) => d < dateISO);
}

function landsWithin(task: Task, startISO: string, endISO: string): boolean {
  return taskDates(task).some((d) => d >= startISO && d <= endISO);
}

/**
 * The day a task counts toward in a weekly digest: its scheduled day when it
 * has one, its deadline otherwise. Same precedence the rest of the app uses —
 * `scheduled_date` is the day the user plans to *do* it.
 */
function bucketDate(task: Task): string | null {
  return task.scheduled_date ?? task.deadline_date ?? null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** P1/P2 are the ranks someone deliberately chose. See CLAUDE.md → The task row. */
function isHighPriority(task: Task): boolean {
  return task.priority === "p1" || task.priority === "p2";
}

/**
 * Order the tasks a body names: overdue first, then by priority, then by the
 * order the list itself would use. The first three titles are the whole
 * payload most people will read, so they have to be the three that matter.
 */
function rankForBody(tasks: Task[], todayISO: string): Task[] {
  const rank = (t: Task) => {
    const overdue = landsBefore(t, todayISO) ? 0 : 1;
    const p = Number((t.priority ?? "p4").slice(1)) || 4;
    return overdue * 10 + p;
  };
  return [...tasks].sort(
    (a, b) => rank(a) - rank(b) || (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
}

function namesAndMore(tasks: Task[]): string {
  const named = tasks.slice(0, DIGEST_BODY_TASKS).map((t) => t.title);
  const rest = tasks.length - named.length;
  if (rest > 0) named.push(`+${rest} more`);
  return named.join(" · ");
}

/**
 * The daily digest for `dateISO`, or null when that day has nothing on it.
 *
 * `tasks` may be any superset of the relevant rows — the caller arms several
 * days from one query, so filtering happens here rather than per fetch.
 * "On today" means the same thing it means in the Today view: scheduled or
 * deadlined on or before the day, overdue included, nothing closed.
 */
export function buildDailyDigest(
  tasks: Task[],
  dateISO: string
): DigestContent | null {
  const relevant = tasks.filter(
    (t) => isOpen(t) && !t.is_list_item && landsOnOrBefore(t, dateISO)
  );
  if (relevant.length === 0) return null;

  const overdue = relevant.filter((t) => landsBefore(t, dateISO));
  const onDay = relevant.length - overdue.length;

  const parts: string[] = [];
  if (onDay > 0) parts.push(plural(onDay, "task"));
  if (overdue.length > 0) parts.push(`${overdue.length} overdue`);

  const high = relevant.filter(isHighPriority).length;
  const bodyParts = [namesAndMore(rankForBody(relevant, dateISO))];
  if (high > 0) bodyParts.push(`${high} high priority`);

  return {
    title: `Today · ${parts.join(", ")}`,
    body: bodyParts.join(" — "),
  };
}

/**
 * The weekly digest for the inclusive window `[startISO, endISO]`, or null
 * when the week is empty.
 *
 * The body is a per-day shape rather than a list of titles: a week is too many
 * tasks to name, and "which day is the heavy one" is the thing a week-ahead
 * view is actually for. Days with nothing on them are left out — printing
 * "Thu 0" spends the line on the days that need no attention.
 */
export function buildWeeklyDigest(
  tasks: Task[],
  startISO: string,
  endISO: string
): DigestContent | null {
  const inWeek = tasks.filter(
    (t) => isOpen(t) && !t.is_list_item && landsWithin(t, startISO, endISO)
  );
  const overdue = tasks.filter(
    (t) => isOpen(t) && !t.is_list_item && landsBefore(t, startISO)
  );
  if (inWeek.length === 0 && overdue.length === 0) return null;

  const counts = new Map<string, number>();
  for (const t of inWeek) {
    // A task can land in the window by either date; bucket it on the day the
    // user plans to do it, which is the day they'd expect to see it counted.
    const day = bucketDate(t);
    if (!day || day < startISO || day > endISO) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const shape: string[] = [];
  for (let d = startISO; d <= endISO; d = shiftISO(d, 1)) {
    const n = counts.get(d);
    if (n) shape.push(`${WEEKDAY_SHORT_NAMES[weekdayOfISO(d)]} ${n}`);
  }

  const titleParts: string[] = [];
  if (inWeek.length > 0) titleParts.push(plural(inWeek.length, "task"));
  if (overdue.length > 0) titleParts.push(`${overdue.length} overdue`);

  const bodyParts: string[] = [];
  if (shape.length > 0) bodyParts.push(shape.join(" · "));
  const high = inWeek.filter(isHighPriority).length;
  if (high > 0) bodyParts.push(`${high} high priority`);
  if (bodyParts.length === 0) bodyParts.push("Nothing scheduled — clear week");

  return {
    title: `This week · ${titleParts.join(", ")}`,
    body: bodyParts.join(" — "),
  };
}

/** One-line summary of the schedule, for the settings screen. */
export function describeDigestSchedule(
  settings: NotificationSettings
): string {
  const bits: string[] = [];
  if (settings.notify_daily_digest) {
    bits.push(`Daily at ${formatClockLabel(settings.notify_daily_digest_time)}`);
  }
  if (settings.notify_weekly_digest) {
    bits.push(
      `${WEEKDAY_NAMES[settings.notify_weekly_digest_weekday]}s at ${formatClockLabel(
        settings.notify_weekly_digest_time
      )}`
    );
  }
  return bits.length > 0 ? bits.join(" · ") : "Off";
}
