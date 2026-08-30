import type { Project, Task } from "./schemas.js";
import { isListProject } from "./schemas.js";
import { shortDayLabel } from "./task-row.js";
import { formatRelativeDay, formatTimeOfDay, isOverdue } from "./utils.js";

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
 * The store hints on an item.
 *
 * Stored as tags with a reserved prefix rather than a column. Three reasons,
 * and the third is the one that decided it: tags already round-trip through
 * every capture surface, the parser and MCP; `tasks.tags` is already indexed
 * for the `overlaps` query a "what's at this shop" view would want; and a
 * column would have to be nullable on every task in the app to describe a
 * field only shopping items can have. A repeating field is also the one shape
 * a scalar column could not have taken without a join table.
 *
 * An item may carry several. Plenty of things are sold in more than one place,
 * and naming both is what keeps the item in front of you whichever shop you
 * end up in — the same reason `orderForShop` sorts rather than filters. One
 * store was the original rule, on the grounds that "here or here or here" is
 * not much of a hint; but the failure it produced was worse than vagueness.
 * Milk hinted at Trader Joe's sank into "Better elsewhere" while you stood in
 * Target, which also sells milk.
 */
export const STORE_TAG_PREFIX = "at:";

/**
 * Every store named on an item, in tag order, without repeats.
 *
 * Deduplicated on `normalizeStore`, so "Trader Joe's" typed once in the
 * composer and once at the shelf is one store rather than two spellings of it.
 * The first spelling wins, since that is the one already on screen.
 */
