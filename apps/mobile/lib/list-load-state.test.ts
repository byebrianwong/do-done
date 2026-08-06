import { describe, expect, it } from 'vitest';

import { listLoadState } from './list-load-state';

/**
 * The bug this encodes: on a cold start every list screen rendered its empty
 * state ("Nothing scheduled today") into the window before the first fetch
 * resolved, so the app opened by telling the user their day was clear and then
 * quietly filled in. `canShowEmpty` is the gate, and it is false for every
 * state in which we don't have an answer.
 */
describe('listLoadState', () => {
  it('never claims the list is empty before an answer arrives', () => {
    const s = listLoadState({ hasData: false, isFetching: true, isError: false });
    expect(s.canShowEmpty).toBe(false);
    expect(s.showSkeleton).toBe(true);
    expect(s.showUpdating).toBe(true);
  });

  it('shows the skeleton while the persisted cache is being read back', () => {
    // During restore a query is pending and *not* fetching — TanStack pauses
    // fetches until hydration finishes. That is still "we don't know yet".
    const s = listLoadState({ hasData: false, isFetching: false, isError: false });
    expect(s.showSkeleton).toBe(true);
    expect(s.canShowEmpty).toBe(false);
    expect(s.showError).toBe(false);
  });

  it('treats a restored empty list as a real answer', () => {
    // `hasData` is `data !== undefined`, not `length > 0`: a user who finished
    // everything yesterday should see "you're done", not a skeleton.
    const s = listLoadState({ hasData: true, isFetching: false, isError: false });
    expect(s.canShowEmpty).toBe(true);
    expect(s.showSkeleton).toBe(false);
    expect(s.showUpdating).toBe(false);
  });

  it('keeps cached rows on screen while the refresh runs', () => {
    const s = listLoadState({ hasData: true, isFetching: true, isError: false });
    expect(s.showSkeleton).toBe(false);
    expect(s.canShowEmpty).toBe(true);
    expect(s.showUpdating).toBe(true);
  });

  it('prefers stale data to an error screen when the refresh fails', () => {
    const s = listLoadState({ hasData: true, isFetching: false, isError: true });
    expect(s.showError).toBe(false);
    expect(s.canShowEmpty).toBe(true);
  });

  it('offers a retry rather than a skeleton that can never resolve', () => {
    // Nothing cached and nothing in flight: an offline first launch. A pulsing
    // skeleton here would wait forever.
    const s = listLoadState({ hasData: false, isFetching: false, isError: true });
    expect(s.showError).toBe(true);
    expect(s.showSkeleton).toBe(false);
    expect(s.showUpdating).toBe(false);
    expect(s.canShowEmpty).toBe(false);
  });

  it('is mutually exclusive across skeleton / empty / error', () => {
    for (const hasData of [true, false]) {
      for (const isFetching of [true, false]) {
        for (const isError of [true, false]) {
          const s = listLoadState({ hasData, isFetching, isError });
          const claims = [s.showSkeleton, s.canShowEmpty, s.showError].filter(
            Boolean
          );
          expect(claims).toHaveLength(1);
        }
      }
    }
  });
});
