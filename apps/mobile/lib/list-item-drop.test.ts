import { describe, expect, it } from 'vitest';

import type { AisleMemory, Task, TaskStatus } from '@do-done/shared';

import {
  ALL_SECTION,
  GOT_SECTION,
  OTHER_SECTION,
  aisleSectionKey,
  itemDrop,
} from './list-item-drop';

function item(
  title: string,
  { tags = [], status = 'inbox' }: { tags?: string[]; status?: TaskStatus } = {}
): Pick<Task, 'title' | 'tags' | 'status'> {
  return { title, tags, status };
}

describe('aisleSectionKey', () => {
  it('names an aisle group by its aisle', () => {
    expect(aisleSectionKey({ aisle: 'produce', label: 'Produce' })).toBe(
      'aisle:produce'
    );
  });

  it('tells the collapsed group from Other, though neither has an aisle', () => {
    expect(aisleSectionKey({ aisle: null, label: '' })).toBe(ALL_SECTION);
    expect(aisleSectionKey({ aisle: null, label: 'Other' })).toBe(OTHER_SECTION);
  });
});

describe('itemDrop', () => {
  it('files an item into the aisle it was dropped in, and teaches the words', () => {
    expect(itemDrop(item('bananas'), 'aisle:frozen')).toEqual({
      patch: { tags: ['aisle:frozen'] },
      teach: 'frozen',
    });
  });

  it('keeps the shops on an item it re-files', () => {
    expect(
      itemDrop(item('bananas', { tags: ['at:Target'] }), 'aisle:frozen')?.patch
    ).toEqual({ tags: ['at:Target', 'aisle:frozen'] });
  });

  it('ticks an item dropped into the cart', () => {
    expect(itemDrop(item('bananas'), GOT_SECTION)).toEqual({
      patch: { status: 'done' },
    });
  });

  it('un-ticks an item dragged out of the cart, the way the ring does', () => {
    expect(
      itemDrop(item('bananas', { status: 'done' }), 'aisle:produce')
    ).toEqual({ patch: { status: 'not_started' } });
  });

  it('un-ticks and re-files an item dragged from the cart into another aisle', () => {
    expect(
      itemDrop(item('bananas', { status: 'done' }), 'aisle:frozen')
    ).toEqual({
      patch: { status: 'not_started', tags: ['aisle:frozen'] },
      teach: 'frozen',
    });
  });

  it('un-ticks without touching the aisle when the list is not grouped', () => {
    expect(itemDrop(item('bananas', { status: 'done' }), ALL_SECTION)).toEqual({
      patch: { status: 'not_started' },
    });
  });

  it('reads the current aisle from the memory the sections were grouped with', () => {
    // Taught "zorbs" → produce, so dropping it out of the cart into Produce is
    // not a correction and must not write a tag over the lesson.
    const memory: AisleMemory = new Map([['zorbs', 'produce']]);
    expect(
      itemDrop(item('zorbs', { status: 'done' }), 'aisle:produce', memory)
    ).toEqual({ patch: { status: 'not_started' } });
  });

  describe('into Other', () => {
    it('clears the tag and the lesson when the lexicon does not know the words', () => {
      expect(
        itemDrop(
          item('zorbs', { tags: ['at:Target', 'aisle:produce'] }),
          OTHER_SECTION
        )
      ).toEqual({ patch: { tags: ['at:Target'] }, teach: null });
    });

    it('forgets a lesson that was the only thing filing it', () => {
      const memory: AisleMemory = new Map([['zorbs', 'produce']]);
      expect(itemDrop(item('zorbs'), OTHER_SECTION, memory)).toEqual({
        patch: { tags: [] },
        teach: null,
      });
    });

    /**
     * The rule this encodes: there is no tag meaning "no aisle". Clearing the
     * tag hands milk back to the lexicon, which files it under Dairy, so the
     * row would land somewhere other than where it was dropped. It goes back
     * where it came from instead.
     */
    it('is refused for words the lexicon recognises', () => {
      expect(
        itemDrop(item('milk', { tags: ['aisle:frozen'] }), OTHER_SECTION)
      ).toBeNull();
      expect(itemDrop(item('milk'), OTHER_SECTION)).toBeNull();
    });

    it('only un-ticks an item that is already unrecognised', () => {
      expect(
        itemDrop(item('zorbs', { status: 'done' }), OTHER_SECTION)
      ).toEqual({ patch: { status: 'not_started' } });
    });
  });

  it('refuses a section key it does not know', () => {
    expect(itemDrop(item('bananas'), 'aisle:garden')).toBeNull();
    expect(itemDrop(item('bananas'), 'status:next')).toBeNull();
  });
});
