// Pure decay math + feeding deltas for Pip the pet.
//
// All functions here are deterministic: given the same inputs they return the
// same outputs and have no side effects. They run both in the browser (for
// PetPanel rendering) and on the server (inside PetsApi when computing the
// state to persist after a feeding event).

import type {
  PetMood,
  Task,
  PetEventActor,
  TaskPriority,
} from "./schemas.js";

// ── Decay rate constants ───────────────────────────────
//
// Rates are tuned so a fully-fed pet (80) drains over multiple days of
// neglect rather than hours, matching the plan's "no punishment" stance.
// HUNGER drains fastest because feeding is the most common interaction.

export const HUNGER_DECAY_PER_HOUR = 2;
export const HAPPINESS_DECAY_PER_HOUR = 1;
export const ENERGY_DECAY_PER_HOUR = 1.5;

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
 * Computes the current decayed stats given a snapshot of last-seen values.
 * Output values are clamped to [0, 100] and rounded to integers.
 */
export function computeCurrentStats(
  snapshot: PetStatsSnapshot,
  now: Date
): CurrentStats {
  const lastSeen =
    snapshot.last_seen_at instanceof Date
      ? snapshot.last_seen_at
      : new Date(snapshot.last_seen_at);
  const hours = hoursBetween(lastSeen, now);

  const hunger = clamp(
    Math.round(snapshot.hunger_at_last_seen - HUNGER_DECAY_PER_HOUR * hours),
    0,
    100
  );
  const happiness = clamp(
    Math.round(
      snapshot.happiness_at_last_seen - HAPPINESS_DECAY_PER_HOUR * hours
    ),
    0,
    100
  );
  const energy = clamp(
    Math.round(snapshot.energy_at_last_seen - ENERGY_DECAY_PER_HOUR * hours),
    0,
    100
  );

  return { hunger, happiness, energy };
}

// ── Mood derivation ────────────────────────────────────

/**
 * Returns the local hour of `date` in the given IANA timezone.
 * Falls back to UTC if the timezone is invalid.
 */
function localHour(date: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).formatToParts(date);
    const hourPart = parts.find((p) => p.type === "hour");
    if (!hourPart) return date.getUTCHours();
    // "hour12: false" can return "24" for midnight in some locales.
    const h = parseInt(hourPart.value, 10);
    return Number.isFinite(h) ? h % 24 : date.getUTCHours();
  } catch {
    return date.getUTCHours();
  }
}

/**
 * Derives the current mood from decayed stats.
 *
 * Priority order (per plan):
 *   1. sleeping  — last user activity > 8h AND it's nighttime in user's tz
 *   2. hungry    — hunger < 30
 *   3. tired     — energy < 30
 *   4. sad       — happiness < 30
 *   5. happy     — sum of all three stats >= 200
 *   6. content   — default
 */
export function deriveMood(
  stats: CurrentStats,
  lastUserActivityAt: Date | null,
  userTimezone: string,
  now: Date
): PetMood {
  // Sleeping check: idle > 8h and nighttime locally (10pm–6am).
  if (lastUserActivityAt) {
    const idleHours = hoursBetween(lastUserActivityAt, now);
    if (idleHours > 8) {
      const hour = localHour(now, userTimezone);
      const isNight = hour >= 22 || hour < 6;
      if (isNight) return "sleeping";
    }
  }

  if (stats.hunger < 30) return "hungry";
  if (stats.energy < 30) return "tired";
  if (stats.happiness < 30) return "sad";
  if (stats.hunger + stats.happiness + stats.energy >= 200) return "happy";
  return "content";
}

// ── Feeding deltas ─────────────────────────────────────

export interface TaskDeltaProps {
  priority: TaskPriority;
  due_date: string | null;
  duration_minutes: number | null;
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

function todayDateString(now: Date): string {
  // YYYY-MM-DD in UTC. Tasks store due_date as a date (no tz), so comparing
  // against UTC "today" is consistent across the rest of the codebase
  // (utils.ts isOverdue uses the same convention).
  return now.toISOString().split("T")[0];
}

/**
 * Applies feeding rules. Stats deltas stack — a p1 task completed before its
 * due date gets the priority bonus AND the punctual bonus.
 *
 * Rules (Finch-style: pure encouragement, no penalties — finishing a task is
 * always net positive for Pip, even if it was overdue):
 *   - Any task done           → hunger +15, xp +15
 *   - p1 done                 → hunger +20, happiness +15, xp +50 (replaces base)
 *   - p4 done                 → hunger +5,  xp +5  (replaces base)
 *   - Done before due date    → happiness +10
 *   - Done overdue            → no penalty (we still credit the work)
 *   - Quick task (<15min)     → energy +8
 *   - actor='claude'          → narrative tagged "Claude fed Pip while you were busy"
 */
export function applyTaskDeltas(
  _currentStats: CurrentStats,
  task: TaskDeltaProps,
  actor: PetEventActor,
  now: Date = new Date()
): FeedingResult {
  let hunger = 0;
  let happiness = 0;
  let energy = 0;
  let xp = 0;

  // Priority-based base: p1 and p4 override the generic "any task" hunger bump.
  if (task.priority === "p1") {
    hunger += 20;
    happiness += 15;
    xp += 50;
  } else if (task.priority === "p4") {
    hunger += 5;
    xp += 5;
  } else {
    hunger += 15;
    xp += 15;
  }

  // Punctuality bonus only — no penalty for overdue. Finishing late is still
  // finishing; we don't punish. Plan's "no punishment" stance, applied
  // consistently. (Earlier versions docked happiness -5 for overdue, which
  // contradicted the plan and felt bad in user testing for p4 tasks.)
  if (task.due_date) {
    const today = todayDateString(now);
    if (task.due_date >= today) {
      happiness += 10;
    }
  }

  // Quick task bonus.
  if (task.duration_minutes !== null && task.duration_minutes < 15) {
    energy += 8;
  }

  let narrative_hint: string;
  if (actor === "claude") {
    narrative_hint = "Claude fed Pip while you were busy";
  } else if (actor === "system") {
    narrative_hint = "Pip nibbled on a system snack";
  } else {
    if (task.priority === "p1") narrative_hint = "You knocked out a p1 — Pip is thrilled";
    else if (task.priority === "p4") narrative_hint = "You fed Pip a small snack";
    else narrative_hint = "You fed Pip";
  }

  return {
    deltas: { hunger, happiness, energy, xp },
    narrative_hint,
  };
}

/**
 * Convenience: extract the delta-relevant subset from a Task row.
 */
export function taskToDeltaProps(task: Task): TaskDeltaProps {
  return {
    priority: task.priority,
    due_date: task.due_date,
    duration_minutes: task.duration_minutes,
    completed_at: task.completed_at,
  };
}
