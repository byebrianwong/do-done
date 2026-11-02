import { describe, expect, it } from 'vitest';

import { FOCUS_REFRESH_STALE_MS, shouldRefetchOnFocus } from './focus-refresh';

const NOW = 1_000_000;

describe('shouldRefetchOnFocus', () => {
  it('skips the focus that comes with the mount, whose fetch is already running', () => {
    // Refetching here cancelled the mount fetch and started it again: two
    // requests per list on every cold start.
    expect(
      shouldRefetchOnFocus({ firstFocus: true, dataUpdatedAt: 0, now: NOW })
    ).toBe(false);
    expect(
      shouldRefetchOnFocus({ firstFocus: true, dataUpdatedAt: 1, now: NOW })
    ).toBe(false);
  });

  it('leaves data fetched moments ago alone', () => {
    expect(
      shouldRefetchOnFocus({
        firstFocus: false,
        dataUpdatedAt: NOW - FOCUS_REFRESH_STALE_MS + 1,
        now: NOW,
      })
    ).toBe(false);
  });

  it('refetches data older than the threshold', () => {
    expect(
      shouldRefetchOnFocus({
        firstFocus: false,
        dataUpdatedAt: NOW - FOCUS_REFRESH_STALE_MS,
        now: NOW,
      })
    ).toBe(true);
  });

  it('refetches a list that has never loaded', () => {
    expect(
      shouldRefetchOnFocus({ firstFocus: false, dataUpdatedAt: 0, now: NOW })
    ).toBe(true);
  });

  it('is shorter than the default staleTime, so a return after a while still refreshes', () => {
    expect(FOCUS_REFRESH_STALE_MS).toBeLessThan(30_000);
  });
});
