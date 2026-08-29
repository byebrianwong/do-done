import { learnableTerm } from "./food.js";
import type { Task } from "./schemas.js";

/**
 * The pantry: what has been bought on a list before, and when.
 *
 * A shopping list never finishes. It empties and refills, and most of what
 * goes on it has been on it before. So putting an item back should be a matter
 * of picking it off a list rather than remembering the word for it.
 *
 * These are pure functions rather than component logic because `apps/mobile`
 * has no renderer in CI. A rule that lives in a component is never tested.
 */

export interface PantryEntry {
  /** The normalised lookup key: `learnableTerm` applied to the title. */
  term: string;
  /** The title as last written, so putting it back restores the user's wording. */
  title: string;
  /** ISO timestamp of the most recent buy. */
  last_bought_at: string;
  buy_count: number;
  /** Days between the last few buys, oldest first. Capped at ten entries. */
  gaps: number[];
  store: string | null;
}

// ── The bands ──────────────────────────────────────────

/**
 * The band boundaries, in days.
 *
 * These approximate an item's buying rhythm rather than measuring it, so they
 * mis-sort some items: rice bought three weeks ago lands next to a one-off,
 * and milk bought fifteen days ago drops a band. They are still worth having
 * because they need no history. On the first shop after this ships every entry
 * has one buy, and nothing can be said about its rhythm yet. See `cadenceDays`
 * for the measured version that replaces them once history exists.
 */
export const PANTRY_RECENT_DAYS = 14;
export const PANTRY_MID_DAYS = 62;

export type PantryBandKey = "recent" | "mid" | "earlier";

export interface PantryBand {
  key: PantryBandKey;
  label: string;
  entries: PantryEntry[];
}

const BAND_LABEL: Record<PantryBandKey, string> = {
  recent: "Last 2 weeks",
  mid: "Last 2 months",
  earlier: "Earlier",
};

