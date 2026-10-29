import { afterEach, describe, expect, it } from 'vitest';
import type { Task } from '@do-done/shared';

import {
  ARRIVAL_GRACE_MS,
  ARRIVAL_WINDOW_MS,
  claimArrival,
  clearArrivals,
  markArriving,
  reinsertTask,
} from './row-arrival';

const t = (id: string) => ({ id }) as Task;
const ids = (list: Task[] | null) => list?.map((x) => x.id);

afterEach(() => clearArrivals());

describe('claimArrival', () => {
  it('is false for an id nothing marked, which is every virtualized remount', () => {
    expect(claimArrival('a', 0)).toBe(false);
  });

  it('is true for a marked id mounting inside the window', () => {
    markArriving(['a'], 0);
    expect(claimArrival('a', ARRIVAL_WINDOW_MS - 1)).toBe(true);
  });

  it('lapses if the row never mounts in time', () => {
    markArriving(['a'], 0);
    expect(claimArrival('a', ARRIVAL_WINDOW_MS)).toBe(false);
  });

  it('lets a second list claim the same id in the grace window', () => {
    markArriving(['a'], 0);
    expect(claimArrival('a', 100)).toBe(true);
    expect(claimArrival('a', 100 + ARRIVAL_GRACE_MS - 1)).toBe(true);
  });

  it('is spent once the grace window after the first mount has passed', () => {
    markArriving(['a'], 0);
    expect(claimArrival('a', 100)).toBe(true);
    // The row was scrolled away and back.
    expect(claimArrival('a', 100 + ARRIVAL_GRACE_MS)).toBe(false);
  });

  it('a later claim cannot stretch the grace window', () => {
    markArriving(['a'], 0);
    claimArrival('a', 100);
    claimArrival('a', 300);
    expect(claimArrival('a', 100 + ARRIVAL_GRACE_MS)).toBe(false);
  });

  it('marking again restarts the window', () => {
    markArriving(['a'], 0);
    claimArrival('a', 100);
    markArriving(['a'], 5_000);
    expect(claimArrival('a', 5_000 + ARRIVAL_GRACE_MS + 10)).toBe(true);
  });
});

describe('reinsertTask', () => {
  it('puts the task back after the row that preceded it', () => {
    const before = [t('a'), t('b'), t('c')];
    expect(ids(reinsertTask([t('a'), t('c')], before, 'b'))).toEqual(['a', 'b', 'c']);
  });

  it('skips predecessors that have since left', () => {
    const before = [t('a'), t('x'), t('b'), t('c')];
    expect(ids(reinsertTask([t('a'), t('c')], before, 'b'))).toEqual(['a', 'b', 'c']);
  });

  it('goes first when nothing that preceded it is left', () => {
    const before = [t('x'), t('b'), t('c')];
    expect(ids(reinsertTask([t('c'), t('d')], before, 'b'))).toEqual(['b', 'c', 'd']);
  });

  it('is a no-op once a refetch has already brought it back', () => {
    const before = [t('a'), t('b')];
    expect(reinsertTask([t('a'), t('b')], before, 'b')).toBeNull();
  });

  it('is a no-op for a list the task was never in', () => {
    expect(reinsertTask([t('a')], [t('a')], 'b')).toBeNull();
  });

  it('restores the object from before, not a copy with the completed status', () => {
    const b = { id: 'b', status: 'in_progress' } as Task;
    const out = reinsertTask([], [b], 'b');
    expect(out?.[0]).toBe(b);
  });
});
