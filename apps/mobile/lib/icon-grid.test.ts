import { describe, expect, it } from 'vitest';
import {
  PHOSPHOR_CATALOGUE,
  PROJECT_ICON_GROUPS,
  searchPhosphorIcons,
} from '@do-done/shared';
import {
  ICON_GRID_BATCH,
  ICON_GRID_FIRST_BATCH,
  iconGridItems,
  initialRenderCount,
  nextRenderCount,
} from './icon-grid';

const phosphorSections = PHOSPHOR_CATALOGUE.map((g) => ({
  id: g.id,
  label: g.label,
  icons: g.icons,
}));

const emojiSections = PROJECT_ICON_GROUPS.map((g) => ({
  id: g.id,
  label: g.label,
  icons: g.icons,
}));

describe('iconGridItems', () => {
  it('gives every Phosphor item a unique key', () => {
    const items = iconGridItems(phosphorSections, (i) => i.name);
    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every emoji item a unique key', () => {
    const items = iconGridItems(emojiSections, (i) => i.char);
    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // The point of the flat list: a cell keeps its key when the list narrows, so
  // React keeps it mounted instead of building it again.
  it('keys a cell the same way whether the list is sectioned or narrowed', () => {
    const full = iconGridItems(phosphorSections, (i) => i.name);
    const narrowed = iconGridItems(
      [{ id: null, label: null, icons: searchPhosphorIcons('house') }],
      (i) => i.name,
    );
    expect(narrowed.length).toBeGreaterThan(0);
    const fullKeys = new Set(full.map((i) => i.key));
    for (const item of narrowed) {
      expect(item.kind).toBe('cell');
      expect(fullKeys.has(item.key)).toBe(true);
    }
  });

  it('drops an empty section together with its label', () => {
    const items = iconGridItems(
      [
        { id: 'a', label: 'A', icons: [] },
        { id: 'b', label: 'B', icons: ['x'] },
      ],
      (i) => i,
    );
    expect(items.map((i) => i.key)).toEqual(['label:b', 'icon:x']);
  });
});

describe('render counts', () => {
  it('mounts at most the first batch on the first render', () => {
    expect(initialRenderCount(409)).toBe(ICON_GRID_FIRST_BATCH);
    expect(initialRenderCount(10)).toBe(10);
    expect(initialRenderCount(0)).toBe(0);
  });

  it('reaches the whole list and stops there', () => {
    const total = iconGridItems(phosphorSections, (i) => i.name).length;
    let count = initialRenderCount(total);
    let frames = 0;
    while (count < total) {
      const next = nextRenderCount(count, total);
      expect(next - count).toBeLessThanOrEqual(ICON_GRID_BATCH);
      expect(next).toBeGreaterThan(count);
      count = next;
      frames += 1;
    }
    expect(count).toBe(total);
    expect(nextRenderCount(count, total)).toBe(total);
    // About a tenth of a second at 60 fps, all of it below the visible rows.
    expect(frames).toBeLessThanOrEqual(8);
  });
});
