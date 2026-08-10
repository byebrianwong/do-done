import type { TaskPriority, TaskStatus } from "./schemas.js";

/**
 * How long a task's notes (`description`) may be.
 *
 * This number is load-bearing in three places that must agree: the DB CHECK
 * constraint on `tasks.description`, the Zod schemas, and the `maxLength` on
 * every notes input. When they disagreed — an unbounded textarea over a
 * 5,000-char CHECK — passing the limit didn't just reject the notes, it made
 * the *whole task* unsaveable: the autosave hook diffs against the snapshot it
 * mounted with, so the oversized description rode along in every subsequent
 * PATCH and took the user's title, priority and date edits down with it, with
 * nothing but a red dot to say why.
 *
 * So the inputs stop at exactly this many characters. The DB check is the
 * backstop for writes that don't come through an editor (MCP, SQL); it can
 * never be the thing a typing user meets.
 *
 * 50,000 is roughly 20 pages — past any plausible task note, and still far
 * inside the 1MB `to_tsvector` ceiling the `fts` generated column would hit.
 */
export const TASK_DESCRIPTION_MAX_LENGTH = 50_000;

/**
 * Priority.
 *
 * **This is the only place a priority colour is written down.** Every surface
 * that draws one — the row's gutter, the editor's bar meter, the week view's
 * busyness dots, the command palette, bulk actions, the quick-add chip, the
 * Android widget — reads it from here. There have been three hand-kept copies
 * of this ramp at various times and they were never all in agreement; the row
 * and the picker two inches from it drew different colours for the same task.
 *
 * The ramp used to be red → orange → yellow → grey, which is the one an
 * English speaker reaches for and the one that fails hardest in practice:
 *
 * - **Yellow can't be seen on white.** `#eab308` lands at 1.92:1 against a
 *   white surface, well under the 3:1 a non-text indicator needs — and most
 *   surfaces here draw priority small and on white.
 * - **Red, orange and yellow are one hue family.** Under deuteranopia, the
 *   most common form of red-green colour blindness, the first three collapse
 *   into a single warm smear, so the ramp carries no information at all for
 *   roughly one man in sixteen.
 *
 * Slate at P3 breaks the warm family, so the ramp separates by temperature as
 * well as lightness and survives both colour blindness and a greyscale
 * screenshot. It is deliberately **not** indigo, which it was until this ramp
 * was unified: `#6366f1` is the app's accent, the colour that means *selected*
 * on every other control, so a middling priority was wearing the one hue that
 * already had a job.
 *
 * **P2 is under 3:1 on white and there is no warm colour that isn't** — orange
 * `#f97316` is 2.80:1, amber `#f59e0b` 2.15:1, yellow 1.92:1. (An earlier note
 * here claimed amber cleared 3:1. It does not; it is barely better than the
 * yellow it replaced.) Orange is the best of them and is what both task rows
 * already drew, so the unified ramp adopts the row's value rather than the
 * picker's. This is exactly why colour is never the only channel: every
 * surface pairs it with bar length, lit-bar count or a label, because no ramp
 * survives being screenshotted in greyscale either.
 */
export const PRIORITY_CONFIG: Record<
  TaskPriority,
  { label: string; color: string; score: number }
> = {
  p1: { label: "Urgent", color: "#ef4444", score: 40 },
  p2: { label: "High", color: "#f97316", score: 30 },
  p3: { label: "Medium", color: "#64748b", score: 20 },
  // Deliberately the quietest of the four: p4 is "no priority set", not a
  // priority someone chose, so it reads as one dim bar next to the unlit ones.
  // It is the one rank the task row's gutter draws nothing for — see
  // `rowGutter` in task-row.ts for why that asymmetry is the honest one.
  p4: { label: "Low", color: "#a3a3a3", score: 10 },
};

/**
 * Late, which is not a priority and so does not live in the ramp above.
 *
 * A deeper red than P1's, because it outranks it: in the row's gutter these
 * two can never appear together, and the one that wins is this one.
 */
export const OVERDUE_COLOR = "#dc2626";

export const STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; icon: string; color: string }
> = {
  inbox: { label: "Inbox", icon: "tray", color: "#6b7280" },
  later: { label: "Later", icon: "clock", color: "#b6c2d9" },
  not_started: { label: "Not started", icon: "circle", color: "#94a3b8" },
  next: { label: "Next", icon: "arrow-right", color: "#6366f1" },
  in_progress: { label: "In progress", icon: "play", color: "#f59e0b" },
  done: { label: "Done", icon: "check", color: "#16a34a" },
  cancelled: { label: "Cancelled", icon: "x", color: "#9ca3af" },
};

// Status ordering for pickers / sort. Mirrors the natural lifecycle.
export const STATUS_ORDER: readonly TaskStatus[] = [
  "inbox",
  "later",
  "not_started",
  "next",
  "in_progress",
  "done",
  "cancelled",
] as const;

// "Terminal" statuses — task is finished (either done or cancelled).
export const TERMINAL_STATUSES: readonly TaskStatus[] = [
  "done",
  "cancelled",
] as const;

