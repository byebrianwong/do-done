import { AppState, Platform } from 'react-native';
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { QueryClient, focusManager } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cached data shows instantly across tabs; anything older than this
      // refetches in the background when a query mounts or the app refocuses.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
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
