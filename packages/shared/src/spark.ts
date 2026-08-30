import type { Task } from "./schemas.js";

/**
 * The spark burst a task row fires when it is ticked off, and the rule for when
 * it doesn't.
 *
 * Only some completions burst. If every one did, it would fire around forty
 * times a week, users would start waiting it out, and the next thing they ask
 * for is a switch to turn it off. So the burst is reserved for completions worth
 * marking.
 *
 * "Worth marking" is deliberately more than one thing. A task can qualify by
 * mattering (priority), by costing (effort), by finishing something (the last
 * open task in a section or a project), or by keeping a streak alive. Those are
 * different kinds of achievement, and a user will recognise whichever one
 * applies to them.
 *
 * Both apps read this module, the same way they read the completion timings, so
 * the gate cannot answer differently on the phone than on the desktop.
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
 * Every field is optional, and a missing one cannot trigger. A surface with no
 * sections (the inbox, search) passes no section count and gets the other rules
 * unchanged, rather than having to invent a value.
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
   * True when this completion keeps a run of days alive — the first of today, on
   * a day whose predecessor also had one. Not "any completion on a day in a
   * streak", which would fire on nearly all of them.
   */
  streakDay?: boolean;
}

/**
 * Priorities that earn a burst on their own.
 *
 * `p2`'s label is "High", so "high and above" is p1 + p2. p3 is Medium and p4 is
 * "nobody set one"; neither is an achievement.
 */
export const SPARK_PRIORITIES: ReadonlySet<string> = new Set(["p1", "p2"]);

/** A task estimated at this long or more qualifies on effort alone. */
export const SPARK_EFFORT_MINUTES = 120;

/**
 * Why this completion should burst, or null for most completions.
 *
 * Returns the *reason* rather than a boolean so the caller can say which rule
 * fired. That matters in tests, where "it sparked" is a much weaker assertion
 * than "it sparked because the project finished".
 */
export function sparkReason(
  task: Pick<Task, "priority" | "duration_minutes" | "is_list_item">,
  ctx: SparkContext = {}
): SparkReason | null {
  // A shopping-list item never bursts. The gate is here rather than in the two
  // row components so neither can forget it.
  //
  // Every rule below would misfire on a list. `openInProject === 1` is the last
  // item of every grocery run, forever, so the most repeated action in the app
  // would become the most celebrated one. Ticking an item still gets the ring
  // fill and the strike-through; the acknowledgement is what matters there.
  if (task.is_list_item === true) return null;

  // Finishing something outranks the properties of the task that finished it.
  // If the last task in a project happens to be a two-hour P1, the moment is the
  // project ending, not the task's size.
  if (ctx.openInProject === 1) return "project-finished";
  if (ctx.openInSection === 1) return "last-in-section";
  if (ctx.streakDay) return "streak";
  if ((task.duration_minutes ?? 0) >= SPARK_EFFORT_MINUTES) return "effort";
  if (task.priority && SPARK_PRIORITIES.has(task.priority)) return "priority";
  return null;
}

/** For call sites that only need to know whether to fire. */
export function shouldSpark(
  task: Pick<Task, "priority" | "duration_minutes" | "is_list_item">,
  ctx: SparkContext = {}
): boolean {
  return sparkReason(task, ctx) !== null;
}

// ─── The burst itself ───────────────────────────────────────────────────────

/**
 * Total flight time of the burst, stagger included. The last particle is gone at
 * exactly this mark, on both surfaces.
 *
 * It must be **shorter than the hold**. The row clips itself
 * (`overflow: hidden`) the moment it starts collapsing, so a particle still in
 * the air at that point is cut off at the row's edge as it shrinks.
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
   * Staggered so the burst scatters rather than appearing all at once.
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
 * Deliberately deterministic — no `Math.random`. That makes the geometry
 * testable and keeps web and mobile identical, and at 400ms nobody will notice
 * that two bursts a minute apart threw the same ten sparks.
 *
 * The fan points upward, out of the row rather than into the one below it, and
 * every particle is pulled back down by the same constant, so the arcs look
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
