import type { Task } from "./schemas.js";

/**
 * The celebratory burst a task row fires when it is ticked off — and, more
 * importantly, the rule for when it doesn't.
 *
 * Celebrating *every* completion is how a delight becomes a tax: by the
 * fortieth task of the week the burst is something the user is waiting out
 * rather than enjoying, and the next thing they ask for is a switch to turn it
 * off — which is the clearest possible signal that an animation is in the way.
 * So the burst is reserved for completions that were actually worth something.
 *
 * "Worth something" is deliberately not one thing. A task can earn it by
 * mattering (priority), by costing (effort), by finishing something (the last
 * open task in a section, or in a project), or by keeping a habit alive (a
 * streak day). Those are different kinds of achievement and a user will
 * recognise whichever one applies to them.
 *
 * Both apps read this module, the way they read the completion timings, so the
 * gate can't come to a different answer on the phone than on the desktop.
 */

/** Why a completion earned its burst. Ordered most-significant first. */
export type SparkReason =
  | "project-finished"
  | "last-in-section"
  | "streak"
  | "effort"
  | "priority";

/**
 * What the row's surroundings know at the moment of the tap.
 *
 * Every field is optional and a missing one simply can't trigger: a surface
 * that has no sections (the inbox, search) passes no section count and gets
 * the other rules unchanged, rather than having to fake a value.
 */
export interface SparkContext {
  /**
   * Open tasks in this row's section, **including this one**, as the section
   * stood before the write. One means this completion empties it.
   */
  openInSection?: number | null;
  /** The same for the row's project. One means this completion finishes it. */
  openInProject?: number | null;
  /**
   * True when this completion is the one keeping a run of days alive — the
   * first of today, on a day whose predecessor also had one. Not "any
   * completion on a day in a streak", which would fire on nearly all of them.
   */
  streakDay?: boolean;
}

/**
 * Priorities that earn a burst on their own.
 *
 * `p2`'s label is literally "High", so "high and above" is p1 + p2. p3 is
 * Medium and p4 is "nobody set one" — neither is an achievement.
 */
export const SPARK_PRIORITIES: ReadonlySet<string> = new Set(["p1", "p2"]);

/** A task estimated at this long or more has earned it by costing something. */
export const SPARK_EFFORT_MINUTES = 120;

/**
 * Why this completion should burst, or null for the quiet majority.
 *
 * Returns the *reason* rather than a boolean so the caller can say which rule
 * fired — worth having in tests, where "it sparked" is a much weaker assertion
 * than "it sparked because the project finished".
 */
export function sparkReason(
  task: Pick<Task, "priority" | "duration_minutes">,
  ctx: SparkContext = {}
): SparkReason | null {
  // Finishing something outranks the properties of the task that finished it:
  // if the last task in a project happens to be a two-hour P1, the moment is
  // the project ending, not the task's size.
  if (ctx.openInProject === 1) return "project-finished";
  if (ctx.openInSection === 1) return "last-in-section";
  if (ctx.streakDay) return "streak";
  if ((task.duration_minutes ?? 0) >= SPARK_EFFORT_MINUTES) return "effort";
  if (task.priority && SPARK_PRIORITIES.has(task.priority)) return "priority";
  return null;
}

/** Convenience for call sites that only need to know whether to fire. */
export function shouldSpark(
  task: Pick<Task, "priority" | "duration_minutes">,
  ctx: SparkContext = {}
): boolean {
  return sparkReason(task, ctx) !== null;
}

// ─── The burst itself ───────────────────────────────────────────────────────

/**
 * Total flight time of the burst, stagger included — the last particle is gone
 * at exactly this mark, on both surfaces.
 *
 * It has to be **shorter than the hold**. The row clips itself (`overflow:
 * hidden`) the moment it starts collapsing, so a burst still in the air at that
 * point gets sliced off at the row's edge as it shrinks. Finishing inside the
 * hold is what lets it read as thrown clear rather than cut off.
 */
export const SPARK_MS = 400;

/** Particles per burst. Enough to read as a scatter, few enough to stay cheap. */
export const SPARK_COUNT = 10;

/** One particle's flight, in pixels from the centre of the checkbox. */
export interface SparkParticle {
  /** Horizontal travel. */
  tx: number;
  /** Vertical travel; positive is down, so gravity has already been applied. */
  ty: number;
  /**
   * Staggered so the burst scatters rather than stamping all at once.
   *
   * Time *within* {@link SPARK_MS}, not on top of it: a particle that starts
   * late flies for correspondingly less time, so every one of them lands on the
   * same frame and the burst has a definite end.
   */
  delay: number;
  /** Side length in px. */
  size: number;
}

/**
 * The fan, computed once and shared by both surfaces so a burst has the same
 * shape on a phone as on a desktop.
 *
 * Deliberately deterministic — no `Math.random`. It makes the geometry
 * testable, it keeps web and mobile identical, and at 400ms nobody is going to
 * notice that two bursts a minute apart threw the same ten sparks.
 *
 * The fan points upward (out of the row, not into the one below it) and every
 * particle is pulled back down by the same constant, so the arcs read as
 * thrown rather than merely radiating.
 */
export function sparkParticles(count: number = SPARK_COUNT): SparkParticle[] {
  const out: SparkParticle[] = [];
  const from = -165;
  const to = -15;
  for (let i = 0; i < count; i++) {
    const deg = from + ((to - from) * i) / Math.max(count - 1, 1);
    const rad = (deg * Math.PI) / 180;
    const distance = 26 + (i % 3) * 11;
    out.push({
      tx: round(Math.cos(rad) * distance),
      ty: round(Math.sin(rad) * distance + 16),
      delay: i * 9,
      size: i % 2 === 0 ? 3 : 2,
    });
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
