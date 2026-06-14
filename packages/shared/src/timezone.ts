// ── Timezone-aware clock → instant conversion ────────────
//
// Scheduling needs to turn a *wall-clock* time in the user's timezone (e.g.
// "9:00 AM in America/New_York") into an absolute UTC instant — the inverse of
// the read-side `localParts` trick used by pet-decay.ts. JS's Date has no
// built-in for this (Date constructors interpret components as either local or
// UTC, never an arbitrary IANA zone), so we derive the zone's offset via
// Intl.DateTimeFormat and correct for it.

/** Wall-clock components of `date` as seen in `timeZone`. UTC on bad input. */
function partsInZone(
  date: Date,
  timeZone: string
): { y: number; m: number; d: number; h: number; min: number } {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const get = (type: string) =>
      parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
    const hRaw = get("hour");
    return {
      y: get("year"),
      m: get("month"),
      d: get("day"),
      // hour12:false renders midnight as "24" in some environments.
      h: hRaw === 24 ? 0 : hRaw,
      min: get("minute"),
    };
  } catch {
    return {
      y: date.getUTCFullYear(),
      m: date.getUTCMonth() + 1,
      d: date.getUTCDate(),
      h: date.getUTCHours(),
      min: date.getUTCMinutes(),
    };
  }
}

/**
 * The UTC instant at which the clock in `timeZone` reads
 * `year-month-day hour:minute` (seconds = 0).
 *
 * Example: zonedClockToUtc(2026, 6, 15, 9, 0, "America/New_York") →
 * the Date for 2026-06-15T13:00:00Z (EDT is UTC−4).
 *
 * Implementation: treat the desired wall time as if it were UTC ("guess"),
 * see what that instant actually reads as in the zone, and subtract the
 * difference (the zone's offset). One pass is exact except within the ~1h
 * DST overlap/gap, which is irrelevant for focus-hour windows.
 */
export function zonedClockToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const desiredUTC = Date.UTC(year, month - 1, day, hour, minute);
  const guess = new Date(desiredUTC);
  const seen = partsInZone(guess, timeZone);
  const seenUTC = Date.UTC(seen.y, seen.m - 1, seen.d, seen.h, seen.min);
  const offset = seenUTC - desiredUTC; // how far the zone leads UTC
  return new Date(desiredUTC - offset);
}
