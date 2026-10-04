/**
 * What dropping a shopping-list item into a section writes.
 *
 * A list's sections are its aisles in walking order, a trailing "Other" for
 * words the lexicon does not know, and "Got it" for the cart. A drop into one
 * of them says "this item belongs here", and the write is whatever makes the
 * item land there on the next render:
 *
 * | Dropped into | Write |
 * | --- | --- |
 * | an aisle | an aisle tag, and the same lesson the item sheet teaches |
 * | Other | clear the tag and the lesson, if the lexicon does not know the words |
 * | Got it | `status: 'done'`, which records the buy in the pantry |
 * | out of Got it | `status: 'not_started'`, as an un-tick on the ring does |
 *
 * **A drop that cannot be expressed is refused, and the row goes back.** The one
 * case is Other for an item the lexicon recognises. There is no tag that means
 * "no aisle", because a stored blank would be a third state that has to beat the
 * guess (see *Aisle corrections are remembered* in CLAUDE.md). Clearing the tag
 * hands the words back to the lexicon, which would put milk straight back in
 * Dairy. A row that lands somewhere other than where the finger left it reads
 * as a bug, so it returns to where it was picked up instead.
 *
 * Pure, so the node suite covers it. `apps/mobile` has no renderer.
 */

import {
  AISLES,
  categorizeItem,
  isGot,
  itemAisle,
  withAisle,
  type Aisle,
  type AisleGroup,
  type AisleMemory,
  type Task,
  type UpdateTaskInput,
} from '@do-done/shared';

/** The cart. */
export const GOT_SECTION = 'got';
/** The one unlabelled group a short or single-aisle list collapses to. */
export const ALL_SECTION = 'all';
/** The trailing group of items the lexicon does not recognise. */
export const OTHER_SECTION = 'other';

const AISLE_PREFIX = 'aisle:';

/** The section key for one of `groupByAisle`'s groups. */
export function aisleSectionKey(group: Pick<AisleGroup<unknown>, 'aisle' | 'label'>): string {
  if (group.aisle) return `${AISLE_PREFIX}${group.aisle}`;
  // Both the collapsed group and "Other" have no aisle. Only "Other" has a label.
  return group.label === '' ? ALL_SECTION : OTHER_SECTION;
}

function aisleFromKey(key: string): Aisle | null {
  if (!key.startsWith(AISLE_PREFIX)) return null;
  const name = key.slice(AISLE_PREFIX.length);
  return (AISLES as readonly string[]).includes(name) ? (name as Aisle) : null;
}

export interface ItemDrop {
  /** The write for the moved item. Empty when only its position changed. */
  patch: UpdateTaskInput;
  /**
   * What to teach about the item's words: an aisle to remember, `null` to
   * forget the lesson, absent to leave it alone.
   */
  teach?: Aisle | null;
}

/**
 * The write that files `item` into the section `toKey`, or null when no write
 * can put it there.
 *
 * `memory` must be the one the sections were grouped with, so "where is it
 * now" is answered the way the screen answered it.
 */
export function itemDrop(
  item: Pick<Task, 'title' | 'tags' | 'status'>,
  toKey: string,
  memory?: AisleMemory
): ItemDrop | null {
  if (toKey === GOT_SECTION) {
    return isGot(item) ? { patch: {} } : { patch: { status: 'done' } };
  }

  // Every other section is a place to buy it, so a bought item is un-ticked.
  const patch: UpdateTaskInput = isGot(item) ? { status: 'not_started' } : {};
  if (toKey === ALL_SECTION) return { patch };

  const current = itemAisle(item, memory);

  if (toKey === OTHER_SECTION) {
    if (current === null) return { patch };
    // Clearing the tag and the lesson leaves only the lexicon's guess. That
    // lands the item in Other only when the lexicon does not know the words.
    if (categorizeItem(item.title) !== null) return null;
    return { patch: { ...patch, tags: withAisle(item.tags, null) }, teach: null };
  }

  const aisle = aisleFromKey(toKey);
  if (!aisle) return null;
  // Out of the cart and back to the aisle it was already in: no correction.
  if (aisle === current) return { patch };
  return { patch: { ...patch, tags: withAisle(item.tags, aisle) }, teach: aisle };
}
