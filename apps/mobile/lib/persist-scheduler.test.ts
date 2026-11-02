/**
 * The persisted cache is saved once the cache goes quiet, not on every event.
 *
 * What this guards cannot be seen on a device: TanStack's own subscription
 * dehydrated the whole cache on every cache event, and one task write produces
 * dozens. The assertions are about how many saves a burst produces, and that a
 * waiting save is never lost when the app goes to the background.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import {
  PERSIST_IDLE_MS,
  PERSIST_MAX_WAIT_MS,
  createSaveScheduler,
  subscribeDebouncedPersist,
} from './persist-scheduler';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createSaveScheduler', () => {
  it('saves once after a burst goes quiet', async () => {
    const save = vi.fn();
    const s = createSaveScheduler({ save });
    for (let i = 0; i < 30; i++) {
      s.schedule();
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PERSIST_IDLE_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(s.pending()).toBe(false);
  });

  it('saves anyway once events have kept arriving for the max wait', async () => {
    const save = vi.fn();
    const s = createSaveScheduler({ save });
    // An event every second never lets the 1.5s idle timer fire.
    for (let t = 0; t < PERSIST_MAX_WAIT_MS + 1_000; t += 1_000) {
      s.schedule();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush saves a waiting change at once and does not save it twice', async () => {
    const save = vi.fn();
    const s = createSaveScheduler({ save });
    s.schedule();
    await s.flush();
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PERSIST_IDLE_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush with nothing waiting writes nothing', async () => {
    const save = vi.fn();
    await createSaveScheduler({ save }).flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('a failed save does not stop the next one', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('disk full'));
    const s = createSaveScheduler({ save });
    s.schedule();
    await vi.advanceTimersByTimeAsync(PERSIST_IDLE_MS);
    s.schedule();
    await vi.advanceTimersByTimeAsync(PERSIST_IDLE_MS);
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe('subscribeDebouncedPersist', () => {
  function setup() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const save = vi.fn();
    let background: (() => void) | null = null;
    const unsubscribe = subscribeDebouncedPersist({
      queryClient,
      save,
      onBackground: (flush) => {
        background = flush;
        return () => {
          background = null;
        };
      },
    });
    return { queryClient, save, unsubscribe, goBackground: () => background?.() };
  }

  it('turns a burst of cache writes into one save', async () => {
    const { queryClient, save } = setup();
    for (let i = 0; i < 40; i++) {
      queryClient.setQueryData(['tasks', 'list', String(i % 4)], [{ id: i }]);
    }
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PERSIST_IDLE_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flushes a waiting save when the app goes to the background', async () => {
    const { queryClient, save, goBackground } = setup();
    queryClient.setQueryData(['tasks', 'list', 'today'], []);
    goBackground();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    // The idle timer it replaced does not save a second time.
    await vi.advanceTimersByTimeAsync(PERSIST_IDLE_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('going to the background with nothing changed writes nothing', async () => {
    const { save, goBackground } = setup();
    goBackground();
    await vi.advanceTimersByTimeAsync(PERSIST_IDLE_MS);
    expect(save).not.toHaveBeenCalled();
  });

  it('unsubscribing flushes rather than dropping a waiting save', async () => {
    const { queryClient, save, unsubscribe } = setup();
    queryClient.setQueryData(['tasks', 'list', 'today'], []);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    queryClient.setQueryData(['tasks', 'list', 'today'], [{ id: 1 }]);
    await vi.advanceTimersByTimeAsync(PERSIST_IDLE_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
