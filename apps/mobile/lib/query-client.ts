import { AppState, Platform } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { QueryClient, focusManager } from '@tanstack/react-query';

/**
 * How long a query may sit unobserved before it's collected.
 *
 * This is deliberately the same 24 hours as `CACHE_MAX_AGE_MS` in
 * `query-persist.ts`, and the two have to stay in step. The persisted snapshot
 * is dehydrated from whatever is in this cache, so a shorter `gcTime` would
 * evict a restored list minutes after reading it back — a tab the user hadn't
 * opened yet would be collected before it was ever observed, and the next
 * write-out would persist the cache without it. Launch would then be empty
 * again for exactly the screens that hadn't been visited.
 */
const CACHE_GC_TIME_MS = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cached data shows instantly across tabs; anything older than this
      // refetches in the background when a query mounts or the app refocuses.
      staleTime: 30_000,
      gcTime: CACHE_GC_TIME_MS,
      retry: 1,
      // RN has no window focus; we drive refetch-on-focus via AppState below.
      refetchOnWindowFocus: false,
    },
  },
});

// Treat the app returning to the foreground as a focus event so stale queries
// refetch on resume (e.g. after adding a task via the home-screen widget).
if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (status) => {
      handleFocus(status === 'active');
    });
    return () => sub.remove();
  });
}

/**
 * Refetch a query when the screen regains focus (tab switch / back nav),
 * preserving the old useFocusEffect-reload behavior on top of the shared cache.
 */
export function useRefreshOnFocus(refetch: () => void) {
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );
}

/**
 * Pull-to-refresh state that belongs to the **gesture**, not to the query.
 *
 * `<RefreshControl refreshing={isRefetching} />` reads as obviously right and
 * isn't: `useRefreshOnFocus` above refires every query on every tab switch, so
 * that binding made the platform draw its pull-to-refresh spinner — a control
 * the user is meant to have dragged into view — unprompted at the top of every
 * list, on every tap of the tab bar. A circle appearing out of a gesture nobody
 * made reads as a glitch, and it fired even when the refetch resolved from
 * cache in a few milliseconds.
 *
 * A background refresh already has its own, quieter signal: `UpdatingBar`,
 * which self-delays ~350ms so a fast one shows nothing at all. This spinner is
 * reserved for the drag that asked for it, and stays up for as long as that
 * drag's refetch actually takes.
 */
export function usePullToRefresh(refetch: () => Promise<unknown> | unknown) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // refetch() settles when the request does, whatever its outcome — a failed
    // refresh has to release the spinner too, or the list is stuck spinning.
    Promise.resolve(refetch()).finally(() => setRefreshing(false));
  }, [refetch]);

  return { refreshing, onRefresh };
}
