/**
 * Flattening sections into the one list `SectionedDraggableList` renders, and
 * the question flattening makes hard to answer: does this list have anything
 * in it?
 *
 * It has to be answered on the tasks, never on the flattened rows. Every
 * section contributes a header row, and `applyDisplay` emits sections that
 * hold nothing: the "none" grouping always emits exactly one, and a status
 * grouping emits a column per status so there is somewhere to drag a task to.
 * So a list with no tasks still has rows. `DraggableFlatList` decides
 * emptiness from `data.length === 0`, which is therefore never true, so its
 * `ListEmptyComponent` never rendered — and an empty Inbox drew nothing at
 * all, because its one row was the "none" group's 8px spacer header.
 *
 * Plain functions rather than logic inside the component, so the mobile suite
 * can test them: there is no renderer here (see vitest.config.ts).
 */

import type { Task } from '@do-done/shared';

export type DraggableSection = { key: string; title: string; data: Task[] };

export type Row =
  | { kind: 'header'; key: string; section: DraggableSection }
  | { kind: 'task'; key: string; task: Task; sectionKey: string };

/**
 * Sections and their tasks as one list: a header row, then that section's rows.
 *
 * A task row's key is its id unless `rowKey` says otherwise. The key is only
 * what React reconciles on. Everything that names a task to the caller reads
 * `task.id`, so a caller can key rows by something else (a shopping list keys
 * them by id and by which side of the cart they are on) without the ids it is
 * handed back changing shape.
 */
export function flatten(
  sections: DraggableSection[],
  rowKey: (task: Task) => string = (t) => t.id
): Row[] {
  const rows: Row[] = [];
  for (const s of sections) {
    rows.push({ kind: 'header', key: `h:${s.key}`, section: s });
    for (const t of s.data) {
      rows.push({ kind: 'task', key: rowKey(t), task: t, sectionKey: s.key });
    }
  }
  return rows;
}

/**
 * Is there a task in these rows? The list is empty when there isn't, however
 * many headers it happens to be carrying.
 */
export function hasTaskRows(rows: Row[]): boolean {
  return rows.some((r) => r.kind === 'task');
}

/** The ids in one section, in their current order, read back out of the rows. */
export function collectSectionTaskIds(rows: Row[], key: string): string[] {
  const ids: string[] = [];
  let cur: string | null = null;
  for (const r of rows) {
    if (r.kind === 'header') cur = r.section.key;
    else if (cur === key) ids.push(r.task.id);
  }
  return ids;
}

/**
 * What a drop means, decided from where the row started and where it landed.
 *
 * - `hold`: the row was picked up and put down without the finger moving it.
 *   That is a long press, not a drag. A list can give it a meaning of its own
 *   (a shopping list opens its item sheet), and otherwise it does nothing.
 * - `none`: the row was moved and brought back to where it started.
 * - `reorder`: it landed in its own section at a new position.
 * - `move`: it landed in a different section.
 *
 * `hold` and `none` write nothing. They used to reach the reorder branch, since
 * a row that has not moved is still "in its own section". That sent a write
 * restating the order on every long press, and on a list sorted by anything
 * other than manual, the reorder converted the view to manual sort.
 */
export type DropResult =
  | { kind: 'hold'; task: Task }
  | { kind: 'none' }
  | { kind: 'reorder'; sectionKey: string; orderedIds: string[] }
  | {
      kind: 'move';
      taskId: string;
      fromKey: string;
      toKey: string;
      orderedIds: string[];
    };

/**
 * Resolve a drop into the rows to show and what the caller should write.
 *
 * `data` is the library's reordered copy, with the row already at `to`.
 * `placeholderMoved` is whether the drop slot moved at any point during the
 * drag: `from === to` alone cannot tell a row that never left from one that
 * went out and came back.
 */
export function resolveDrop(
  data: Row[],
  from: number,
  to: number,
  placeholderMoved: boolean
): { rows: Row[]; result: DropResult } {
  const moved = data[to];
  if (from === to) {
    return {
      rows: data,
      result:
        moved?.kind === 'task' && !placeholderMoved
          ? { kind: 'hold', task: moved.task }
          : { kind: 'none' },
    };
  }
  if (!moved || moved.kind !== 'task') return { rows: data, result: { kind: 'none' } };
  // The new section is the nearest header at or above the drop position.
  let newKey: string | null = null;
  for (let i = to; i >= 0; i--) {
    const r = data[i];
    if (r.kind === 'header') {
      newKey = r.section.key;
      break;
    }
  }
  if (!newKey) return { rows: data, result: { kind: 'none' } };
  const toKey = newKey;
  const rows = data.map((r) =>
    r.kind === 'task' && r.key === moved.key ? { ...r, sectionKey: toKey } : r
  );
  const orderedIds = collectSectionTaskIds(rows, toKey);
  return {
    rows,
    result:
      moved.sectionKey === toKey
        ? { kind: 'reorder', sectionKey: toKey, orderedIds }
        : {
            kind: 'move',
            taskId: moved.task.id,
            fromKey: moved.sectionKey,
            toKey,
            orderedIds,
          },
  };
}

/**
 * Which row indices pin to the top as the list scrolls.
 *
 * `SectionedDraggableList` is one flat `DraggableFlatList` — headers and tasks
 * in a single array, which is what lets a task be dragged from one section
 * into another — so `SectionList`'s `stickySectionHeadersEnabled` is not
 * available and the indices have to be computed.
 *
 * `ListHeaderComponent` occupies index 0 when present, and VirtualizedList
 * matches these numbers against `dataIndex + stickyOffset` without adding the
 * offset itself. Forget it and every section pins the row after its header —
 * its first task instead of its name.
 *
 * Pass the rows actually being rendered, not the sections: mid-drag that is
 * the local copy, and on a list showing its empty state there are no rows to
 * pin at all.
 *
 * **Nothing is pinned while a row is being dragged.** React Native pins a
 * header by wrapping its cell in `ScrollViewStickyHeader`, so the cell's own
 * `onLayout` reports its position inside that wrapper, which is always 0, and
 * does not fire when the header moves. The drag library uses that event for two
 * things, and both go wrong for a pinned header:
 *
 * - It measures each cell's offset in `onLayout`. A header's offset is taken
 *   once, when it mounts, and is stale as soon as a row above it moves.
 * - While dragging, it shifts the rows between the finger and the row's old
 *   place by one row height. After the drop it holds each row's last shift
 *   until that row's next `onLayout`, so a row does not flicker back before
 *   the reordered data lands.
 *   A pinned header never gets that event, so it keeps the shift. The header
 *   is then drawn one row below its slot, over the first row of its section,
 *   and the slot shows as an empty gap. It stays there until something
 *   remounts the header.
 *
 * Dropping the indices at drag start unwraps the headers, and restoring them
 * at the drop wraps them again. React remounts a header cell each time its
 * wrapper changes, so the header measures itself fresh when the drag starts
 * and cannot carry a shift out of it. The cost: a header pinned at the top of
 * the screen goes back to its place in the list for the length of the drag.
 */
export function stickyHeaderIndices(
  rows: Row[],
  { hasListHeader, dragging }: { hasListHeader: boolean; dragging: boolean }
): number[] {
  if (dragging) return [];
  const offset = hasListHeader ? 1 : 0;
  const indices: number[] = [];
  rows.forEach((row, i) => {
    if (row.kind === 'header') indices.push(i + offset);
  });
  return indices;
}
