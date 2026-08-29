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