/** Whole days between a past timestamp and now. Never negative. */
export function daysSince(iso: string, now: Date = new Date()): number {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 0;
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

export function bandFor(entry: PantryEntry, now: Date = new Date()): PantryBandKey {
  const days = daysSince(entry.last_bought_at, now);
  if (days <= PANTRY_RECENT_DAYS) return "recent";
  if (days <= PANTRY_MID_DAYS) return "mid";
  return "earlier";
}

export interface PantryBandOptions {
  now?: Date;
  /**
   * Extra terms to leave out, on top of `onList`. Used for entries the
   * "Probably due" strip has already shown, so nothing appears twice.
   */
  exclude?: Iterable<string>;
  /**
   * Items currently on the list. Any entry whose term matches one of these is
   * left out of the drawer.
   *
   * This stops the drawer duplicating the list. An item is recorded the moment
   * it is ticked, so without this filter it would sit in the cart and in the
   * drawer at once, and the drawer would offer to add something already there.
   * It also makes an accidental tick self-correcting: un-ticking puts the row
   * back on the list, which hides its pantry entry again.
   */
  onList?: Array<Pick<Task, "title">>;
}

/**
 * Groups pantry entries into the three bands, newest first within each.
 *
 * Empty bands are dropped rather than shown with a zero. A heading over nothing
 * is clutter, and on a new list all three would be empty.
 */
export function pantryBands(
  entries: PantryEntry[],
  opts: PantryBandOptions = {}
): PantryBand[] {
  const now = opts.now ?? new Date();
  const taken = new Set(
    (opts.onList ?? [])
      .map((t) => learnableTerm(t.title))
      .filter((t): t is string => t !== null)
  );
  for (const term of opts.exclude ?? []) taken.add(term);

  const buckets: Record<PantryBandKey, PantryEntry[]> = {
    recent: [],
    mid: [],
    earlier: [],
  };
  for (const entry of entries) {
    if (taken.has(entry.term)) continue;
    buckets[bandFor(entry, now)].push(entry);
  }

  const order: PantryBandKey[] = ["recent", "mid", "earlier"];
  return order
    .map((key) => ({
      key,
      label: BAND_LABEL[key],
      entries: buckets[key].sort((a, b) =>
        b.last_bought_at.localeCompare(a.last_bought_at)
      ),
    }))
    .filter((band) => band.entries.length > 0);
}

/** Formats how long ago an item was bought: "6d ago", "5w ago", "7mo ago". */
export function lastBoughtLabel(iso: string, now: Date = new Date()): string {
  const days = daysSince(iso, now);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  if (days < 62) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

// ── Searching it ───────────────────────────────────────

/**
 * Returns pantry entries matching the query, best match first.
 *
 * This is what lets the composer remember: a few keystrokes should be enough to
 * put back something bought repeatedly, with its store already attached.
 *
 * Ranked by where the match falls, then by how often the item is bought, so a
 * weekly staple beats something bought once eight months ago. Entries already
 * on the list are excluded, since offering to add what is on screen is noise.
 */
export function searchPantry(
  entries: PantryEntry[],
  query: string,
  opts: { limit?: number; onList?: Array<Pick<Task, "title">> } = {}
): PantryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const taken = new Set(
    (opts.onList ?? [])
      .map((t) => learnableTerm(t.title))
      .filter((t): t is string => t !== null)
  );

  const scored: Array<{ entry: PantryEntry; rank: number }> = [];
  for (const entry of entries) {
    if (taken.has(entry.term)) continue;
    const hay = entry.title.toLowerCase();
    // A word-start match is usually what a few typed letters mean. A match
    // inside a word ("eas" in "peas") is weaker but still worth offering,
    // ranked below the others.
    let rank: number;
    if (hay.startsWith(q)) rank = 0;
    else if (new RegExp(`\\b${escapeRegExp(q)}`).test(hay)) rank = 1;
    else if (hay.includes(q)) rank = 2;
    else continue;
    scored.push({ entry, rank });
  }

  return scored
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        b.entry.buy_count - a.entry.buy_count ||
        b.entry.last_bought_at.localeCompare(a.entry.last_bought_at)
    )
    .slice(0, opts.limit ?? 4)
    .map((s) => s.entry);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Cadence ────────────────────────────────────────────

/**
 * How many buys are needed before the app claims to know an item's rhythm.
 *
 * Three buys is two gaps, which is the fewest that can disagree with each
 * other, so the fewest a median can mean anything over. Two buys give one gap,
 * and one gap proves nothing: salt bought in January and again in March would
 * have the app announcing a two-month rhythm.
 */
export const CADENCE_MIN_BUYS = 3;

/**
 * How far past its rhythm an item can drift and still count as due.
 *
 * Without a ceiling, every item eventually becomes due and stays that way, and
 * a spice bought three times and abandoned four years ago would rank as the
 * most overdue thing on the list. Three times the interval separates "late"
 * from "no longer buying this". Past that the entry is just old, and the bands
 * are where old entries belong.
 */
export const CADENCE_STALE_FACTOR = 3;

/** Cap on the due strip, so it stays a prompt rather than a second list. */
export const CADENCE_MAX_SUGGESTIONS = 6;

/** Returns the median gap, or null if there are no usable gaps. */
export function medianGap(gaps: number[]): number | null {
  const usable = gaps.filter((g) => Number.isFinite(g) && g > 0);
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Returns the item's buying rhythm in days, or null if it is not yet known.
 *
 * Uses a median rather than a mean, which is why `gaps` is stored as an array
 * instead of a running average. A single holiday, illness, or week away pulls a
 * mean far enough that a weekly item would never read as due again. A median is
 * unaffected by one outlier.
 */
export function cadenceDays(entry: PantryEntry): number | null {
  if (entry.buy_count < CADENCE_MIN_BUYS) return null;
  return medianGap(entry.gaps);
}

export type DueState = "due" | "stocked" | "unknown";

export function dueState(
  entry: PantryEntry,
  now: Date = new Date()
): DueState {
  const rhythm = cadenceDays(entry);
  if (rhythm === null) return "unknown";
  const age = daysSince(entry.last_bought_at, now);
  if (age < rhythm) return "stocked";
  return age <= rhythm * CADENCE_STALE_FACTOR ? "due" : "unknown";
}

/**
 * Returns entries that are probably needed again, most overdue first.
 *
 * Ranked by how far past its own rhythm each item is, not by age. Two weeks
 * late on milk matters more than two weeks late on rice, and only the ratio
 * captures that.
 */
export function dueEntries(
  entries: PantryEntry[],
  opts: { now?: Date; onList?: Array<Pick<Task, "title">>; limit?: number } = {}
): PantryEntry[] {
  const now = opts.now ?? new Date();
  const taken = new Set(
    (opts.onList ?? [])
      .map((t) => learnableTerm(t.title))
      .filter((t): t is string => t !== null)
  );

  return entries
    .filter((e) => !taken.has(e.term) && dueState(e, now) === "due")
    .map((entry) => {
      const rhythm = cadenceDays(entry) ?? 1;
      return { entry, ratio: daysSince(entry.last_bought_at, now) / rhythm };
    })
    .sort((a, b) => b.ratio - a.ratio || b.entry.buy_count - a.entry.buy_count)
    .slice(0, opts.limit ?? CADENCE_MAX_SUGGESTIONS)
    .map((s) => s.entry);
}

/**
 * Describes the rhythm in words: "about weekly", "every 3 weeks", and so on.
 *
 * The wording is hedged on purpose. This is inferred from a handful of shopping
 * trips, so "every 7 days" would claim more precision than the data supports.
 * "About weekly" says the same thing and is honest about being an estimate.
 */
export function cadenceLabel(entry: PantryEntry): string {
  const days = cadenceDays(entry);
  if (days === null) return "";
  if (days <= 1) return "about daily";
  if (days <= 4) return `every ${days} days`;
  if (days <= 10) return days >= 6 && days <= 8 ? "about weekly" : `every ${days} days`;
  if (days <= 45) {
    const weeks = Math.round(days / 7);
    return weeks === 4 ? "about monthly" : `every ${weeks} weeks`;
  }
  const months = Math.round(days / 30);
  return months >= 12 ? "about yearly" : `every ${months} months`;
}
