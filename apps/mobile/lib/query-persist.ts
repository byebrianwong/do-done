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

// v2: a v1 snapshot can hold a query whose data was a Map, written out by
// JSON.stringify as `{}`. Restoring one is worse than having none — see
// `survivesJsonRoundTrip` — and the shape is not something a reader can
// detect after the fact, so the old snapshots are abandoned rather than
// filtered.
const CACHE_KEY = 'dodone.query-cache.v2';
/** Snapshots from before the JSON-safety rule. Deleted once, on launch. */
const LEGACY_CACHE_KEYS = ['dodone.query-cache.v1'];
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

/**
 * Whether a query's data survives a round trip through JSON.
 *
 * The persister writes the cache with `JSON.stringify`, which has no
 * representation for a Map or a Set: both come back as `{}`. That is not a
 * stale value, it is a *wrong-shaped* one, and the difference matters. Every
 * screen here is built to cope with data that is old or missing; none of them
 * cope with data that has quietly changed type.
 *
 * `useListCounts` caches a Map. Restored from a snapshot it arrived as `{}`,
 * so the first row of the Lists screen called `.get` on it, threw
 * `undefined is not a function`, and took the whole app to the error boundary
 * — on every cold start, for anyone with at least one list. `useAisleMemory`
 * caches one too.
 *
 * A query holding one is therefore not persisted at all. It refetches on
 * launch, which is the case every list screen already handles
 * (`list-load-state.ts` draws a skeleton), and is a far better answer than
 * restoring something that cannot work.
 *
 * Conservative by design: it excludes only when it positively finds a Map or a
 * Set. The depth cap is because the cached shapes are shallow — rows and
 * records — and an uncapped walk over a large task list on every persist would
 * cost more than the rule is worth.
 */
export function survivesJsonRoundTrip(value: unknown, depth = 0): boolean {
  if (value instanceof Map || value instanceof Set) return false;
  if (depth >= 4) return true;
  if (Array.isArray(value)) {
    return value.every((v) => survivesJsonRoundTrip(v, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every((v) =>
      survivesJsonRoundTrip(v, depth + 1)
    );
  }
  return true;
}

/**
 * Delete snapshots written under an older key.
 *
 * Bumping `CACHE_KEY` stops the bad ones being *read*; without this they would
 * sit in AsyncStorage forever, and a task-list snapshot is not small.
 */
export async function dropLegacySnapshots(): Promise<void> {
  if (!isClient) return;
  try {
    await AsyncStorage.multiRemove(LEGACY_CACHE_KEYS);
  } catch {
    // Best-effort housekeeping; nothing on screen depends on it.
  }
}

export const persistOptions = {
  persister: queryPersister,
  maxAge: CACHE_MAX_AGE_MS,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: Query) =>
      query.state.status === 'success' &&
      !isSearchQuery(query.queryKey) &&
      survivesJsonRoundTrip(query.state.data),
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
