/**
 * Persist the TanStack Query cache to AsyncStorage so a cold start opens on the
 * lists the user last saw, not on an empty screen.
 *
 * The in-memory cache dies with the process, so every launch used to begin with
 * `data === undefined` on every list — and the screens rendered their empty
 * states into that gap ("Nothing scheduled today"), which reads as *your day is
 * clear* rather than *hold on*. Writing the cache out means the first frame
 * after launch is yesterday's answer, refreshed underneath.
 *
 * Two rules make stale data safe to show:
 *
 * - **`CACHE_MAX_AGE_MS`** — a snapshot older than a day is thrown away whole
 *   rather than rendered. Past that horizon the odds that the list is still
 *   right are poor enough that a skeleton is the more honest answer, and the
 *   screens draw one (see `list-load-state.ts`). `gcTime` in `query-client.ts`
 *   matches this, otherwise a restored query would be collected out of the
 *   cache minutes after being read back in and the next persist would drop it.
 * - **Owner check** — the cache is restored only for the account that wrote it.
 *   This is enforced *inside* `restoreClient`, not from the auth listener,
 *   because clearing after the fact is a race: the restore and the auth event
 *   resolve independently, and the losing order puts the previous user's tasks
 *   on screen. A restore that can't prove ownership returns nothing and drops
 *   the snapshot.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Persister } from '@tanstack/react-query-persist-client';
import type { Query } from '@tanstack/react-query';

import { supabase } from './supabase';
import { queryClient } from './query-client';

/** How long a persisted snapshot may be shown before it's dropped instead. */
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const CACHE_KEY = 'dodone.query-cache.v1';
/** The user id the snapshot under CACHE_KEY belongs to. */
const OWNER_KEY = 'dodone.query-cache.owner';

// Expo pre-renders routes in Node, where `window` is undefined and AsyncStorage
// throws on touch — same guard as lib/supabase.ts.
const isClient = typeof window !== 'undefined';

const storage = isClient
  ? AsyncStorage
  : {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    };

const asyncStoragePersister = createAsyncStoragePersister({
  storage,
  key: CACHE_KEY,
  // The cache is rewritten on every query settle; batch those into one write.
  throttleTime: 1_000,
});

async function currentUserId(): Promise<string | null> {
  if (!isClient) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

async function dropSnapshot(): Promise<void> {
  await asyncStoragePersister.removeClient();
  if (isClient) await AsyncStorage.removeItem(OWNER_KEY);
}

export const queryPersister: Persister = {
  persistClient: (client) => asyncStoragePersister.persistClient(client),
  removeClient: () => dropSnapshot(),
  restoreClient: async () => {
    const [owner, userId] = await Promise.all([
      isClient ? AsyncStorage.getItem(OWNER_KEY) : Promise.resolve(null),
      currentUserId(),
    ]);
    // Signed out, first run, or a different account than the one that wrote it:
    // there is nothing here this session is allowed to show.
    if (!userId || owner !== userId) {
      if (owner !== null) await dropSnapshot();
      return undefined;
    }
    return asyncStoragePersister.restoreClient();
  },
};

/**
 * Search results are keyed by the query string, so persisting them would
 * accumulate one cache entry per thing the user has ever typed — and a search
 * is re-run on open anyway. Everything else (task lists, projects, calendar
 * events) is what the app draws on launch, and is worth carrying across.
 */
function isSearchQuery(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'tasks' && queryKey[1] === 'search';
}

export const persistOptions = {
  persister: queryPersister,
  maxAge: CACHE_MAX_AGE_MS,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: Query) =>
      query.state.status === 'success' && !isSearchQuery(query.queryKey),
  },
};

/**
 * Keep the owner marker in step with the session.
 *
 * Signing out drops the snapshot outright — the next account on this device
 * must not inherit these lists, and `restoreClient`'s check is the backstop,
 * not the only line. Signing in stamps the marker so the *next* launch is
 * allowed to restore what this session is about to write.
 */
async function onSessionChanged(userId: string | null): Promise<void> {
  if (!userId) {
    queryClient.clear();
    await dropSnapshot();
    return;
  }
  const owner = await AsyncStorage.getItem(OWNER_KEY);
  if (owner === userId) return;
  // A different account is taking over the device: anything in memory from the
  // previous one goes with it. (Nothing was restored — restoreClient already
  // refused — but a signed-out browse can still have populated the cache.)
  if (owner !== null) queryClient.clear();
  await AsyncStorage.setItem(OWNER_KEY, userId);
}

if (isClient) {
  supabase.auth.onAuthStateChange((_event, session) => {
    void onSessionChanged(session?.user?.id ?? null).catch(() => {
      // A storage failure here costs a cold start, not correctness: the next
      // restore can't match an owner it couldn't write, so it shows a skeleton.
    });
  });
}
