import type { Project, Task } from "./schemas.js";
import { isListProject } from "./schemas.js";

/**
 * Shopping lists: the decisions, as pure functions.
 *
 * Everything here answers a question both apps ask and neither should answer
 * for itself — what counts as "left to buy", how a store hint reorders the
 * list you are standing in front of, and what a list's one-line summary says.
 * `apps/mobile` has no renderer in CI, so a rule that lives in a component is
 * a rule that is never tested; the same reason `task-row.ts` exists.
 */

// ── What's on the list ─────────────────────────────────

/**
 * A list item is "got" once it reaches a terminal status. Deliberately the
 * same two statuses that end a task, rather than a state of its own: the
 * completion gesture, undo, the optimistic cache patch and the exit animation
 * are all keyed on `done`, and giving shopping its own "bought" flag would
 * mean reimplementing every one of them for the one surface that can least
 * afford a bug (you are holding the phone in one hand in a shop).
 */
export function isGot(task: Pick<Task, "status">): boolean {
  return task.status === "done" || task.status === "cancelled";
}

/** Items still to buy, in the order they were added. */
export function openItems<T extends Pick<Task, "status">>(items: T[]): T[] {
  return items.filter((t) => !isGot(t));
}

/** Items already in the cart this trip. */
export function gotItems<T extends Pick<Task, "status">>(items: T[]): T[] {
  return items.filter((t) => isGot(t));
}

// ── Store hints ────────────────────────────────────────

/**
 * The store hint on an item, or null when it has none.
 *
 * Stored as a tag with a reserved prefix rather than a column. Three reasons,
 * and the third is the one that decided it: tags already round-trip through
 * every capture surface, the parser and MCP; `tasks.tags` is already indexed
 * for the `overlaps` query a "what's at this shop" view would want; and a
 * column would have to be nullable on every task in the app to describe a
 * field only shopping items can have.
 *
 * An item carries at most one — a hint that says "here or here or here" has
 * stopped being a hint. The first wins, so a second one typed by hand is
 * ignored rather than silently changing what the row means.
 */
export const STORE_TAG_PREFIX = "at:";

export function storeHint(task: Pick<Task, "tags">): string | null {
  for (const tag of task.tags ?? []) {
    if (tag.startsWith(STORE_TAG_PREFIX)) {
      const name = tag.slice(STORE_TAG_PREFIX.length).trim();
      if (name) return name;
    }
  }
  return null;
}

/** The tag that records a hint. `null` clears it. */
export function storeTag(store: string): string {
  return `${STORE_TAG_PREFIX}${store.trim()}`;
}

/**
 * Replace an item's store hint, preserving every other tag.
 *
 * Written as a whole-array swap because `tags` is a `text[]` the app always
 * writes wholesale — there is no add-one-tag endpoint, and a read-modify-write
 * that dropped the user's other tags would be invisible until they looked.
 */
export function withStoreHint(tags: string[], store: string | null): string[] {
  const rest = tags.filter((t) => !t.startsWith(STORE_TAG_PREFIX));
  return store && store.trim() ? [...rest, storeTag(store)] : rest;
}

/** Distinct store hints in use on a list, most-used first then alphabetical. */
export function storesOnList(items: Pick<Task, "tags">[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const hint = storeHint(item);
    if (hint) counts.set(hint, (counts.get(hint) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

// ── Standing in a shop ─────────────────────────────────

export interface ShopOrder<T> {
  /** Buy these here: everything unhinted, plus anything hinted at this shop. */
  here: T[];
  /**
   * Hinted at a different shop. Collapsed under a count, never removed —
   * a hint is a preference ("the bread is better at TJ's"), and treating a
   * preference as a filter is how someone gets home without bread.
   */
  elsewhere: T[];
  /** Already in the cart. */
  got: T[];
}

/**
 * Order a list for the shop you are standing in.
 *
 * `store` is null when we don't know where you are, which is the ordinary
 * case — then nothing is "elsewhere" and the list is simply itself. That is
 * the whole reason the hint sorts rather than filters: the feature has to
 * degrade to "a plain list" the moment location is unavailable, declined, or
 * simply not set up, and it does so here rather than at three call sites.
 */
export function orderForShop<T extends Pick<Task, "status" | "tags">>(
  items: T[],
  store: string | null
): ShopOrder<T> {
  const here: T[] = [];
  const elsewhere: T[] = [];
  const got: T[] = [];

  for (const item of items) {
    if (isGot(item)) {
      got.push(item);
      continue;
    }
    const hint = storeHint(item);
    // No hint means "anywhere", which includes here. A hint naming this shop
    // is obviously here. Only a hint naming somewhere *else* sinks.
    if (!store || !hint || sameStore(hint, store)) here.push(item);
    else elsewhere.push(item);
  }

  return { here, elsewhere, got };
}

/**
 * Whether a hint refers to the shop we think we're in.
 *
 * Loose on purpose: the hint is typed by a person ("trader joes") and the shop
 * name comes from OpenStreetMap ("Trader Joe's #142"), so exact equality would
 * make the feature appear broken precisely when it had the right answer. Match
 * on a normalised key, and let either side contain the other so a branch
 * number or a street suffix doesn't break it.
 */
export function sameStore(a: string, b: string): boolean {
  const x = normalizeStore(a);
  const y = normalizeStore(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** Lowercase, alphanumerics only — the same shape as `matchProject`'s key. */
export function normalizeStore(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ── Summarising a list ─────────────────────────────────

export interface ListSummary {
  /** Items still to buy. */
  open: number;
  /** Items in the cart, waiting to be cleared. */
  got: number;
  /** Of the open ones, how many are hinted at another shop. Needs a store. */
  elsewhere: number;
}

export function summarizeList(
  items: Pick<Task, "status" | "tags">[],
  store: string | null = null
): ListSummary {
  const { here, elsewhere, got } = orderForShop(items, store);
  return { open: here.length + elsewhere.length, got: got.length, elsewhere: elsewhere.length };
}

/**
 * The line under a list's name — "8 items", "8 items · 3 in the cart".
 *
 * An empty list says "Nothing on it" rather than "0 items": empty is a
 * shopping list's normal resting state, not a number worth printing, and the
 * count reads as an achievement when it is really just Tuesday.
 */
export function listSubline(summary: ListSummary): string {
  const parts: string[] = [];
  if (summary.open === 0) parts.push("Nothing on it");
  else parts.push(`${summary.open} item${summary.open === 1 ? "" : "s"}`);
  if (summary.got > 0) parts.push(`${summary.got} in the cart`);
  return parts.join(" · ");
}

// ── Splitting projects from lists ──────────────────────

export interface SplitProjects<P> {
  projects: P[];
  lists: P[];
}

/**
 * Split a project list into the two sidebar sections.
 *
 * One pass rather than two filters at each of the six call sites, and — more
 * to the point — one place that decides what an absent `kind` means. Both
 * apps' navs, both pickers and the demo sandbox call this.
 */
export function splitProjects<P extends Pick<Project, "kind">>(
  all: P[]
): SplitProjects<P> {
  const projects: P[] = [];
  const lists: P[] = [];
  for (const p of all) (isListProject(p) ? lists : projects).push(p);
  return { projects, lists };
}