export function storeHints(task: Pick<Task, "tags">): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of task.tags ?? []) {
    if (!tag.startsWith(STORE_TAG_PREFIX)) continue;
    const name = tag.slice(STORE_TAG_PREFIX.length).trim();
    if (!name) continue;
    const key = normalizeStore(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** The tag that records a hint. */
export function storeTag(store: string): string {
  return `${STORE_TAG_PREFIX}${store.trim()}`;
}

/**
 * Replace an item's store hints, preserving every other tag.
 *
 * Written as a whole-array swap because `tags` is a `text[]` the app always
 * writes wholesale — there is no add-one-tag endpoint, and a read-modify-write
 * that dropped the user's other tags would be invisible until they looked.
 *
 * An empty list clears the hints, which is what "Anywhere" means.
 */
export function withStoreHints(tags: string[], stores: string[]): string[] {
  const rest = tags.filter((t) => !t.startsWith(STORE_TAG_PREFIX));
  const added: string[] = [];
  const seen = new Set<string>();
  for (const store of stores) {
    const name = store.trim();
    const key = normalizeStore(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    added.push(storeTag(name));
  }
  return [...rest, ...added];
}

/**
 * Add a store to an item. Adding one it already has changes nothing.
 *
 * The three setters below are separate rather than one call with a flag,
 * because the controls really are separate: web's row has an "add a shop"
 * field and one ✕ per shop, and mobile's sheet has a list of shops that toggle.
 * Matching an existing hint uses `normalizeStore`, so "trader joes" typed at
 * the shelf lands on the "Trader Joe's" already there.
 */
export function addStoreHint(tags: string[], store: string): string[] {
  const name = store.trim();
  if (!name) return tags;
  return withStoreHints(tags, [...storeHints({ tags }), name]);
}

/** Take a store off an item. Removing one it does not have changes nothing. */
export function removeStoreHint(tags: string[], store: string): string[] {
  const key = normalizeStore(store);
  if (!key) return tags;
  return withStoreHints(
    tags,
    storeHints({ tags }).filter((s) => normalizeStore(s) !== key)
  );
}

/**
 * Add a store to an item, or take it off again if it is already there.
 *
 * What a list of shops that each tick on and off needs — mobile's item sheet.
 */
export function toggleStoreHint(tags: string[], store: string): string[] {
  const key = normalizeStore(store);
  if (!key) return tags;
  const has = storeHints({ tags }).some((s) => normalizeStore(s) === key);
  return has ? removeStoreHint(tags, store) : addStoreHint(tags, store);
}

/**
 * Names the shops on an item as a phrase: "Target", "Target or Costco",
 * "Target, Costco or Aldi".
 *
 * One phrase rather than one part per store, because the row's subline joins
 * its parts with a middot and the date is one of them. "Target · Costco · Sat"
 * reads as three facts of the same kind, and two of them are not.
 */
export function storeLabel(stores: string[]): string {
  if (stores.length === 0) return "";
  if (stores.length === 1) return stores[0];
  return `${stores.slice(0, -1).join(", ")} or ${stores[stores.length - 1]}`;
}

/**
 * Distinct stores in use on a list, most-used first then alphabetical.
 *
 * An item naming two shops counts once for each, so a shop used only as a
 * second choice still reaches the suggestions.
 */
export function storesOnList(items: Pick<Task, "tags">[]): string[] {
  const counts = new Map<string, number>();
  const spelling = new Map<string, string>();
  for (const item of items) {
    for (const hint of storeHints(item)) {
      const key = normalizeStore(hint);
      if (!spelling.has(key)) spelling.set(key, hint);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([key, n]) => [spelling.get(key) as string, n] as const)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

// ── Typing a store ─────────────────────────────────

/**
 * Matches the run of store tokens at the end of a line.
 *
 * `@` is used rather than `#` because `#` already means "project first, tag
 * otherwise". A shopping list is a project, so `milk #groceries` files an item.
 * Reusing `#` would make `#target` ambiguous once someone names a project
 * Target. `@` also reads correctly out loud: milk at Trader Joe's.
 *
 * The run reaches the end of the line so a store name can contain spaces. Real
 * ones usually do: "Trader Joe's", "Whole Foods", "the corner shop". A `\S+`
 * token would split those into a store called "Trader" and a title ending in
 * "Joe's". So the rule is: the stores go last, and ` @` separates them.
 * `milk @Target @Trader Joe's` is one item at two shops.
 *
 * The first `@` must start the line or follow a space, so an email address in
 * an item name is not treated as a store. A trailing `@` with nothing after it
 * matches nothing, which is the correct reading of a half-typed token.
 *
 * This is not wired into `parseTaskInput`. That parser reads every task title
 * in the app, where `@` usually means a person, so a global rule would file
 * "@sam" as a shop. Only the list composers parse store tokens.
 */
const STORE_TOKENS = /(^|\s)@(\S.*)$/;

/** Splits the matched run on the ` @` that separates one store from the next. */
function splitStores(run: string): string[] {
  return run
    .split(/\s+@/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface StoreTokens {
  /** The item name, with the tokens taken out. */
  title: string;
  /** The stores named, in the order typed. Empty when the text names none. */
  stores: string[];
}

export function extractStoreTokens(text: string): StoreTokens {
  const match = STORE_TOKENS.exec(text);
  if (!match) return { title: text.trim(), stores: [] };
  const stores = splitStores(match[2]);
  const title = text.slice(0, match.index).trim();
  return { title, stores };
}

/**
 * Returns the store token being typed right now, for autocomplete.
 *
 * This differs from `extractStoreTokens`, which reports what the user meant.
 * This reports what they are part-way through, and only the *last* token: with
 * `milk @Target @tra` the open question is "tra", not "Target @tra". A bare "@"
 * returns an empty query, so every store matches and the full list opens on the
 * keypress. The extractor reads the same input as naming no store, which is
 * also correct.
 */
export function typingStoreToken(text: string): string | null {
  const match = /(?:^|\s)@([^@]*)$/.exec(text);
  return match ? match[1] : null;
}

/**
 * The stores already named on the line, not counting the one being typed.
 *
 * The suggestion lists use it to leave out shops that are already on the item,
 * so a second `@` offers the shops you have not picked yet.
 */
export function storesTyped(text: string): string[] {
  const typing = typingStoreToken(text);
  const named = extractStoreTokens(text).stores;
  // The open token is the last entry, and only when one is actually open.
  return typing === null ? named : named.slice(0, named.length - (typing.trim() ? 1 : 0));
}

/** Replace the token being typed with a chosen store, ready to commit. */
export function applyStoreToken(text: string, store: string): string {
  const match = /(?:^|\s)@([^@]*)$/.exec(text);
  const head = match ? text.slice(0, match.index).trim() : text.trim();
  return head ? `${head} @${store}` : `@${store}`;
}

export interface StoreSuggestionOptions {
  limit?: number;
  /** Stores already on the item. Offering them again would only duplicate. */
  exclude?: string[];
}

/**
 * Returns known stores matching the query, best match first.
 *
 * Prefix matches come first, since that is what the typist is steering toward.
 * Substring matches still appear, so "joe" finds "Trader Joe's". Matching uses
 * `normalizeStore`, the same key `sameStore` uses, so punctuation and spacing
 * never decide whether a suggestion shows.
 */
export function storeSuggestions(
  known: string[],
  query: string,
  options: StoreSuggestionOptions = {}
): string[] {
  const { limit = 5, exclude = [] } = options;
  const skip = new Set(exclude.map(normalizeStore).filter(Boolean));
  const pool = known.filter((name) => !skip.has(normalizeStore(name)));
  const q = normalizeStore(query);
  if (!q) return pool.slice(0, limit);
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const name of pool) {
    const key = normalizeStore(name);
    if (key.startsWith(q)) prefix.push(name);
    else if (key.includes(q)) contains.push(name);
  }
  return [...prefix, ...contains].slice(0, limit);
}


// ── Standing in a shop ─────────────────────────────────

export interface ShopOrder<T> {
  /** Buy these here: everything unhinted, plus anything hinted at this shop. */
  here: T[];
  /**
   * Hinted only at other shops. Collapsed under a count, never removed — a
   * hint is a preference ("the bread is better at TJ's"), and treating a
   * preference as a filter is how someone gets home without bread.
   */
  elsewhere: T[];
  /** Already in the cart. */
  got: T[];
}

/**
 * Order a list for the shop you are standing in.
 *
 * `store` is null when we do not know where you are, which is the ordinary case.
 * Then nothing is "elsewhere" and the list is simply itself. That is why the
 * hint sorts rather than filters: the feature has to degrade to a plain list the
 * moment location is unavailable, declined, or not set up, and it does so here
 * rather than at three call sites.
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
    const hints = storeHints(item);
    // No hint means "anywhere", which includes here. A hint naming this shop
    // is obviously here, and one hint naming it is enough — an item sold at
    // Target and Costco is in front of you in either. Only an item whose every
    // hint names somewhere *else* sinks.
    if (!store || hints.length === 0 || hints.some((h) => sameStore(h, store)))
      here.push(item);
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

// ── The item row ───────────────────────────────────

/**
 * Builds the muted line under an item's name, e.g. "Trader Joe's · Sat Aug 30",
 * or "Target or Costco · Sat Aug 30" for an item sold at either.
 *
 * An unset field adds nothing to the line: no placeholder, no empty chip, no
 * reserved space. Most items have a name and nothing else, so most rows are a
 * single word. This matches how `rowSubline` treats a task.
 *
 * This does not call `rowSubline`, because a shopping item and a task need
 * different facts. An item has no project worth naming (it is the list you are
 * looking at), no status worth naming (the tick says it), and no recurrence. It
 * does have a store, which a task row has nowhere to show. The only shared part
 * is the date, which is one call to `shortDayLabel`.
 *
 * The caller joins the parts with a middot, same as `rowSubline`.
 */
export interface ItemSublineContext {
  now?: Date;
  /**
   * Leave the stores out — for a list already grouped by store, where the
   * header above the row has just named it. The store-shaped twin of
   * `rowSubline`'s `projectName: null`.
   */
  hideStore?: boolean;
}

export function itemSubline(item: Task, ctx: ItemSublineContext = {}): string[] {
  const now = ctx.now ?? new Date();
  const parts: string[] = [];

  if (!ctx.hideStore) {
    // One part, not one per store: the caller joins parts with a middot, and
    // "Target · Costco · Sat" would read as three facts of the same kind.
    const stores = storeLabel(storeHints(item));
    if (stores) parts.push(stores);
  }

  // A bought item stops here. Its date is no longer actionable once it is in
  // the cart, so printing it would just label the cart with stale days.
  if (isGot(item)) return parts;

  const when = schedulePart(item, now);
  if (when) parts.push(when);
  if (item.deadline_date) {
    const label = shortDayLabel(item.deadline_date, now);
    if (label) parts.push(`Deadline ${label}`);
  }

  return parts;
}

/**
 * Formats the scheduled day, or the item's age once it is overdue.
 *
 * Overdue items print "3 days ago" rather than a date, same as the task row.
 * That is the actionable form: it tells you this is something you keep
 * forgetting, not just something dated.
 *
 * There is no `hideScheduledDay` option. A shopping list groups by aisle, and
 * an aisle header never names a day, so nothing would ever pass it.
 */
function schedulePart(item: Task, now: Date): string {
  const date = item.scheduled_date;
  const time = item.scheduled_time ? formatTimeOfDay(item.scheduled_time) : "";
  if (!date) return time;

  if (isOverdue(item, now)) {
    const age = formatRelativeDay(date, now);
    const phrase = age
      ? age.charAt(0).toUpperCase() + age.slice(1)
      : shortDayLabel(date, now);
    return time ? `${phrase}, ${time}` : phrase;
  }

  const day = shortDayLabel(date, now);
  return time ? `${day} ${time}` : day;
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
 * An empty list says "Nothing on it" rather than "0 items". Empty is a shopping
 * list's normal resting state, not a number worth printing.
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
