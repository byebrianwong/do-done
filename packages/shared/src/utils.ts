import type { Task } from "./schemas.js";

/**
 * Today's date as YYYY-MM-DD in the runtime's LOCAL timezone.
 *
 * `when_date` / `due_date` are local calendar dates (no timezone), so "today"
 * must also be local. `new Date().toISOString()` is UTC and is off by a day in
 * the evening for negative-offset zones (and the morning for positive ones),
 * which made tasks scheduled for "today" read as overdue — or vice versa —
 * near midnight. Build the string from local getFullYear/Month/Date instead.
 */
export function todayLocalISO(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Local YYYY-MM-DD `days` from `from` (default today; negative = past). */
export function addDaysLocalISO(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return todayLocalISO(d);
}

/**
 * Local YYYY-MM-DD for the next occurrence of `weekday` (0 = Sun … 6 = Sat) on
 * or after `from` (default today). If `from` already falls on `weekday`, returns
 * that same day.
 */
export function nextWeekdayLocalISO(weekday: number, from: Date = new Date()): string {
  const d = new Date(from);
  const delta = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta);
  return todayLocalISO(d);
}

// Human-friendly quick-schedule options. DoDone has no soft "buckets" — every
// label resolves to a concrete local calendar date so the task lands on a real
// day in the calendar.
export type QuickScheduleKey =
  | "today"
  | "tomorrow"
  | "this_week"
  | "this_weekend"
  | "next_week";

/** Ordered quick-schedule options with their display labels. */
export const QUICK_SCHEDULE: { key: QuickScheduleKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "this_week", label: "This week" },
  { key: "this_weekend", label: "This weekend" },
  { key: "next_week", label: "Next week" },
];

/**
 * Resolve a quick-schedule key to a concrete local YYYY-MM-DD:
 *   today → today, tomorrow → +1, this_week → this Friday,
 *   this_weekend → upcoming Sunday, next_week → exactly +7.
 */
export function resolveQuickSchedule(
  key: QuickScheduleKey,
  from: Date = new Date()
): string {
  switch (key) {
    case "today":
      return todayLocalISO(from);
    case "tomorrow":
      return addDaysLocalISO(1, from);
    case "this_week":
      return nextWeekdayLocalISO(5, from); // Friday
    case "this_weekend":
      return nextWeekdayLocalISO(0, from); // Sunday
    case "next_week":
      return addDaysLocalISO(7, from);
  }
}

/**
 * Short secondary label for a YYYY-MM-DD date, shown next to a friendly
 * shorthand (e.g. "Tomorrow") so the concrete day is always visible — the way
 * Todoist annotates its date-picker shortcuts.
 *
 *   today / tomorrow → weekday only ("Sun", "Mon")
 *   anything else    → weekday + month + day ("Sun Jul 5")
 *
 * `from` is injectable so tests can pin "now". Returns the input unchanged if
 * it isn't a parseable date.
 */
export function formatScheduleHint(date: string, from: Date = new Date()): string {
  const target = new Date(date + "T00:00:00");
  if (Number.isNaN(target.getTime())) return date;
  const today = new Date(from);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  const weekday = target.toLocaleDateString(undefined, { weekday: "short" });
  if (diff === 0 || diff === 1) return weekday;
  const monthDay = target.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${weekday} ${monthDay}`;
}

/** Ordinal suffix for a day-of-month: 1 → "st", 2 → "nd", 3 → "rd", 4 → "th"… */
function ordinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/**
 * Full human-readable label for a YYYY-MM-DD date: "Friday, July 3rd".
 * Appends the year ("Friday, July 3rd, 2027") when it differs from `from`'s
 * year. Returns the input unchanged if it isn't a parseable date.
 */
export function formatFullDate(date: string, from: Date = new Date()): string {
  const d = new Date(date + "T00:00:00");
  if (Number.isNaN(d.getTime())) return date;
  const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
  const month = d.toLocaleDateString(undefined, { month: "long" });
  const day = d.getDate();
  const base = `${weekday}, ${month} ${day}${ordinalSuffix(day)}`;
  return d.getFullYear() === from.getFullYear()
    ? base
    : `${base}, ${d.getFullYear()}`;
}

/**
 * Relative-day phrase for a YYYY-MM-DD date: "today", "tomorrow", "in 3 days",
 * "in 2 weeks", "in 1 month", "yesterday", "3 days ago"… `from` is injectable
 * so tests can pin "now". Returns "" if the input isn't a parseable date.
 */
export function formatRelativeDay(date: string, from: Date = new Date()): string {
  const target = new Date(date + "T00:00:00");
  if (Number.isNaN(target.getTime())) return "";
  const today = new Date(from);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff >= 2 && diff <= 6) return `in ${diff} days`;
  if (diff === 7) return "in 1 week";
  if (diff > 7 && diff <= 27) return `in ${Math.round(diff / 7)} weeks`;
  if (diff > 27) {
    const m = Math.round(diff / 30);
    return m === 1 ? "in 1 month" : `in ${m} months`;
  }
  if (diff <= -2 && diff >= -6) return `${-diff} days ago`;
  if (diff < -6 && diff >= -27) return `${Math.round(-diff / 7)} weeks ago`;
  const m = Math.round(-diff / 30);
  return m === 1 ? "1 month ago" : `${m} months ago`;
}

export function isOverdue(task: Task): boolean {
  if (task.status === "done" || task.status === "cancelled") return false;
  const today = todayLocalISO();
  if (task.due_date && task.due_date < today) return true;
  if (task.when_date && task.when_date < today) return true;
  return false;
}

export function isDueToday(task: Task): boolean {
  if (!task.due_date) return false;
  return task.due_date === todayLocalISO();
}

export function sortByPriority(tasks: Task[]): Task[] {
  const order = { p1: 0, p2: 1, p3: 2, p4: 3 };
  return [...tasks].sort((a, b) => order[a.priority] - order[b.priority]);
}

export function sortBySortOrder(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.sort_order - b.sort_order);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Format an "HH:MM" 24-hour clock string (the shape of when_time / due_time)
 * as a 12-hour label: "15:00" → "3:00 PM", "09:30" → "9:30 AM", "00:05" →
 * "12:05 AM". Returns the input unchanged if it isn't a parseable HH:MM.
 */
export function formatWhenTime(time: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return time;
  let hour = parseInt(match[1], 10);
  const min = match[2];
  if (Number.isNaN(hour) || hour < 0 || hour > 23) return time;
  const period = hour < 12 ? "AM" : "PM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${min} ${period}`;
}

/**
 * Format a `completed_at` ISO datetime as a short label of the LOCAL calendar
 * day the task was finished: "Today", "Yesterday", a weekday name within the
 * past week, then "Mon D" (gaining a year once it's a prior year).
 *
 * The Completed view shows this in place of the do-/due-date chip: a finished
 * task's scheduled date is no longer actionable, and rendering it would label
 * most of the list "Overdue" — noise that says nothing about the completed work.
 * Returns "" for an unparseable input so callers can skip the chip.
 */
export function formatCompletedDate(
  completedAt: string,
  now: Date = new Date()
): string {
  const ts = new Date(completedAt);
  if (Number.isNaN(ts.getTime())) return "";
  const day = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) {
    return day.toLocaleDateString("en-US", { weekday: "short" });
  }
  const sameYear = day.getFullYear() === today.getFullYear();
  return day.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function generateSortOrder(
  existingOrders: number[],
  position: "start" | "end" = "end"
): number {
  if (existingOrders.length === 0) return 1000;
  if (position === "end") return Math.max(...existingOrders) + 1000;
  return Math.min(...existingOrders) - 1000;
}
