import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The persisted query cache is what stops a cold start from opening on "no
 * tasks". What this suite guards is the part that can't be seen on a device
 * until it's already wrong: *whose* tasks come back.
 *
 * The ownership check lives inside `restoreClient` rather than in the auth
 * listener on purpose — restore and the auth event resolve independently, so
 * clearing after the fact is a race the previous user's data can win. These
 * tests pin that placement: restore itself refuses, before anything is handed
 * to the query client.
 *
 * Native seams stood in for here: AsyncStorage (no device), the storage
 * persister it wraps, the Supabase auth client, and the query client itself.
 */

const CACHE_KEY = 'dodone.query-cache.v1';
const OWNER_KEY = 'dodone.query-cache.owner';

const h = vi.hoisted(() => {
  const store = new Map<string, string>();
  const snapshot = { timestamp: 1, buster: '', clientState: {} };
  return {
    store,
    snapshot,
    asyncStorage: {
      getItem: vi.fn(async (k: string) => store.get(k) ?? null),
      setItem: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      removeItem: vi.fn(async (k: string) => {
        store.delete(k);
      }),
    },
    inner: {
      persistClient: vi.fn(async () => {}),
      restoreClient: vi.fn(async () => snapshot),
      removeClient: vi.fn(async () => {
        store.delete(CACHE_KEY);
      }),
    },
    auth: {
      userId: null as string | null,
      listeners: [] as Array<(event: string, session: unknown) => void>,
    },
    queryClient: { clear: vi.fn() },
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: h.asyncStorage,
}));

vi.mock('@tanstack/query-async-storage-persister', () => ({
  createAsyncStoragePersister: () => h.inner,
}));

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: {
          session: h.auth.userId ? { user: { id: h.auth.userId } } : null,
        },
      }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        h.auth.listeners.push(cb);
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  },
}));

vi.mock('./query-client', () => ({ queryClient: h.queryClient }));

/** Re-import with a fresh module registry; `window` makes the module think it's on a device. */
async function loadPersist() {
  vi.resetModules();
  h.auth.listeners.length = 0;
  (globalThis as { window?: unknown }).window = {};
  return import('./query-persist');
}

beforeEach(() => {
  h.store.clear();
  h.auth.userId = null;
  vi.clearAllMocks();
});

describe('queryPersister.restoreClient', () => {
  it('returns the snapshot when it belongs to the signed-in user', async () => {
    h.store.set(OWNER_KEY, 'user-a');
    h.auth.userId = 'user-a';
    const { queryPersister } = await loadPersist();

    await expect(queryPersister.restoreClient()).resolves.toBe(h.snapshot);
    expect(h.inner.removeClient).not.toHaveBeenCalled();
  });

  it('refuses — and drops — a snapshot written by a different account', async () => {
    h.store.set(OWNER_KEY, 'user-a');
    h.auth.userId = 'user-b';
    const { queryPersister } = await loadPersist();

    await expect(queryPersister.restoreClient()).resolves.toBeUndefined();
    expect(h.inner.restoreClient).not.toHaveBeenCalled();
    expect(h.inner.removeClient).toHaveBeenCalled();
    expect(h.store.has(OWNER_KEY)).toBe(false);
  });

  it('restores nothing while signed out', async () => {
    h.store.set(OWNER_KEY, 'user-a');
    h.auth.userId = null;
    const { queryPersister } = await loadPersist();

    await expect(queryPersister.restoreClient()).resolves.toBeUndefined();
    expect(h.inner.restoreClient).not.toHaveBeenCalled();
  });

  it('is a no-op on a first run, with nothing to drop', async () => {
    h.auth.userId = 'user-a';
    const { queryPersister } = await loadPersist();

    await expect(queryPersister.restoreClient()).resolves.toBeUndefined();
    expect(h.inner.removeClient).not.toHaveBeenCalled();
  });
});

