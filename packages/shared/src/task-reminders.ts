// ── Per-task reminders ───────────────────────────────────
//
// The digests in notifications.ts describe a *day*: "Today · 4 tasks". These
// describe a *task*: on the day it is scheduled, at the time it is scheduled
// for. Two shapes, because DoDone's tasks come in two shapes:
//
//   timed    a task with a time of day fires at that time, less the user's
//            lead ("Standup — in 10 min").
//   untimed  a task scheduled for a day with no time has no instant of its
//            own, so it is named in one grouped roundup at the day's start.
//
// **The roundup is one notification, not N.** Most tasks in DoDone carry a
// scheduled_date and no scheduled_time, so a notification each would mean ten
// at 09:00 on an ordinary Tuesday. A channel that behaves like that gets muted
// within a week, and muting it also silences the timed reminders that are the
// reason the feature exists.
//
// Everything here is pure so it can be tested in node — which, for the phone,
// is the only place anything can be tested at all (CLAUDE.md → Testing) — and
// so the copy cannot read one way on the phone and another on the laptop.

import type { NotificationSettings, Task } from "./schemas.js";
import { describeDigestSchedule, shiftISO } from "./notifications.js";

/** How many task titles a roundup names before it collapses into "+N more". */
export const ROUNDUP_BODY_TASKS = 3;

const CLOSED_STATUSES = new Set(["done", "cancelled", "archived"]);

/**
 * `"09:30"` → `{ hour: 9, minute: 30 }`.
 *
 * Deliberately more tolerant than `parseClockTime`: `tasks.scheduled_time` is a
 * free `text` column that the Google Calendar pull also writes into, so a value
 * may arrive as `"09:30:00"`. A reminder silently not arming because of a
 * trailing `:00` is exactly the kind of failure nobody would reproduce.
 */
export function parseTaskClock(
  value: string | null | undefined
): { hour: number; minute: number } | null {
  if (!value) return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value.trim());
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/**
 * The day and optional time a task's reminder hangs off, or null if it has
 * none.
 *
 * `scheduled_*` beats `deadline_*`, the same precedence `bucketDate` uses in
 * the weekly digest and that the rest of the app uses everywhere: the scheduled
 * day is the day the user plans to *do* the task (CLAUDE.md → Dates). Falling
 * through to the deadline rather than ignoring it means a task with a hard
 * external cutoff and no plan still gets announced — that is the one date
 * whose arrival the user least wants to discover afterwards.
 *
 * A task is never announced twice: one anchor per task, whichever pair won.
 */
export function reminderAnchor(
  task: Task
): { dateISO: string; time: string | null; from: "scheduled" | "deadline" } | null {
  if (task.scheduled_date) {
    return {
      dateISO: task.scheduled_date,
      time: task.scheduled_time ?? null,
      from: "scheduled",
    };
  }
  if (task.deadline_date) {
    return {
      dateISO: task.deadline_date,
      time: task.deadline_time ?? null,
      from: "deadline",
    };
  }
  return null;
}

/**
 * Whether a task can be announced at all.
 *
 * A **list item is never announced.** A shopping list is standing — it empties
 * and refills forever — and the isolation rule is that its items stay out of
 * the task universe entirely (CLAUDE.md → Shopping lists). A notification is
 * the loudest surface in the app, so it is the last place a tin of tomatoes
 * should turn up.
 */
export function isRemindable(task: Task): boolean {
  if (CLOSED_STATUSES.has(task.status)) return false;
  if (task.is_list_item) return false;
  return reminderAnchor(task) !== null;
}

/**
 * A wall-clock reminder moment: the calendar day and clock time it reads, in
 * the user's own timezone. Resolving that to an absolute instant needs the
 * timezone and belongs to the caller — see `apps/mobile/lib/task-reminder-plan.ts`.
 */
export interface ReminderClock {
  dateISO: string;
  hour: number;
  minute: number;
}

/**
 * A task's own time, moved back by `leadMinutes`.
 *
 * Rolls into the previous day when it has to: a task at 00:15 with a 30-minute
 * lead is a reminder at 23:45 the night before, which is a correct and useful
 * thing for it to be. Returning the day as part of the answer is why this
 * exists at all rather than being subtraction at the call site.
 */
export function applyLead(
  dateISO: string,
  hour: number,
  minute: number,
  leadMinutes: number
): ReminderClock {
  let total = hour * 60 + minute - Math.max(0, leadMinutes);
  let day = dateISO;
  while (total < 0) {
    total += 24 * 60;
    day = shiftISO(day, -1);
  }
  return { dateISO: day, hour: Math.floor(total / 60), minute: total % 60 };
}

/**
 * The wall-clock moment a *timed* task's reminder fires, or null when the task
 * has no time of day (those are the roundup's job, not this one's).
 */
export function timedReminderClock(
  task: Task,
  settings: Pick<NotificationSettings, "notify_task_reminder_lead_minutes">
): ReminderClock | null {
  const anchor = reminderAnchor(task);
  if (!anchor) return null;
  const clock = parseTaskClock(anchor.time);
  if (!clock) return null;
  return applyLead(
    anchor.dateISO,
    clock.hour,
    clock.minute,
    settings.notify_task_reminder_lead_minutes
  );
}

