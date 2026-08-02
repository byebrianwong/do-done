import type { TaskPriority, TaskStatus } from "./schemas.js";

export const PRIORITY_CONFIG: Record<
  TaskPriority,
  { label: string; color: string; score: number }
> = {
  p1: { label: "Urgent", color: "#ef4444", score: 40 },
  p2: { label: "High", color: "#f97316", score: 30 },
  p3: { label: "Medium", color: "#eab308", score: 20 },
  p4: { label: "Low", color: "#6b7280", score: 10 },
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
  DUE_TODAY: 50,
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
