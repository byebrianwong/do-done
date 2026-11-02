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
// `UNPERSISTED_KEY_PREFIXES` — and the shape is not something a reader can
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
  // No throttle here. Saves are already debounced upstream, before the cache is
  // dehydrated (`subscribeDebouncedPersist`), and a throttle would hold back the
  // flush that runs as the app goes to the background.
  throttleTime: 0,
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
 * The queries that are never written to the snapshot, by key prefix.
 *
 * Decided by key rather than by looking at the data. `dehydrate` asks this of
 * every cached query each time the cache is saved, and an answer that walks the
 * data costs a pass over every cached task. A key is a few string compares.
 *
 * - **Search** is keyed by the query string, so persisting it would keep one
 *   entry per thing the user has ever typed, and a search is re-run on open.
 * - **The rest hold a Map**, which `JSON.stringify` writes as `{}`. That is not
 *   a stale value but one of the wrong *type*. `useListCounts` caches a Map:
 *   restored from a snapshot it arrived as `{}`, the first row of the Lists
 *   screen called `.get` on it, and the whole app went to the error boundary on
 *   every cold start, for anyone with a list. A query left out of the snapshot
 *   refetches on launch and draws a skeleton, which every screen handles.
 *
 * Literal keys rather than imports of `listKeys` and the rest, because those
 * modules pull in the widget, geofence and watch code. `query-persist-keys.test.ts`
 * checks these against the real key factories, and fails when a query that
 * caches a Map or a Set is added without a line here.
 */
export const UNPERSISTED_KEY_PREFIXES: readonly (readonly string[])[] = [
  // useSearchTasks: taskKeys.search(q)
  ['tasks', 'search'],
  // useListCounts: Map<listId, counts>
  ['lists', 'counts'],
  // useAisleMemory: AisleMemory, a ReadonlyMap
  ['aisle-terms'],
  // useSuggestionIndex: SuggestionIndex, an object holding two Maps
  ['suggestions'],
];

function hasPrefix(queryKey: readonly unknown[], prefix: readonly string[]) {
  return prefix.every((part, i) => queryKey[i] === part);
}

/** Whether a query with this key may be written to the snapshot. */
export function isPersistableKey(queryKey: readonly unknown[]): boolean {
  return !UNPERSISTED_KEY_PREFIXES.some((prefix) => hasPrefix(queryKey, prefix));
}

/**
 * A backstop for a Map-holding query that is missing from the list above.
 *
 * Shallow on purpose, so it stays cheap enough to run on every save: it looks
 * at the data itself and, for a plain object, at its own values. An array is
 * not walked at all, which is what keeps a 500-row task list from costing
 * anything. It catches every shape cached today (a Map, and an object holding
 * Maps). The key list is the rule; this only stops a missed entry from taking
 * the app down on the next cold start.
 */
export function holdsMapOrSet(value: unknown): boolean {
  if (value instanceof Map || value instanceof Set) return true;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).some(
    (v) => v instanceof Map || v instanceof Set
  );
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
      isPersistableKey(query.queryKey) &&
      !holdsMapOrSet(query.state.data),
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