/** True when the task is announced by the roundup rather than at its own time. */
export function isUntimed(task: Task): boolean {
  const anchor = reminderAnchor(task);
  return anchor !== null && parseTaskClock(anchor.time) === null;
}

// ── Copy ───────────────────────────────────────────────

export interface ReminderContent {
  title: string;
  body: string;
}

function clockLabel(hour: number, minute: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/**
 * How far ahead of the task the reminder is, in words. `null` at zero lead —
 * "Standup · now" reads as a system message, where a bare time reads as the
 * task itself.
 */
export function describeLead(leadMinutes: number): string | null {
  if (leadMinutes <= 0) return null;
  if (leadMinutes < 60) return `in ${leadMinutes} min`;
  const hours = leadMinutes / 60;
  if (Number.isInteger(hours)) return `in ${hours} hr${hours === 1 ? "" : "s"}`;
  return `in ${leadMinutes} min`;
}

/**
 * What a timed task's notification says.
 *
 * **The title is the task title, verbatim and unprefixed.** A notification is
 * read in one glance in a lock-screen list beside every other app, and the
 * information that earns that line is what the task is — not the word "DoDone"
 * or "Reminder", which the OS already shows as the app name.
 *
 * The body carries the time it is scheduled for and, when the reminder is
 * early, how early — so the two readings a heads-up has to distinguish
 * ("now" vs "soon") are never ambiguous.
 */
export function buildTaskReminder(
  task: Task,
  opts: { leadMinutes: number; projectName?: string | null }
): ReminderContent {
  const anchor = reminderAnchor(task);
  const clock = anchor ? parseTaskClock(anchor.time) : null;

  const bits: string[] = [];
  if (clock) {
    const at = clockLabel(clock.hour, clock.minute);
    const lead = describeLead(opts.leadMinutes);
    bits.push(lead ? `${at} — ${lead}` : at);
  }
  if (anchor?.from === "deadline") bits.push("Deadline");
  if (opts.projectName) bits.push(opts.projectName);

  return {
    title: task.title,
    body: bits.join(" · "),
  };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** P1/P2 are the ranks someone deliberately chose. CLAUDE.md → The task row. */
function isHighPriority(task: Task): boolean {
  return task.priority === "p1" || task.priority === "p2";
}

/**
 * The day-start roundup for `dateISO`: the tasks scheduled for that day that
 * have no time of day, named in one notification. Null when there are none.
 *
 * **Only that day, and only untimed tasks.** Overdue work is deliberately left
 * out even though it is the most useful thing a *digest* can carry: this
 * notification exists to announce the tasks whose day has arrived, and a task
 * that slipped last Tuesday already had its announcement. Mixing the two would
 * make a roundup that grows without bound for anyone with a backlog, which is
 * how it stops being read. The daily digest is where overdue belongs, and it
 * is a separate switch.
 */
export function buildDayStartRoundup(
  tasks: Task[],
  dateISO: string
): ReminderContent | null {
  const onDay = tasks.filter((t) => {
    if (!isRemindable(t)) return false;
    const anchor = reminderAnchor(t);
    return anchor?.dateISO === dateISO && parseTaskClock(anchor.time) === null;
  });
  if (onDay.length === 0) return null;

  const ranked = [...onDay].sort((a, b) => {
    const p = (t: Task) => Number((t.priority ?? "p4").slice(1)) || 4;
    return p(a) - p(b) || (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });

  const named = ranked.slice(0, ROUNDUP_BODY_TASKS).map((t) => t.title);
  const rest = ranked.length - named.length;
  if (rest > 0) named.push(`+${rest} more`);

  const high = onDay.filter(isHighPriority).length;
  const bodyParts = [named.join(" · ")];
  if (high > 0) bodyParts.push(`${high} high priority`);

  return {
    title: `Today · ${plural(onDay.length, "task")}`,
    body: bodyParts.join(" — "),
  };
}

/** True when any per-task notification could be armed at all. */
export function isTaskReminderEnabled(settings: NotificationSettings): boolean {
  return settings.notify_task_reminders;
}

/**
 * One-line summary of *everything* this app might send, for the Settings row
 * that leads to the notifications screen.
 *
 * Distinct from `describeDigestSchedule`, which describes the digests alone and
 * is still what the digest section itself uses. The row is labelled "Digests
 * and reminders", so a summary that knew only about digests read "Off" to
 * someone who had just switched task reminders on — a settings row contradicting
 * the screen it opens.
 *
 * Lives here rather than beside `describeDigestSchedule` because this module
 * already imports that one; the reverse would be a cycle.
 */
export function describeNotificationSchedule(
  settings: NotificationSettings
): string {
  const digests = describeDigestSchedule(settings);
  const bits: string[] = [];
  if (settings.notify_task_reminders) bits.push("Task reminders");
  // "Off" is this function's own answer for "nothing at all", not a piece to
  // join — otherwise reminders-on would read "Task reminders · Off".
  if (digests !== "Off") bits.push(digests);
  return bits.length > 0 ? bits.join(" · ") : "Off";
}
