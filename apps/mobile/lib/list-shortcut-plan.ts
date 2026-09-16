/**
 * What the launcher's list shortcuts should be, decided in plain TypeScript.
 *
 * Everything here is pure so the node suite can cover it — `apps/mobile` has no
 * renderer, and none of this is checkable on a device anyway: a wrong id
 * silently orphans a pinned icon, and a wrong label is only visible by
 * long-pressing the app. The native half (`modules/list-shortcuts`) carries
 * these out and decides nothing.
 *
 * Two different shortcuts come out of the same plan, which is why the shape is
 * "every list, plus which one is dynamic":
 *
 * - **Pinned** — one home-screen icon per list, created on request. Android
 *   puts no limit on these, so every list can have one.
 * - **Dynamic** — a single entry in the app icon's long-press menu. One,
 *   because most launchers show four entries there in total and prefer the
 *   manifest ones, so the second dynamic shortcut would evict a second static
 *   quick action to no purpose.
 */
import type { Project } from '@do-done/shared';

/**
 * Prefixed so the sync can tell its own shortcuts from the five static quick
 * actions when it diffs what the launcher is holding. The uuid follows
 * verbatim, so the id is stable for the life of the list — which is what lets a
 * pinned icon survive a rename and what makes a deleted list's icon findable.
 */
export const LIST_SHORTCUT_PREFIX = 'list:';

/**
 * Android's own guidance: about 10 characters under the icon, about 25 in the
 * menu. Both are advisory — the launcher truncates rather than refusing — but
 * it truncates by clipping, and an ellipsis reads better than a cut word.
 */
export const SHORT_LABEL_MAX = 10;
export const LONG_LABEL_MAX = 25;

/** What a shortcut whose list is gone says when its pinned icon is tapped. */
export const DELETED_LIST_MESSAGE = 'This list was deleted.';

export type ListShortcut = {
  id: string;
  shortLabel: string;
  longLabel: string;
  url: string;
  color: string;
};

export type ListShortcutPlan = {
  /** Every list, in the user's own order. */
  shortcuts: ListShortcut[];
  /** The one that takes the long-press menu slot, or null. */
  dynamicId: string | null;
};

/** A list's shortcut id. */
export function listShortcutId(listId: string): string {
  return `${LIST_SHORTCUT_PREFIX}${listId}`;
}

/** The list a shortcut id names, or null if it is not one of ours. */
export function listIdFromShortcutId(shortcutId: string): string | null {
  return shortcutId.startsWith(LIST_SHORTCUT_PREFIX)
    ? shortcutId.slice(LIST_SHORTCUT_PREFIX.length)
    : null;
}

/** The deep link a list shortcut opens. `app/(tabs)/lists/[id].tsx`. */
export function listShortcutUrl(listId: string): string {
  return `dodone://lists/${listId}`;
}

/**
 * Trim to `max`, on a word boundary where there is one worth using.
 *
 * "Hardware store" becomes "Hardware…" rather than "Hardware s…" — the second
 * says no more than the first and looks like a rendering fault. A single long
 * word is cut mid-word, because there is nothing else to do with it.
 */
export function truncateLabel(name: string, max: number): string {
  const trimmed = name.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  // Only respect a space that leaves most of the budget spent; otherwise a
  // name like "A very long one" would shrink to "A…".
  const body = lastSpace >= Math.floor((max - 1) / 2) ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

/**
 * A list's shortcut.
 *
 * An empty name cannot happen through the app — `ProjectSchema` requires one
 * character — but `ShortcutInfoCompat.Builder` throws on an empty short label,
 * so a row that arrived some other way must not be able to take the sync down
 * with it.
 */
export function listShortcutFor(
  list: Pick<Project, 'id' | 'name' | 'color'>
): ListShortcut {
  const name = list.name.trim() || 'List';
  return {
    id: listShortcutId(list.id),
    shortLabel: truncateLabel(name, SHORT_LABEL_MAX),
    longLabel: truncateLabel(name, LONG_LABEL_MAX),
    url: listShortcutUrl(list.id),
    color: list.color,
  };
}

/**
 * Which lists get a shortcut, and which one takes the menu slot.
 *
 * The menu slot goes to the list you were last in — the same memory the Lists
 * tab opens on (`lib/tab-resume.ts`), so the launcher and the tab agree about
 * which list is *yours* rather than offering two different answers to the same
 * question.
 *
 * With nothing remembered it falls back to the first list in the user's own
 * order. An empty slot would be the alternative, and it is worse: someone who
 * has never opened a list from the tab is exactly who would benefit from
 * finding one in the menu, and the fallback corrects itself the moment they
 * open any list.
 */
export function planListShortcuts(input: {
  lists: Pick<Project, 'id' | 'name' | 'color'>[];
  lastListId: string | null;
}): ListShortcutPlan {
  const shortcuts = input.lists.map(listShortcutFor);
  if (shortcuts.length === 0) return { shortcuts, dynamicId: null };

  const remembered =
    input.lastListId !== null &&
    input.lists.some((list) => list.id === input.lastListId)
      ? listShortcutId(input.lastListId)
      : null;

  return { shortcuts, dynamicId: remembered ?? shortcuts[0].id };
}
