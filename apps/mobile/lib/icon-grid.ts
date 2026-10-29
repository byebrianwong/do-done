/**
 * The project icon picker's grid, as a flat list of items, and how much of it
 * to mount on each frame.
 *
 * Opening the picker used to mount all 409 Phosphor icons in one render, each a
 * `Pressable` around an SVG, and the panel appeared only once that had finished.
 * The grid now mounts the first screenful at once and the rest a batch per
 * frame. It is not virtualised because it cannot be: it scrolls inside the
 * form's own vertical `ScrollView`, and a `FlatList` there warns and renders
 * every row anyway.
 *
 * The grid is one flat list, with section labels as full-width items, rather
 * than one wrapping `View` per group. All cells are then siblings keyed by the
 * icon alone, so narrowing the list by a search or a group filter unmounts the
 * cells that drop out and keeps the rest mounted. With one container per group,
 * the first keystroke moved every cell to a different parent and remounted all
 * of them.
 */

/**
 * Items mounted in the first render. The grid is 210 px tall and a cell row is
 * 44 px, so about five rows show, at seven to nine cells a row on a phone. This
 * covers that plus the section label above it.
 */
export const ICON_GRID_FIRST_BATCH = 56;

/** Items added on each later frame. */
export const ICON_GRID_BATCH = 64;

export type IconGridItem<T> =
  | { kind: 'label'; key: string; label: string }
  | { kind: 'cell'; key: string; icon: T };

export interface IconGridSection<T> {
  /** Null for the single unlabelled section a narrowed list shows. */
  id: string | null;
  label: string | null;
  icons: readonly T[];
}

/**
 * Flattens sections into grid items. Empty sections are dropped with their
 * label. `keyOf` must be unique across every section: a cell's key is that
 * value alone, which is what keeps it mounted when the sections change.
 */
export function iconGridItems<T>(
  sections: readonly IconGridSection<T>[],
  keyOf: (icon: T) => string,
): IconGridItem<T>[] {
  const items: IconGridItem<T>[] = [];
  for (const section of sections) {
    if (section.icons.length === 0) continue;
    if (section.label && section.id) {
      items.push({
        kind: 'label',
        key: `label:${section.id}`,
        label: section.label,
      });
    }
    for (const icon of section.icons) {
      items.push({ kind: 'cell', key: `icon:${keyOf(icon)}`, icon });
    }
  }
  return items;
}

/** How many items the first render of a grid mounts. */
export function initialRenderCount(total: number): number {
  return Math.min(total, ICON_GRID_FIRST_BATCH);
}

/**
 * How many items to mount after the list changes. A new scope (the panel
 * opening, or a switch between the Icons and Emoji tabs) is a different set of
 * cells, so it starts from the first batch. Within a scope (a search, a group
 * filter) the count already reached is kept, clamped to the new list. That way
 * narrowing remounts nothing, and the scroll position survives.
 */
export function renderCountAfterChange(
  previous: number,
  total: number,
  sameScope: boolean,
): number {
  if (!sameScope) return initialRenderCount(total);
  return Math.max(initialRenderCount(total), Math.min(previous, total));
}

/** How many items the next frame mounts, given how many are mounted now. */
export function nextRenderCount(current: number, total: number): number {
  return Math.min(total, current + ICON_GRID_BATCH);
}
