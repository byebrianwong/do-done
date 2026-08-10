/**
 * Tags, counted.
 *
 * A tag is not a row anywhere — `tasks.tags` is a bare `text[]`, with no tag
 * table, no join table and no per-user registry. So "the user's tags" is a
 * question only the task list can answer, and it has to be answered the same
 * way on every surface: web's tags index, mobile's, and the MCP tool an agent
 * asks. That is what this file is for.
 *
 * **Matching is exact, and deliberately so.** `#Work` and `#work` are two
 * tags here because they are two tags in the column, in `applyDisplay`'s tag
 * filter (`tags.some(t => values.includes(t))`) and in PostgREST's
 * `overlaps("tags", …)`. Folding case in the index alone would make the count
 * on the card disagree with the list the card opens — the one thing an index
 * of counts must never do. Normalising tags at the point they are *written*
 * is a real change and a separate one; until then, every reader agrees.
 */

/**
 * Statuses that don't count as open work.
 *
 * `archived` is not in `TaskStatus` and never has been, but every other count
 * in the app guards against it (see `ProjectsApi.listWithCounts`), so this
 * stays in step with them rather than being the one place it is missing.
 */
const CLOSED_STATUSES = new Set(["done", "cancelled", "archived"]);

/** One tag and how much work is filed under it. */
export interface TagSummary {
  tag: string;
  /** Every task carrying the tag, open or finished. */
  task_count: number;
  /** Just the ones still to do — the number worth acting on. */
  open_count: number;
}

/** The shape `summarizeTags` needs. A whole `Task` satisfies it. */
export interface TaggedRow {
  tags: string[] | null;
  status: string;
}

/**
 * Roll a set of task rows up into one summary per distinct tag.
 *
 * Sorted by open count descending, then alphabetically — the tags with work
 * outstanding are the ones being looked for, and ties fall back to an order
 * that doesn't move around as tasks are ticked off. A tag whose every task is
 * finished still appears (`open_count: 0`); it is history rather than noise,
 * and it is the only way to find those tasks again by tag.
 */
export function summarizeTags(rows: TaggedRow[]): TagSummary[] {
  const byTag = new Map<string, TagSummary>();

  for (const row of rows) {
    const open = !CLOSED_STATUSES.has(row.status);
    // A task carrying the same tag twice must not count twice — nothing stops
    // the column holding duplicates, and the editors add without checking.
    for (const tag of new Set(row.tags ?? [])) {
      if (!tag) continue;
      const entry = byTag.get(tag) ?? { tag, task_count: 0, open_count: 0 };
      entry.task_count++;
      if (open) entry.open_count++;
      byTag.set(tag, entry);
    }
  }

  return [...byTag.values()].sort(
    (a, b) => b.open_count - a.open_count || a.tag.localeCompare(b.tag)
  );
}

/**
 * The URL segment for a tag, and its inverse.
 *
 * The quick-add parser only ever emits `\w+`, but the editors' "+ tag" field
 * takes whatever is typed, so a tag can hold a slash or a space and must not
 * be pasted into a path raw. `decodeTagParam` exists because a Next.js dynamic
 * segment arrives already decoded while an Expo Router param does not, and a
 * caller shouldn't have to know which it is holding.
 */
export function encodeTagParam(tag: string): string {
  return encodeURIComponent(tag);
}

export function decodeTagParam(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    // A malformed escape ("%zz") throws rather than round-tripping. The raw
    // segment is a better answer than a crash: it simply matches no tag.
    return param;
  }
}

/** Tasks carrying `tag`, matched exactly. */
export function tasksWithTag<T extends { tags: string[] | null }>(
  tasks: T[],
  tag: string
): T[] {
  return tasks.filter((t) => (t.tags ?? []).includes(tag));
}