export const FOCUS_SCORES = {
  OVERDUE: 100,
  DEADLINE_TODAY: 50,
  IN_PROGRESS: 20,
  HAS_TIME_BLOCK: 30,
  // Quick wins: small tasks that can be knocked out fast get a boost so they
  // surface in the default focus list alongside overdue / high-priority work.
  QUICK_WIN: 25, // estimate <= QUICK_WIN_MAX_MINUTES
  QUICK_WIN_PARTIAL: 12, // estimate <= QUICK_WIN_PARTIAL_MAX_MINUTES
} as const;

// Duration thresholds (minutes) for the quick-win focus bonus above.
export const QUICK_WIN_MAX_MINUTES = 15;
export const QUICK_WIN_PARTIAL_MAX_MINUTES = 30;

export const DEFAULT_PROJECT_COLORS = [
  "#6366f1", // indigo (primary)
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#8b5cf6", // violet
  "#ec4899", // pink
];

// ─── Location reminders / geofencing ────────────────────
//
// Radius presets. The floor is 100 m on purpose: both Play Services and
// CoreLocation resolve position from Wi-Fi/cell as well as GPS, and a typical
// urban fix lands 20-60 m off (worse indoors, worse still on cell alone).
// Regions tighter than ~100 m therefore miss arrivals and fire spurious
// exits when the fix drifts while you sit still.
export const LOCATION_RADIUS_PRESETS: readonly {
  meters: number;
  label: string;
  hint: string;
}[] = [
  { meters: 100, label: "At the door", hint: "One shop or building" },
  { meters: 200, label: "Arriving", hint: "Pulling into the car park" },
  { meters: 500, label: "Nearby", hint: "A few streets away" },
  { meters: 1000, label: "In the area", hint: "This part of town" },
];

export const DEFAULT_LOCATION_RADIUS_METERS = 200;
export const MIN_LOCATION_RADIUS_METERS = 100;

// An "enter" event fires the moment you clip the boundary, so driving past a
// shop at 50 km/h would fire "Buy milk". Instead of notifying on the event we
// schedule the notification this far out and cancel it if an "exit" arrives
// first — a dwell filter built from the enter/exit pair expo-location gives
// us. 90 s is long enough to drop drive-bys and short enough that the reminder
// still lands while you're parking.
export const GEOFENCE_DWELL_SECONDS = 90;

// Position drift at the boundary makes regions flap: enter/exit/enter within a
// minute or two while you sit at a desk near the edge. Once a task has fired
// for a location, suppress it this long before it can fire again.
export const GEOFENCE_COOLDOWN_MINUTES = 30;

// Hard platform ceilings on simultaneously monitored regions. iOS is the
// binding one by a wide margin — CoreLocation silently stops monitoring
// anything past 20, so we register the most recently used locations and tell
// the user which ones are dormant rather than letting them fail quietly.
export const GEOFENCE_MAX_REGIONS = { ios: 20, android: 100 } as const;

// ─── Task completion feedback ───────────────────────────────────────────────
//
// Ticking a task off used to be the least satisfying thing in the app: the row
// vanished on the same frame as the tap, so there was no acknowledgement of the
// tap, no moment where the task read as *done*, and the rows below jumped up
// into the gap. These three phases give the action a shape — and both apps read
// them from here so web and mobile stay the same gesture.
//
// The row is what animates, not the list. It plays the check, holds, then
// collapses its own height to zero; the rows below slide up simply because the
// row above them is shrinking. That needs no cooperation from dnd-kit or
// DraggableFlatList, which is exactly why it's done this way.

/** Check mark springs in. Overlaps the hold — this is the tap's receipt. */
export const TASK_COMPLETE_CHECK_MS = 220;

/**
 * How long the row sits there visibly completed — filled checkbox, struck-out
 * title — before it starts to leave. Short enough not to feel like a stall,
 * long enough to read as a state the task passed through rather than a flicker
 * on its way out.
 */
export const TASK_COMPLETE_HOLD_MS = 420;

/** Height → 0 and fade. The rows below travel for exactly this long. */
export const TASK_COMPLETE_COLLAPSE_MS = 260;

/**
 * When the row is finally gone and the data layer may drop it. Anything that
 * removes the task from a list (mobile's optimistic cache patch, web's
 * `router.refresh()`) waits this long, so removal lands on an already-invisible
 * row instead of cutting the animation short.
 */
export const TASK_COMPLETE_EXIT_MS =
  TASK_COMPLETE_HOLD_MS + TASK_COMPLETE_COLLAPSE_MS;

/**
 * How many Google calendars DoDone will read events from per page load. Each
 * one is a separate `events.list` round-trip, so a user subscribed to holidays,
 * weather, four sports teams and a handful of shared calendars would otherwise
 * fan a single Today render out into 20+ sequential API calls.
 *
 * The cap used to be 10 and applied to whatever order Google returned, which
 * silently dropped calendars off the end with nothing on screen to say so. It
 * is now a limit on what the user has explicitly *chosen* in Settings, and the
 * picker refuses to let them tick past it.
 */
export const MAX_DISPLAY_CALENDARS = 20;
