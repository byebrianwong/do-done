import type { Task } from '@do-done/shared';
import { describe, expect, it } from 'vitest';

import {
  appendSubtask,
  applySubtaskStatus,
  draftAfterFailedAdd,
  isSubtaskDone,
  nextSubtaskStatus,
  reinsertSubtask,
  removeSubtask,
  revertSubtaskStatus,
} from './subtask-edits';

function task(id: string, status: Task['status'] = 'not_started'): Task {
  return { id, title: id, status, completed_at: null } as Task;
}

describe('nextSubtaskStatus', () => {
  it('ticks an open subtask', () => {
    expect(nextSubtaskStatus(task('a', 'in_progress'))).toBe('done');
  });

  it('unticks a done or cancelled one', () => {
    expect(nextSubtaskStatus(task('a', 'done'))).toBe('not_started');
    expect(nextSubtaskStatus(task('a', 'cancelled'))).toBe('not_started');
    expect(isSubtaskDone(task('a', 'cancelled'))).toBe(true);
  });
});

describe('applySubtaskStatus', () => {
  const now = new Date('2026-10-29T10:00:00Z');

  it('moves only the named row, and stamps completed_at on done', () => {
    const list = [task('a'), task('b')];
    const next = applySubtaskStatus(list, 'b', 'done', now);
    expect(next[0]).toBe(list[0]);
    expect(next[1]).toMatchObject({ status: 'done', completed_at: now.toISOString() });
  });

  it('clears completed_at on an untick', () => {
    const list = [{ ...task('a', 'done'), completed_at: now.toISOString() }];
    expect(applySubtaskStatus(list, 'a', 'not_started')[0].completed_at).toBeNull();
  });
});

describe('revertSubtaskStatus', () => {
  it('puts the row back when it still shows the failed write', () => {
    const before = task('a');
    const applied = applySubtaskStatus([before], 'a', 'done');
    expect(revertSubtaskStatus(applied, before, 'done')[0]).toBe(before);
  });

  it('leaves a row a later tap has already moved on', () => {
    const before = task('a');
    // Tap 1 ticked it, tap 2 unticked it, then tap 1's write failed.
    const afterTwo = applySubtaskStatus(
      applySubtaskStatus([before], 'a', 'done'),
      'a',
      'not_started'
    );
    expect(revertSubtaskStatus(afterTwo, before, 'done')).toEqual(afterTwo);
  });

  it('does nothing for a row that is gone', () => {
    expect(revertSubtaskStatus([task('b')], task('a'), 'done')).toEqual([task('b')]);
  });
});

describe('removeSubtask / reinsertSubtask', () => {
  it('round-trips a row to the slot it came from', () => {
    const list = [task('a'), task('b'), task('c')];
    const { list: without, removed, index } = removeSubtask(list, 'b');
    expect(without.map((t) => t.id)).toEqual(['a', 'c']);
    expect(index).toBe(1);
    expect(reinsertSubtask(without, removed!, index).map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('reports a missing row as nothing removed', () => {
    expect(removeSubtask([task('a')], 'z')).toMatchObject({ removed: null, index: -1 });
  });

  it('clamps the slot when the list shrank in between', () => {
    const { list: without, removed, index } = removeSubtask(
      [task('a'), task('b'), task('c')],
      'c'
    );
    const shrunk = without.slice(0, 1);
    expect(reinsertSubtask(shrunk, removed!, index).map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('never shows a row twice', () => {
    const list = [task('a'), task('b')];
    expect(reinsertSubtask(list, task('b'), 0).map((t) => t.id)).toEqual(['a', 'b']);
    expect(appendSubtask(list, task('a')).map((t) => t.id)).toEqual(['a', 'b']);
    expect(appendSubtask(list, task('c')).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('draftAfterFailedAdd', () => {
  it('puts the failed title back into an empty field', () => {
    expect(draftAfterFailedAdd('', 'Buy milk')).toBe('Buy milk');
    expect(draftAfterFailedAdd('  ', 'Buy milk')).toBe('Buy milk');
  });

  it('keeps whatever was typed since', () => {
    expect(draftAfterFailedAdd('Call bank', 'Buy milk')).toBe('Call bank');
  });
});