describe('auth changes', () => {
  it('drops the snapshot and the in-memory cache on sign-out', async () => {
    h.store.set(OWNER_KEY, 'user-a');
    h.store.set(CACHE_KEY, 'anything');
    await loadPersist();

    await h.auth.listeners[0]?.('SIGNED_OUT', null);

    expect(h.queryClient.clear).toHaveBeenCalled();
    expect(h.inner.removeClient).toHaveBeenCalled();
    expect(h.store.has(OWNER_KEY)).toBe(false);
  });

  it('stamps the owner on sign-in so the next launch may restore', async () => {
    await loadPersist();

    await h.auth.listeners[0]?.('SIGNED_IN', { user: { id: 'user-a' } });

    expect(h.store.get(OWNER_KEY)).toBe('user-a');
  });

  it('leaves a returning user’s cache alone', async () => {
    h.store.set(OWNER_KEY, 'user-a');
    await loadPersist();

    await h.auth.listeners[0]?.('INITIAL_SESSION', { user: { id: 'user-a' } });

    expect(h.queryClient.clear).not.toHaveBeenCalled();
    expect(h.inner.removeClient).not.toHaveBeenCalled();
  });
});

describe('persistOptions', () => {
  it('drops a snapshot older than a day rather than showing it', async () => {
    const { persistOptions, CACHE_MAX_AGE_MS } = await loadPersist();
    expect(CACHE_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    expect(persistOptions.maxAge).toBe(CACHE_MAX_AGE_MS);
  });

  it('persists task lists but not per-keystroke search results', async () => {
    const { persistOptions } = await loadPersist();
    const should = persistOptions.dehydrateOptions.shouldDehydrateQuery;
    const query = (queryKey: readonly unknown[], status: string) =>
      ({ queryKey, state: { status } }) as never;

    expect(should(query(['tasks', 'list', 'today'], 'success'))).toBe(true);
    expect(should(query(['projects', 'withCounts'], 'success'))).toBe(true);
    expect(should(query(['tasks', 'search', 'milk'], 'success'))).toBe(false);
    expect(should(query(['tasks', 'list', 'today'], 'error'))).toBe(false);
  });
});

describe('survivesJsonRoundTrip', () => {
  it('rejects a Map, which JSON.stringify turns into {}', async () => {
    // `useListCounts` caches one. Restored from a snapshot it arrived as a
    // plain object, and the first row of the Lists screen threw calling `.get`
    // on it — taking the whole app to the error boundary on every cold start.
    const { survivesJsonRoundTrip } = await loadPersist();
    expect(survivesJsonRoundTrip(new Map([['a', 1]]))).toBe(false);
  });

  it('rejects a Set for the same reason', async () => {
    const { survivesJsonRoundTrip } = await loadPersist();
    expect(survivesJsonRoundTrip(new Set([1, 2]))).toBe(false);
  });

  it('rejects a Map nested inside the data', async () => {
    const { survivesJsonRoundTrip } = await loadPersist();
    expect(survivesJsonRoundTrip({ counts: new Map() })).toBe(false);
    expect(survivesJsonRoundTrip([{ counts: new Map() }])).toBe(false);
  });

  it('accepts the shapes the app actually caches', async () => {
    const { survivesJsonRoundTrip } = await loadPersist();
    expect(survivesJsonRoundTrip([])).toBe(true);
    expect(
      survivesJsonRoundTrip([{ id: 'a', tags: ['x'], done: false }])
    ).toBe(true);
    expect(survivesJsonRoundTrip({ a: { open: 1, got: 0 } })).toBe(true);
    expect(survivesJsonRoundTrip(null)).toBe(true);
    expect(survivesJsonRoundTrip(undefined)).toBe(true);
  });

  it('keeps a Map-holding query out of the snapshot', async () => {
    const { persistOptions } = await loadPersist();
    const should = persistOptions.dehydrateOptions.shouldDehydrateQuery;
    const query = {
      queryKey: ['lists', 'counts'],
      state: { status: 'success', data: new Map([['id', { open: 1, got: 0 }]]) },
    };
    expect(should(query as never)).toBe(false);
  });

  it('stops walking at the depth cap rather than scanning a whole task list', async () => {
    // Deeper than anything cached here; the cap is a cost guard, and erring
    // toward persisting is the conservative direction.
    const { survivesJsonRoundTrip } = await loadPersist();
    let deep: unknown = new Map();
    for (let i = 0; i < 8; i++) deep = { next: deep };
    expect(survivesJsonRoundTrip(deep)).toBe(true);
  });
});
