import { addDaysLocalISO, todayLocalISO } from "./utils.js";

/**
 * Consecutive days on which the user finished something.
 *
 * This exists for one reason: `sparkReason`'s `streak` rule, which celebrates
 * the completion that keeps a run of days alive. DoDone had no notion of a
 * streak at all — `tasks.completed_at` is the only substrate, and nothing
 * aggregated it — so the bucketing lives here, pure and testable, rather than
 * being written twice against two different query layers.
 *
 * Days are the reader's *local* days, not UTC ones. `completed_at` is a
 * `timestamptz`, and a task finished at 11pm should belong to the day the user
 * was living in when they finished it. That matches the rest of the client:
 * everything day-shaped goes through `todayLocalISO`, never `toISOString`.
 */

/**
 * The distinct local days something was completed on, newest first.
 *
 * Nulls and unparseable timestamps are dropped rather than thrown on — this
 * feeds an animation, and a malformed row should cost a burst, not a render.
 */
export function completionDays(
  completedAt: ReadonlyArray<string | null | undefined>
): string[] {
  const days = new Set<string>();
  for (const at of completedAt) {
    if (!at) continue;
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) continue;
    days.add(todayLocalISO(d));
  }
  return [...days].sort().reverse();
}

/**
 * How many days in a row end at `today` — or at yesterday, if today is still
 * empty. Zero when the run is already broken.
 *
 * Counting a run that ends *yesterday* is what makes the streak survive the
 * part of the day before you have done anything: at 9am your streak is still
 * however many days long, it just hasn't been extended yet.
 */
export function streakLength(
  days: ReadonlyArray<string>,
  today: string = todayLocalISO()
): number {
  const have = new Set(days);
  // Anchor on today when it has one, otherwise on yesterday. Anything older
  // means the run is already over.
  const yesterday = shift(today, -1);
  let cursor = have.has(today) ? today : have.has(yesterday) ? yesterday : null;
  if (!cursor) return 0;

  let n = 0;
  while (have.has(cursor)) {
    n++;
    cursor = shift(cursor, -1);
  }
  return n;
}

/**
 * Is *this* completion the one keeping the streak alive?
 *
 * True only for the first completion of the day, and only when yesterday also
 * had one. Both halves matter:
 *
 * - **First of the day**, because "any completion on a day that is part of a
 *   streak" describes nearly every completion the user makes, and a rule that
 *   fires nearly always is not a gate.
 * - **Yesterday too**, because today's first completion on a day after a gap
 *   *starts* a run rather than continuing one. A streak of one is just a
 *   Tuesday.
 *
 * @param days  Local days already completed on, *before* this completion.
 */
export function isStreakDay(
  days: ReadonlyArray<string>,
  today: string = todayLocalISO()
): boolean {
  const have = new Set(days);
  if (have.has(today)) return false;
  return have.has(shift(today, -1));
}

/** One day either side of a local YYYY-MM-DD, staying in local time. */
function shift(day: string, by: number): string {
  const [y, m, d] = day.split("-").map(Number);
  // Noon, so a DST jump in either direction can't roll the date over.
  return addDaysLocalISO(by, new Date(y, (m ?? 1) - 1, d ?? 1, 12));
}
