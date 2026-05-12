// Pure decay math + feeding deltas for Pip the pet.
//
// All functions here are deterministic: given the same inputs they return the
// same outputs and have no side effects. They run both in the browser (for
// PetPanel rendering) and on the server (inside PetsApi when computing the
// state to persist after a feeding event).
//
// Pip's mechanics, in plain English:
//
//   - Hunger: completing a task feeds Pip. Bigger tasks feed more (1 point
//     per effort-estimate bucket: 30m=1, 1h=2, 2h=3, 4h=4, 8h=5, 16h=6).
//     Once a day (at local midnight), hunger decays by `hunger_daily_decay`
//     (default 3, user-configurable).
//   - Happiness: completing a task also lifts happiness. Base +2, plus +1 for
//     each "level" of priority (p4=+1, p3=+2, p2=+3, p1=+4). Finishing on or
//     before the When/Due date adds +5. Once a week (at the end of the user's
//     chosen week-end day, default Sunday), happiness decays by
//     `happiness_weekly_decay` (default 10, user-configurable).
//   - Energy: any action — creating, editing, anything — feeds Pip energy.
//     Decays 1 pt/hr only during waking hours (8a–8p local), so an inactive
//     day costs up to 12 energy. No penalty overnight.
//
// All values are clamped to [0, 100]. Pip never gets sadder for being neglected
// for an unusual length of time — the model is "lift on action, gentle decay"
// rather than "punishment for absence".

import {
  ROTATING_POSITIVE_MOODS,
  type PetMood,
  type Task,
  type PetEventActor,
  type TaskPriority,
  type PetDecayPreferences,
} from "./schemas.js";

// ── Helpers ────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function hoursBetween(earlier: Date, later: Date): number {
  const ms = later.getTime() - earlier.getTime();
  if (ms <= 0) return 0;
  return ms / 3_600_000;
}

// ── Timezone-aware date helpers ────────────────────────
//
// Pip's decay ticks fire at specific clock times in the user's local timezone
// (local midnight for daily hunger, end-of-week-day for weekly happiness, and
// 8a–8p for waking-hour energy). We do not maintain a background scheduler —
// instead, on every read we count how many tick boundaries have been crossed
// between `last_seen_at` and `now` in the user's tz, and apply that many ticks.
// This keeps the model fully deterministic and serverless-friendly.

/**
 * Returns the local clock components (Y/M/D h:m) of `date` in `timezone`.
 * Falls back to UTC if the timezone string is invalid.
 */
function localParts(
  date: Date,
  timezone: string
): { y: number; m: number; d: number; h: number; min: number; dow: number } {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
    const parts = fmt.formatToParts(date);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "0";
    const y = parseInt(get("year"), 10);
    const m = parseInt(get("month"), 10);
    const d = parseInt(get("day"), 10);
    const hRaw = parseInt(get("hour"), 10);
    // Some locales render midnight as "24" with hour12:false.
    const h = hRaw === 24 ? 0 : hRaw;
    const min = parseInt(get("minute"), 10);
    const weekday = get("weekday");
    // Map "Sun"..."Sat" → 0..6
    const dow =
      { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekday] ?? 0;
    return { y, m, d, h, min, dow };
  } catch {
    return {
      y: date.getUTCFullYear(),
      m: date.getUTCMonth() + 1,
      d: date.getUTCDate(),
      h: date.getUTCHours(),
      min: date.getUTCMinutes(),
      dow: date.getUTCDay(),
    };
  }
}

/**
 * Days-since-epoch (Julian-style day number) for a YYYY-MM-DD date. Treats
 * each calendar day as an integer so we can subtract two of them to count
 * how many local midnights fell between two timestamps.
 */
