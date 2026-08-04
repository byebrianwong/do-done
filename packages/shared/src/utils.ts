import type { CalendarEvent, Task } from "./schemas.js";

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
 * Signed whole-day distance from `from` to a local YYYY-MM-DD date: 0 = today,
 * positive = future, negative = past. Returns null if `date` isn't parseable.
 *
 * Both ends are normalised to local midnight before subtracting, so a DST
 * boundary inside the span can't round the result off by one.
 */
export function daysUntilLocalISO(
  date: string,
  from: Date = new Date()
): number | null {
  const target = new Date(date + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

/**
 * The local YYYY-MM-DD dates strictly between `startISO` and `endISO` — the
 * interior of a date span, with both endpoints excluded. Empty when the dates
 * are equal, adjacent, out of order, or unparseable.
 *
 * This is the "runway" the calendar grids tint between today and the task's
 * date; the endpoints are excluded because each already carries its own marker.
 */
export function datesBetweenLocalISO(
  startISO: string,
  endISO: string
): string[] {
  const start = new Date(startISO + "T00:00:00");
  const end = new Date(endISO + "T00:00:00");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const out: string[] = [];
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1);
  // Guard the loop on the ISO string rather than the timestamp: a DST shift
  // moves local midnight by an hour, which a millisecond comparison would
  // read as "still before the end" for one extra iteration.
  while (todayLocalISO(cursor) < endISO) {
    out.push(todayLocalISO(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * The Google Calendar events that belong on local day `dayISO` (YYYY-MM-DD).
 * All-day events span [start_date, end_date) — end exclusive, per Google —
 * so multi-day events appear on every covered day. Timed events belong to
 * the date portion of their RFC3339 start; the fetch layer requests event
 * times in the user's preferred timezone, so that date IS the user's day.
 * Sorted all-day first, then by start time.
 */
export function calendarEventsOnDay(
  events: CalendarEvent[],
  dayISO: string
): CalendarEvent[] {
  const onDay = events.filter((e) => {
    if (e.all_day) {
      return (
        e.start_date !== null &&
        e.start_date <= dayISO &&
        (e.end_date === null || dayISO < e.end_date)
      );
    }
    return e.start !== null && e.start.slice(0, 10) === dayISO;
  });
  return onDay.sort(compareCalendarEvents);
}

function compareCalendarEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
  return (a.start ?? "").localeCompare(b.start ?? "");
}

/** Wall-clock minutes-since-midnight from an RFC3339 string, or null. */
export function eventClockMinutes(rfc3339: string | null): number | null {
  if (!rfc3339) return null;
  const hh = Number(rfc3339.slice(11, 13));
  const mm = Number(rfc3339.slice(14, 16));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}

function clockLabel(minutes: number): string {
  const hh = Math.floor(minutes / 60) % 24;
  const mm = minutes % 60;
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const suffix = hh < 12 ? "AM" : "PM";
  return mm === 0
    ? `${h12} ${suffix}`
    : `${h12}:${String(mm).padStart(2, "0")} ${suffix}`;
}

/**
 * "9:00 – 10:30 AM"; null for all-day. Derived from the RFC3339 string's own
 * clock portion — the fetch layer requests event times in the user's
 * preferred timezone, and string math (unlike Date + toLocaleTimeString) gives
 * identical output everywhere (web SSR, browser, React Native).
 */
export function formatEventTime(event: CalendarEvent): string | null {
  if (event.all_day) return null;
  const start = eventClockMinutes(event.start);
  if (start === null) return null;
  const end = eventClockMinutes(event.end);
  return end === null
    ? clockLabel(start)
    : `${clockLabel(start)} – ${clockLabel(end)}`;
}

// Multi-day all-day events expand to one entry per covered day; cap the
// expansion so a malformed or years-long event can't explode the map.
const MAX_ALL_DAY_SPAN = 62;

/** `YYYY-MM-DD` + 1 day, computed on string parts (no timezone involved). */
function nextDayISO(dayISO: string): string {
  const [y, m, d] = dayISO.split("-").map(Number);
  return todayLocalISO(new Date(y, m - 1, d + 1));
}

/**
 * Bucket events by day in one pass — same membership rule as
 * `calendarEventsOnDay`, for callers that need many days at once (Upcoming's
 * date columns, the week grid). Keys exist only for days that have events.
 */
export function groupCalendarEventsByDay(
  events: CalendarEvent[]
): Map<string, CalendarEvent[]> {
  const byDay = new Map<string, CalendarEvent[]>();
  const add = (day: string, e: CalendarEvent) => {
    const list = byDay.get(day);
    if (list) list.push(e);
    else byDay.set(day, [e]);
  };
  for (const e of events) {
    if (e.all_day) {
      if (!e.start_date) continue;
      let day = e.start_date;
      for (
        let i = 0;
        i < MAX_ALL_DAY_SPAN && (e.end_date === null || day < e.end_date);
        i++
      ) {
        add(day, e);
        if (e.end_date === null) break; // single known day
        day = nextDayISO(day);
      }
    } else if (e.start) {
      add(e.start.slice(0, 10), e);
    }
  }
  for (const list of byDay.values()) list.sort(compareCalendarEvents);
  return byDay;
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

/**
 * One piece of a title/notes string split for link rendering: either a run of
 * plain text or a URL. `href` is present only on links and always carries a
 * scheme (bare `www.` links are normalised to `https://`) so a renderer can use
 * it verbatim.
 */
export interface LinkSegment {
  type: "text" | "link";
  /** The exact substring from the input — what the user sees. */
  value: string;
  /** Navigable URL, links only. Guaranteed to start with a scheme. */
  href?: string;
}

// Matches http(s):// links and scheme-less `www.` links. Kept in lockstep with
// the task-engine parser's URL_PATTERN so a link that survives natural-language
// parsing (masked, then restored into the title) is the same link we detect for
// display. `[^\s]+` is deliberately greedy; trailing punctuation that isn't part
// of the URL is trimmed back off in trimLinkTrailing below.
const LINK_PATTERN = /\b(?:https?:\/\/|www\.)[^\s]+/gi;

// Sentence punctuation that commonly abuts a link but isn't part of it:
// "see https://example.com." → the trailing "." is prose, not the URL.
const TRAILING_PUNCTUATION = new Set([
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  "'",
  '"',
  "’", // right single quote
]);

const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/**
 * Trim trailing characters that punctuate the surrounding prose rather than the
 * URL. Closing brackets are only trimmed when unbalanced — so a Wikipedia link
 * like "…/wiki/Foo_(bar)" keeps its closing paren, but "(see https://x.com)"
 * gives up the stray ")". The trimmed characters are re-emitted as text.
 */
function trimLinkTrailing(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    if (TRAILING_PUNCTUATION.has(ch)) {
      end--;
      continue;
    }
    const open = CLOSERS[ch];
    if (open) {
      const slice = url.slice(0, end);
      let balance = 0;
      for (const c of slice) {
        if (c === open) balance++;
        else if (c === ch) balance--;
      }
      // balance < 0 ⇒ more closers than openers ⇒ this one is unmatched.
      if (balance < 0) {
        end--;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

/** Prepend a scheme to bare `www.` links; leave http(s) links untouched. */
function toHref(url: string): string {
  return /^www\./i.test(url) ? `https://${url}` : url;
}

/**
 * Split a string into plain-text and link segments for rendering URLs as
 * clickable links. Pure and platform-agnostic (no DOM) so web and mobile share
 * one definition of "what counts as a link". Returns a single text segment when
 * there are no links, and `[]` for an empty string.
 */
export function linkifyText(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  // Fresh regex per call — a shared /g regex carries lastIndex between calls.
  const re = new RegExp(LINK_PATTERN.source, LINK_PATTERN.flags);
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const url = trimLinkTrailing(match[0]);
    // A degenerate match with no body left after trimming: treat as text and
    // step forward one char so the loop can't spin.
    if (url.length === 0) {
      re.lastIndex = match.index + 1;
      continue;
    }
    if (match.index > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, match.index) });
    }
    segments.push({ type: "link", value: url, href: toHref(url) });
    cursor = match.index + url.length;
    // Rewind the scanner to just past the URL so any punctuation we trimmed is
    // re-scanned and folded into the next text segment.
    re.lastIndex = cursor;
  }
  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }
  return segments;
}
