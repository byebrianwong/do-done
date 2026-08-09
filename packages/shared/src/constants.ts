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
 * The ramp used to be red → orange → yellow → grey, which is the one an
 * English speaker reaches for and the one that fails hardest in practice:
 *
 * - **Yellow can't be seen on white.** `#eab308` lands near 1.9:1 against a
 *   white surface, well under the 3:1 a non-text indicator needs — and every
 *   surface that draws priority (the row's bar meter, the calendar's busyness
 *   dots, the flag in the context menu) draws it small and on white.
 * - **Red, orange and yellow are one hue family.** Under deuteranopia, the
 *   most common form of red-green colour blindness, the first three collapse
 *   into a single warm smear, so the ramp carries no information at all for
 *   roughly one man in sixteen.
 *
 * Indigo at P3 breaks the warm family: the ramp now separates by lightness as
 * well as hue, so it survives both colour blindness and a greyscale
 * screenshot. Amber clears 3:1 where yellow doesn't.
 *
 * These four are also what the editor's bar meters and the calendar's
 * busyness dots already drew from their own local maps — this constant was
 * the odd one out, so anything reading it (the task row, week view, command
 * palette, bulk actions, the Android widget) was quietly on a different ramp
 * from the editor beside it.
 *
 * Colour is never the only channel: every surface pairs it with lit-bar count
 * or a label, because no ramp survives being screenshotted in greyscale.
 */
export const PRIORITY_CONFIG: Record<
  TaskPriority,
  { label: string; color: string; score: number }
> = {
  p1: { label: "Urgent", color: "#ef4444", score: 40 },
  p2: { label: "High", color: "#f59e0b", score: 30 },
  p3: { label: "Medium", color: "#6366f1", score: 20 },
  // Deliberately the quietest of the four: p4 is "no priority set", not a
  // priority someone chose, so it reads as one dim bar next to the unlit ones.
  p4: { label: "Low", color: "#a3a3a3", score: 10 },
};

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

// The three phases above are the *shape* of the gesture. What follows is its
// texture, and it lands inside them — nothing here extends the 680ms envelope,
// which is what keeps the hold, the write and the undo window untouched.
//
// Three layers, and they overlap on purpose:
//
//   -90 →   0   the ring flinches under the press          (anticipation)
//     0 → 220   the check springs and the ring fills       (existing)
//    20 → 360   a hairline halo rings out and dissolves    (anticipation)
//    40 → 230   the strike-through is drawn, left to right (strike)
//   420 → 680   the row slides right as its height closes  (exit)
//
// The line finishes at 230ms, right as the check finishes at 220: one is the
// control acknowledging the tap, the other is the text acknowledging it, and
// the eye may be on either. The slide is strictly after the hold, so it never
// shares the stage with them.

/**
 * The ring squashes for this long before it fills.
 *
 * Anticipation is what separates a control that responds from one that
 * reports. Web drives it from `:active`, so it really is the press; mobile
 * folds it into the completion itself, because a 22px ring under a thumb is
 * occluded at exactly the moment it would be visible — and because swipe-to-
 * complete has no press to anticipate from.
 */
export const TASK_COMPLETE_ANTICIPATE_MS = 90;

/** How far the ring squashes. Small enough to read as give, not as a bounce. */
export const TASK_COMPLETE_ANTICIPATE_SCALE = 0.86;

/** A hairline ring expands out of the checkbox and dissolves. */
export const TASK_COMPLETE_HALO_MS = 340;

/**
 * The strike-through is drawn rather than flipped on.
 *
 * It used to be a class toggle — instant, on the tap's own frame, while
 * everything around it eased. That made it the only un-animated part of the
 * gesture, and it sits where the eye already is, because it is where the words
 * are. Crossing something out is the most literal metaphor in task management;
 * drawing it turns it back into a gesture.
 */
export const TASK_COMPLETE_STRIKE_MS = 190;

/**
 * The line starts a beat after the check does, so the two *finish* together
 * (40 + 190 = 230, against the check's 220) rather than starting together and
 * finishing apart.
 */
export const TASK_COMPLETE_STRIKE_DELAY_MS = 40;

/** The title's colour trails the line rather than racing it. */
export const TASK_COMPLETE_TITLE_DELAY_MS = 90;

/**
 * How far the row travels as it leaves.
 *
 * A pure height collapse is the animation of *removal* — it is what a deleted
 * row does. But a completed task hasn't gone anywhere: it is in the Completed
 * view, it fed the pet, and it is undoable for the next six seconds. Sliding
 * it out says "filed", which is what actually happened.
 *
 * Rightward is not arbitrary on mobile, where swipe-*right* is already the
 * complete gesture — the exit continues the direction the finger was already
 * travelling, and the tap inherits the same vector for free.
 */
export const TASK_COMPLETE_SLIDE_PX = 26;

/** And shrinks a touch as it goes, so it reads as lifting off the list. */
export const TASK_COMPLETE_SLIDE_SCALE = 0.972;

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