function dayNumber(y: number, m: number, d: number): number {
  // JS Date.UTC handles month rollovers correctly; we just want an integer
  // day count, so any consistent epoch works.
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * How many local midnights (00:00) fall in the half-open interval
 * (earlier, later] for the given timezone. Used for hunger daily decay.
 */
function countLocalMidnights(
  earlier: Date,
  later: Date,
  timezone: string
): number {
  if (later.getTime() <= earlier.getTime()) return 0;
  const a = localParts(earlier, timezone);
  const b = localParts(later, timezone);
  return Math.max(0, dayNumber(b.y, b.m, b.d) - dayNumber(a.y, a.m, a.d));
}

/**
 * How many local "end of weekDay" moments fall in (earlier, later] for the
 * given timezone. A week-end tick fires at midnight of the day AFTER
 * `weekEndDay`, since "end of Sunday" = midnight rolling into Monday.
 */
function countLocalWeekEnds(
  earlier: Date,
  later: Date,
  timezone: string,
  weekEndDay: number
): number {
  if (later.getTime() <= earlier.getTime()) return 0;
  const a = localParts(earlier, timezone);
  const b = localParts(later, timezone);
  const aDay = dayNumber(a.y, a.m, a.d);
  const bDay = dayNumber(b.y, b.m, b.d);
  // A tick fires when crossing into the day-of-week (weekEndDay + 1) mod 7.
  // Equivalent: count midnights where the new day's weekday == (weekEndDay+1)%7.
  const targetDow = (weekEndDay + 1) % 7;
  let count = 0;
  // Walk forward from the first midnight after `earlier` to the last <= `later`.
  for (let day = aDay + 1; day <= bDay; day++) {
    // Day-of-week for `day` (days-since-epoch). Epoch (1970-01-01) was Thursday=4.
    const dow = ((day % 7) + 4) % 7;
    if (dow === targetDow) count++;
  }
  return count;
}

/**
 * Total "waking hours" (8am ≤ local hour < 8pm) elapsed in the interval
 * (earlier, later] for the given timezone. Returns a fractional number — e.g.
 * an interval from local 7:30 to 8:30 returns 0.5.
 */
function countWakingHours(
  earlier: Date,
  later: Date,
  timezone: string
): number {
  if (later.getTime() <= earlier.getTime()) return 0;
  // We iterate hour-by-hour because the timezone shift varies (DST), and
  // brute-forcing across at most ~hoursBetween hours is cheap up to ~weeks.
  // For very stale `last_seen_at` values (years), we cap at 30 days of decay,
  // which is the max meaningful drift anyway.
  const totalMs = later.getTime() - earlier.getTime();
  const capMs = 30 * 86_400_000;
  const effectiveStart =
    totalMs > capMs ? new Date(later.getTime() - capMs) : earlier;
  let waking = 0;
  // Walk in 30-minute steps so partial hours at the 8a/8p boundary are
  // captured fractionally.
  const stepMs = 30 * 60_000;
  for (
    let t = effectiveStart.getTime() + stepMs;
    t <= later.getTime();
    t += stepMs
  ) {
    const { h } = localParts(new Date(t - stepMs / 2), timezone);
    if (h >= 8 && h < 20) waking += stepMs / 3_600_000;
  }
  return waking;
}

// ── Stat shapes ────────────────────────────────────────

export interface PetStatsSnapshot {
  hunger_at_last_seen: number;
  happiness_at_last_seen: number;
  energy_at_last_seen: number;
  last_seen_at: string | Date;
}

export interface CurrentStats {
  hunger: number;
  happiness: number;
  energy: number;
}

// ── Decay-on-read ──────────────────────────────────────

/**
 * Computes the current decayed stats given a snapshot of last-seen values and
 * the user's decay preferences. Output values are clamped to [0, 100] and
 * rounded to integers.
 *
 * The three stats decay on independent schedules — see file header for the
 * narrative description.
 */
export function computeCurrentStats(
  snapshot: PetStatsSnapshot,
  prefs: PetDecayPreferences,
  now: Date
): CurrentStats {
  const lastSeen =
    snapshot.last_seen_at instanceof Date
      ? snapshot.last_seen_at
      : new Date(snapshot.last_seen_at);

  const midnights = countLocalMidnights(lastSeen, now, prefs.timezone);
  const weekEnds = countLocalWeekEnds(
    lastSeen,
    now,
    prefs.timezone,
    prefs.week_end_day
  );
  const waking = countWakingHours(lastSeen, now, prefs.timezone);

  const hunger = clamp(
    Math.round(snapshot.hunger_at_last_seen - prefs.hunger_daily_decay * midnights),
    0,
    100
  );
  const happiness = clamp(
    Math.round(
      snapshot.happiness_at_last_seen - prefs.happiness_weekly_decay * weekEnds
    ),
    0,
    100
  );
  const energy = clamp(
    Math.round(snapshot.energy_at_last_seen - waking),
    0,
    100
  );

  return { hunger, happiness, energy };
}

// ── Mood derivation ────────────────────────────────────

/**
 * Pseudo-random index into ROTATING_POSITIVE_MOODS, bucketed to ~30 minutes
 * so the mood feels animated across a session without flickering. Deterministic
 * given the same (now, salt) so tests can pin it.
 */
function rotatingMoodIndex(now: Date, salt: number = 0): number {
  const bucket = Math.floor(now.getTime() / (30 * 60_000)) + salt;
  // Mulberry32-style scramble so adjacent buckets don't return adjacent moods.
  let h = bucket >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = h ^ (h >>> 16);
  return Math.abs(h) % ROTATING_POSITIVE_MOODS.length;
}

/**
 * Derives the current mood from decayed stats.
 *
 * Pip is intentionally positive — there is no `sad` mood. When stats are all
 * healthy, Pip cycles through expression variants (happy / content / curious /
 * playful / cozy / thoughtful) bucketed to ~30 min so the face changes
 * throughout the day. Stat thresholds still override the rotation as soft
 * care cues (hungry/tired), and night-time idleness yields sleeping.
 *
 * Priority order:
 *   1. sleeping  — last user activity > 8h AND it's nighttime in user's tz
 *   2. hungry    — hunger < 30
 *   3. tired     — energy < 30
 *   4. (rotate)  — pseudo-random positive expression from ROTATING_POSITIVE_MOODS
 *
 * Note: low happiness no longer triggers a mood change. Per the redesign,
 * Pip doesn't telegraph "sadness" — encouragement comes from positive
 * expressions, not negative cues.
 */
export function deriveMood(
  stats: CurrentStats,
  lastUserActivityAt: Date | null,
  prefs: PetDecayPreferences,
  now: Date
): PetMood {
  if (lastUserActivityAt) {
    const idleHours = hoursBetween(lastUserActivityAt, now);
    if (idleHours > 8) {
      const { h } = localParts(now, prefs.timezone);
      const isNight = h >= 22 || h < 6;
      if (isNight) return "sleeping";
    }
  }

  if (stats.hunger < 30) return "hungry";
  if (stats.energy < 30) return "tired";

  return ROTATING_POSITIVE_MOODS[rotatingMoodIndex(now)];
}

// ── Feeding deltas ─────────────────────────────────────

export interface TaskDeltaProps {
  priority: TaskPriority;
  duration_minutes: number | null;
  when_date: string | null;
  due_date: string | null;
  completed_at?: string | Date | null;
}

export interface FeedingDeltas {
  hunger: number;
  happiness: number;
  energy: number;
  xp: number;
}

export interface FeedingResult {
  deltas: FeedingDeltas;
  narrative_hint: string;
}

function todayLocalDateString(now: Date, timezone: string): string {
  const { y, m, d } = localParts(now, timezone);
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/**
 * Maps `duration_minutes` to a hunger gain (1 point per effort bucket level).
 * Matches the V2 modal's ESTIMATE_BUCKETS:
 *   ≤30m=1, ≤1h=2, ≤2h=3, ≤4h=4, ≤8h=5, >8h=6
 * Tasks completed without an estimate default to 1 (treated as smallest bucket).
 */
export function hungerFromEstimate(minutes: number | null): number {
  if (minutes === null || minutes <= 30) return 1;
  if (minutes <= 60) return 2;
  if (minutes <= 120) return 3;
  if (minutes <= 240) return 4;
  if (minutes <= 480) return 5;
  return 6;
}

/**
 * Maps priority to its happiness "level" bonus. Spec: "+1 for each level of
 * priority" where p4 is the lowest. p4=+1, p3=+2, p2=+3, p1=+4.
 */
export function priorityHappinessBonus(p: TaskPriority): number {
  return { p4: 1, p3: 2, p2: 3, p1: 4 }[p];
}

/**
 * Applies feeding rules for a COMPLETED task.
 *
 *   - Hunger += hungerFromEstimate(duration_minutes)
 *   - Happiness += 2 (base) + priorityHappinessBonus(priority)
 *                  + 5 if completed on or before when_date OR due_date
 *   - Energy: 0  (energy is fed by creates/edits, not completions)
 *   - XP +5 (small completion reward; p1 still gets a larger XP bump)
 */
export function applyTaskDeltas(
  _currentStats: CurrentStats,
  task: TaskDeltaProps,
  actor: PetEventActor,
  prefs: PetDecayPreferences,
  now: Date = new Date()
): FeedingResult {
  const hunger = hungerFromEstimate(task.duration_minutes);

  let happiness = 2 + priorityHappinessBonus(task.priority);

  const todayLocal = todayLocalDateString(now, prefs.timezone);
  const onTime =
    (task.when_date !== null && task.when_date >= todayLocal) ||
    (task.due_date !== null && task.due_date >= todayLocal);
  if (onTime) happiness += 5;

  const xp = task.priority === "p1" ? 50 : 5;

  let narrative_hint: string;
  if (actor === "claude") {
    narrative_hint = "Claude finished a task — Pip is grateful";
  } else if (actor === "system") {
    narrative_hint = "Pip nibbled on a system snack";
  } else if (task.priority === "p1") {
    narrative_hint = "You knocked out a p1 — Pip is thrilled";
  } else if (onTime) {
    narrative_hint = "On-time finish — Pip beams";
  } else {
    narrative_hint = "You fed Pip";
  }

  return {
    deltas: { hunger, happiness, energy: 0, xp },
    narrative_hint,
  };
}

// ── Action-driven energy feeding ───────────────────────
//
// Energy is fed by every meaningful interaction — creating a task, editing
// fields, anything that signals the user is actively working. Two helpers:
// `applyCreateEnergy` for new-task events, `applyEditEnergy` for diffs.

/**
 * Returns true if `value` represents a "set" / "filled in" field. Used by both
 * create-energy ("is this field filled in?") and edit-energy ("did this field
 * transition from unset to set?") helpers.
 *
 *   - null / undefined           → unset
 *   - empty string / whitespace  → unset
 *   - empty array                → unset
 *   - priority "p4"              → unset (default; any other priority is "filled")
 *   - everything else            → set
 */
export function isFieldFilled(
  field: TrackedField,
  value: unknown
): boolean {
  if (value === null || value === undefined) return false;
  if (field === "priority") return value !== "p4";
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return Boolean(value);
}

/**
 * Fields that contribute to energy. The list is intentionally small — only
 * fields the user explicitly chooses, not derived/system fields like
 * `updated_at` or `status`.
 */
export type TrackedField =
  | "priority"
  | "duration_minutes"
  | "when_date"
  | "when_bucket"
  | "due_date"
  | "description"
  | "tags";

export const TRACKED_FIELDS: TrackedField[] = [
  "priority",
  "duration_minutes",
  "when_date",
  "when_bucket",
  "due_date",
  "description",
  "tags",
];

export interface CreateEnergyInput {
  priority: TaskPriority;
  duration_minutes: number | null;
  description: string | null;
}

/**
 * Energy delta for a newly created task.
 *
 *   - +10 if (effort estimate AND priority are both filled in) OR description set
 *   - +5  otherwise
 */
export function applyCreateEnergy(input: CreateEnergyInput): {
  energy: number;
  narrative_hint: string;
} {
  const richScheduling =
    isFieldFilled("priority", input.priority) &&
    isFieldFilled("duration_minutes", input.duration_minutes);
  const hasDescription = isFieldFilled("description", input.description);
  if (richScheduling || hasDescription) {
    return {
      energy: 10,
      narrative_hint: "You captured something thoughtfully — Pip perks up",
    };
  }
  return {
    energy: 5,
    narrative_hint: "You added a new task — Pip stirs",
  };
}

/**
 * Energy delta for a task edit. Counts +1 for each tracked field that
 * transitioned from "unset" → "set" between `before` and `after`. Editing an
 * already-set field gives 0 (per spec: "Editing anything that isn't set yet").
 */
export function applyEditEnergy(
  before: Partial<Record<TrackedField, unknown>>,
  after: Partial<Record<TrackedField, unknown>>
): { energy: number; filledFields: TrackedField[]; narrative_hint: string } {
  const filledFields: TrackedField[] = [];
  for (const f of TRACKED_FIELDS) {
    const beforeFilled = isFieldFilled(f, before[f]);
    const afterFilled = isFieldFilled(f, after[f]);
    if (!beforeFilled && afterFilled) filledFields.push(f);
  }
  const energy = filledFields.length;
  let narrative_hint = "";
  if (energy === 1) {
    narrative_hint = `You filled in ${filledFields[0]} — Pip cheers you on`;
  } else if (energy > 1) {
    narrative_hint = `You filled in ${energy} fields — Pip is energized`;
  }
  return { energy, filledFields, narrative_hint };
}

/**
 * Convenience: extract the delta-relevant subset from a Task row for
 * completion feeding.
 */
export function taskToDeltaProps(task: Task): TaskDeltaProps {
  return {
    priority: task.priority,
    duration_minutes: task.duration_minutes,
    when_date: task.when_date,
    due_date: task.due_date,
    completed_at: task.completed_at,
  };
}

/**
 * Convenience: extract the create-energy subset from a partial task.
 */
export function taskToCreateEnergyInput(task: {
  priority?: TaskPriority;
  duration_minutes?: number | null;
  description?: string | null;
}): CreateEnergyInput {
  return {
    priority: task.priority ?? "p4",
    duration_minutes: task.duration_minutes ?? null,
    description: task.description ?? null,
  };
}
