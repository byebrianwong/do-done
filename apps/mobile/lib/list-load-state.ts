/**
 * What a task list should draw while its query is still resolving.
 *
 * The rule this encodes: **"no tasks" is a claim about the data, not a
 * placeholder for the absence of it.** On a cold start the query cache is empty
 * for the first few hundred milliseconds, and every list screen used to render
 * its empty state into that gap — so the app opened by telling the user their
 * day was clear, then quietly filled in. With the cache persisted to
 * AsyncStorage (`query-persist.ts`) that gap is usually filled by yesterday's
 * rows instead, but it still exists on a first run, after a sign-in, and
 * whenever the persisted snapshot is older than `CACHE_MAX_AGE_MS` and gets
 * dropped. So the decision is made once, here, rather than screen by screen.
 *
 * `hasData` is the pivot, and it is `data !== undefined` — *not* `length > 0`.
 * A restored empty list is a real answer ("you finished everything") and gets
 * the empty state; a cache that has never held an answer gets the skeleton.
 *
 * Kept as a plain function over a plain input so the mobile suite can test it:
 * there is no renderer here (see vitest.config.ts), so the hook wrapper below
 * is untested by design and holds no logic of its own.
 */

import { useMemo } from 'react';

export interface ListQueryStatus {
  /** Has the query ever produced a result — from the network *or* the restored cache? */
  hasData: boolean;
  /** A request is in flight (initial load, background refresh, or pull-to-refresh). */
  isFetching: boolean;
  /** The last attempt failed. */
  isError: boolean;
}

export interface ListLoadState {
  /** Draw placeholder rows. Mutually exclusive with the empty and error states. */
  showSkeleton: boolean;
  /** Draw the indeterminate "updating" bar. */
  showUpdating: boolean;
  /** Safe to say the list is genuinely empty. */
  canShowEmpty: boolean;
  /** Nothing to show and no way to get it — offer a retry instead of a spinner forever. */
  showError: boolean;
}

export function listLoadState({
  hasData,
  isFetching,
  isError,
}: ListQueryStatus): ListLoadState {
  // Anything we can show, we show — including a failed refresh over good cache,
  // which is a strictly better answer than an error screen.
  if (hasData) {
    return {
      showSkeleton: false,
      showUpdating: isFetching,
      canShowEmpty: true,
      showError: false,
    };
  }
  // No data and no request left running: a spinner here would never resolve.
  if (isError) {
    return {
      showSkeleton: false,
      showUpdating: false,
      canShowEmpty: false,
      showError: true,
    };
  }
  // Nothing yet. This covers the fetch, and also the window where the persisted
  // cache is being read back — during restore a query is pending and *not*
  // fetching, which is still "we don't know yet", never "there is nothing".
  return {
    showSkeleton: true,
    showUpdating: true,
    canShowEmpty: false,
    showError: false,
  };
}

/** The shape of a useQuery result, narrowed to what the decision needs. */
export interface ListQueryLike {
  data: unknown;
  isFetching: boolean;
  isError: boolean;
}

export function useListLoadState(query: ListQueryLike): ListLoadState {
  const { data, isFetching, isError } = query;
  return useMemo(
    () => listLoadState({ hasData: data !== undefined, isFetching, isError }),
    [data, isFetching, isError]
  );
}
