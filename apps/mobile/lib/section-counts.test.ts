import { describe, expect, it } from 'vitest';

import type { Task } from '@do-done/shared';

import {
  createCountGetters,
  openCount,
  openCountsByKey,
  readCount,
} from './section-counts';

function task(id: string, status: Task['status'] = 'not_started'): Task {
  return { id, title: id, status } as unknown as Task;
}

describe('readCount', () => {
  it('keeps "cannot tell" apart from zero', () => {
    // `sparkReason` skips a rule on null and fires it on 1. A missing count
    // must stay null all the way through, or the tag screen would guess.
    expect(readCount(undefined)).toBeNull();
    expect(readCount(null)).toBeNull();
    expect(readCount(() => null)).toBeNull();
    expect(readCount(0)).toBe(0);
  });

  it('calls a getter at the moment it is read', () => {
    let n = 3;
    const get = () => n;
    n = 1;
    expect(readCount(get)).toBe(1);
  });
});

describe('openCount', () => {
  it('leaves out done and cancelled tasks', () => {
    expect(
      openCount([task('a'), task('b', 'done'), task('c', 'cancelled'), task('d', 'in_progress')])
    ).toBe(2);
  });
});

describe('createCountGetters', () => {
  it('hands out one getter per key, reading the latest counts', () => {
    let counts = openCountsByKey([
      { key: 's', title: 's', data: [task('a'), task('b')] },
    ]);
    const getters = createCountGetters(() => counts);
    const g = getters('s');
    expect(getters('s')).toBe(g);
    expect(g()).toBe(2);
    // A completion elsewhere in the section changes the count, not the getter.
    counts = openCountsByKey([
      { key: 's', title: 's', data: [task('a'), task('b', 'done')] },
    ]);
    expect(getters('s')).toBe(g);
    expect(g()).toBe(1);
  });

  it('answers 0 for a section that is not there', () => {
    // The old fallback handed the row an empty section, whose count is 0.
    const getters = createCountGetters(() => new Map());
    expect(getters('gone')()).toBe(0);
  });
});
