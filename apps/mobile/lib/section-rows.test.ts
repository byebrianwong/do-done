import { describe, expect, it } from 'vitest';

import type { Task } from '@do-done/shared';

import {
  collectSectionTaskIds,
  flatten,
  hasTaskRows,
  stickyHeaderIndices,
  type DraggableSection,
} from './section-rows';

function task(id: string): Task {
  return { id, title: id } as unknown as Task;
}

function section(key: string, ids: string[]): DraggableSection {
  return { key, title: key, data: ids.map(task) };
}

/**
 * The bug this encodes: an empty Inbox drew nothing at all — no rows, and no
 * "Inbox is empty" either. `applyDisplay` emits a "none" group even with no
 * tasks in it, that group flattens to a header row, and DraggableFlatList
 * only renders `ListEmptyComponent` when `data.length === 0`. So the list was
 * never empty by its own measure, and the header it did have is an 8px
 * spacer. Emptiness is a question about tasks, not about rows.
 */
describe('hasTaskRows', () => {
  it('is false for the group an empty list still produces', () => {
    // What `applyDisplay(…, { group: 'none' })` returns for zero tasks.
    const rows = flatten([{ key: 'none', title: '', data: [] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('header');
    expect(hasTaskRows(rows)).toBe(false);
  });

  it('is false for the empty status columns a grouped list keeps as drop targets', () => {
    const rows = flatten([
      section('status:inbox', []),
      section('status:not_started', []),
      section('status:next', []),
    ]);
    expect(rows.length).toBeGreaterThan(0);
    expect(hasTaskRows(rows)).toBe(false);
  });

  it('is true as soon as one section holds a task', () => {
    const rows = flatten([section('status:inbox', []), section('status:next', ['a'])]);
    expect(hasTaskRows(rows)).toBe(true);
  });
});

describe('flatten', () => {
  it('puts each section behind its own header, in order', () => {
    const rows = flatten([section('a', ['a1', 'a2']), section('b', ['b1'])]);
    expect(rows.map((r) => r.key)).toEqual(['h:a', 'a1', 'a2', 'h:b', 'b1']);
  });

  it('tags every task row with the section it sits under', () => {
    const rows = flatten([section('a', ['a1']), section('b', ['b1'])]);
    const tasks = rows.filter((r) => r.kind === 'task');
    expect(tasks.map((r) => (r.kind === 'task' ? r.sectionKey : null))).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('collectSectionTaskIds', () => {
  it('reads back one section in its current order', () => {
    const rows = flatten([section('a', ['a1', 'a2']), section('b', ['b1'])]);
    expect(collectSectionTaskIds(rows, 'a')).toEqual(['a1', 'a2']);
    expect(collectSectionTaskIds(rows, 'b')).toEqual(['b1']);
  });

  it('returns nothing for a section with no tasks', () => {
    const rows = flatten([section('a', []), section('b', ['b1'])]);
    expect(collectSectionTaskIds(rows, 'a')).toEqual([]);
  });
});

/**
 * Two rules, one of which main's own comment warns about: the offset that
 * `ListHeaderComponent` occupies, and — since an empty list is handed no rows
 * at all — that there is then nothing to pin.
 */
describe('stickyHeaderIndices', () => {
  it('pins each section header where it sits', () => {
    const rows = flatten([section('a', ['a1', 'a2']), section('b', ['b1'])]);
    expect(stickyHeaderIndices(rows, false)).toEqual([0, 3]);
  });

  it('shifts by one when a list header occupies index 0', () => {
    const rows = flatten([section('a', ['a1', 'a2']), section('b', ['b1'])]);
    expect(stickyHeaderIndices(rows, true)).toEqual([1, 4]);
  });

  it('pins nothing on a list rendering its empty state', () => {
    // `showEmpty` hands DraggableFlatList no rows, so indices computed from the
    // sections would point at rows that are not there.
    expect(stickyHeaderIndices([], false)).toEqual([]);
    expect(stickyHeaderIndices([], true)).toEqual([]);
  });
});
