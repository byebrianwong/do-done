import {
  isRemindable,
  isUntimed,
  parseClockTime,
  reminderAnchor,
  shiftISO,
  timedReminderClock,
  todayISOInZone,
  zonedClockToUtc,
  type NotificationSettings,
  type Task,
} from '@do-done/shared';
import { MIN_LEAD_MS } from './digest-plan';

/**
 * When each per-task reminder fires.
 *
 * The twin of `digest-plan.ts`, and separated from the scheduling in
 * `task-reminders.ts` for the same reason: `apps/mobile` has no renderer in CI,
 * so the only things it can test are decisions like these — and this is date
 * arithmetic across timezones, which is exactly the kind of thing that is wrong
 * by one day for half the world and impossible to notice by looking at a phone.
 *
 * ## Two shapes
 *
 * - A task with a **time of day** gets its own occurrence at that time, less
 *   the user's lead.
 * - Tasks scheduled for a day with **no time** have no instant of their own, so
 *   one `day-start` occurrence per day names them together. Most tasks in
 *   DoDone are this shape, which is why it is one notification and not N — see
 *   `buildDayStartRoundup` in @do-done/shared.
 *
 * ## The cap matters more than it looks
 *
 * iOS keeps **at most 64 pending local notifications per app** and silently
 * drops the rest: no error, no warning, the 65th simply never arrives. Android
 * has no documented limit but degrades similarly at scale. Every scheduler in
 * this app shares that one budget — the digests arm up to nine, and the
 * geofence dwell filter holds one or two at a time — so task reminders take a
 * deliberate slice of it rather than all of it.
 *
 * This is the same failure mode as the 20-region geofence cap (CLAUDE.md →
 * Location reminders), and it gets the same treatment: trim explicitly, by a
 * rule we chose, and report what was dropped, rather than letting the OS
 * discard an arbitrary tail.
 */

/**
 * How far ahead to arm. Shorter than the digests' eight days on purpose: a task
 * reminder is worth a cap slot in rough proportion to how soon it is, and the
 * plan is re-armed on every foreground *and* every task write, so a reminder
 * five days out has many chances to be armed before it matters.
 */
export const HORIZON_DAYS = 7;

/**
 * The slice of the OS budget task reminders may take. 48 of iOS's 64 leaves
 * room for the digest plan (up to 9) and the geofence dwell filter, with a
 * little headroom.
 */
export const MAX_TASK_REMINDERS = 48;

export interface TaskOccurrence {
  kind: 'task';
  at: Date;
  task: Task;
}

export interface DayStartOccurrence {
  kind: 'day-start';
  at: Date;
  /** The day the roundup describes, `YYYY-MM-DD`. */
  dateISO: string;
}

export type ReminderOccurrence = TaskOccurrence | DayStartOccurrence;

export interface ReminderPlan {
  occurrences: ReminderOccurrence[];
  /** How many qualifying occurrences the cap left out. Never silent. */
  dropped: number;
}

/** The instant at which the clock in `timeZone` reads `dateISO` `hour:minute`. */
function instantFor(
  dateISO: string,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  return zonedClockToUtc(y, m, d, hour, minute, timeZone);
}

/**
 * Every reminder to arm, soonest first.
 *
 * Occurrences already past — or too close to schedule safely — are left out
 * rather than fired late, for the reason `MIN_LEAD_MS` exists: the re-arm
 * cancels and recreates everything, so an instant that passes between the
 * cancel and the schedule is delivered *immediately* by expo-notifications. A
 * reminder for a 9am task arriving at 2pm because the user happened to open the
 * app is worse than no reminder — it is a lie about what time it is.
 *
 * `tasks` may be any superset of the relevant rows; filtering happens here so
 * the caller can satisfy the whole plan with one query.
 */
export function planTaskReminders(
  tasks: Task[],
  settings: NotificationSettings,
  opts: {
    now: Date;
    timeZone: string;
    horizonDays?: number;
    max?: number;
  }
): ReminderPlan {
  if (!settings.notify_task_reminders) return { occurrences: [], dropped: 0 };

  const { now, timeZone } = opts;
  const horizon = opts.horizonDays ?? HORIZON_DAYS;
  const max = opts.max ?? MAX_TASK_REMINDERS;
  const floor = now.getTime() + MIN_LEAD_MS;

  const today = todayISOInZone(timeZone, now);
  const lastDay = shiftISO(today, horizon - 1);

  const eligible = tasks.filter(isRemindable);
  const out: ReminderOccurrence[] = [];

  // ── Timed tasks ──────────────────────────────────────
  for (const task of eligible) {
    if (isUntimed(task)) continue;
    const anchor = reminderAnchor(task);
    // Bounded by the task's own day, not by the shifted reminder instant: a
    // lead can push a reminder into the previous day, and a task on the first
    // day of the horizon should still get its heads-up the night before.
    if (!anchor || anchor.dateISO > lastDay) continue;

    const clock = timedReminderClock(task, settings);
    if (!clock) continue;

    const at = instantFor(clock.dateISO, clock.hour, clock.minute, timeZone);
    if (at.getTime() < floor) continue;
    out.push({ kind: 'task', at, task });
  }

  // ── The day-start roundup ────────────────────────────
  if (settings.notify_day_start_roundup) {
    const clock = parseClockTime(settings.notify_day_start_time);
    if (clock) {
      // Only days that actually have untimed work. An occurrence whose content
      // would come back null still costs a slot in the sort below, so it is
      // filtered here rather than at arming time.
      const daysWithUntimed = new Set<string>();
      for (const task of eligible) {
        if (!isUntimed(task)) continue;
        const anchor = reminderAnchor(task);
        if (!anchor) continue;
        if (anchor.dateISO < today || anchor.dateISO > lastDay) continue;
        daysWithUntimed.add(anchor.dateISO);
      }

      for (const dateISO of daysWithUntimed) {
        const at = instantFor(dateISO, clock.hour, clock.minute, timeZone);
        if (at.getTime() < floor) continue;
        out.push({ kind: 'day-start', at, dateISO });
      }
    }
  }

  out.sort((a, b) => a.at.getTime() - b.at.getTime());

  // Soonest first, so what survives the cap is what matters soonest — and what
  // is dropped is furthest from needing to exist yet, with the most chances to
  // be armed by a later re-arm.
  return {
    occurrences: out.slice(0, max),
    dropped: Math.max(0, out.length - max),
  };
}

/**
 * The inclusive date range a plan needs task data for.
 *
 * Always anchored at today rather than at the first occurrence: a lead time can
 * put a reminder on the day *before* the task, so the query has to reach a day
 * further than the reminders themselves do.
 */
export function reminderQueryRange(
  timeZone: string,
  now: Date,
  horizonDays: number = HORIZON_DAYS
): { startISO: string; endISO: string } {
  const today = todayISOInZone(timeZone, now);
  return { startISO: today, endISO: shiftISO(today, horizonDays - 1) };
}
