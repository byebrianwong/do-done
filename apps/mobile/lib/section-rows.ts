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

/** Sections and their tasks as one list: a header row, then that section's rows. */
export function flatten(sections: DraggableSection[]): Row[] {
  const rows: Row[] = [];
  for (const s of sections) {
    rows.push({ kind: 'header', key: `h:${s.key}`, section: s });
    for (const t of s.data) {
      rows.push({ kind: 'task', key: t.id, task: t, sectionKey: s.key });
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
    else if (cur === key) ids.push(r.key);
  }
  return ids;
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
 */
export function stickyHeaderIndices(
  rows: Row[],
  hasListHeader: boolean
): number[] {
  const offset = hasListHeader ? 1 : 0;
  const indices: number[] = [];
  rows.forEach((row, i) => {
    if (row.kind === 'header') indices.push(i + offset);
  });
  return indices;
}
