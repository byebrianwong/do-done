/**
 * When the query cache is written to AsyncStorage.
 *
 * TanStack's own `persistQueryClientSubscribe` calls `persistQueryClientSave`
 * on every cache event, and that runs `dehydrate()` over the whole cache before
 * the persister's throttle is reached. One task write produces dozens of events
 * (each list's fetch starting, each one settling, each optimistic patch), so a
 * single tick dehydrated the cache dozens of times on the JS thread. The
 * persister's `throttleTime` only spaced out the stringify and the write.
 *
 * This waits for the cache to go quiet instead, then saves once. Two limits keep
 * the snapshot from falling behind:
 *
 * - **`PERSIST_MAX_WAIT_MS`** saves anyway when events keep arriving, so a
 *   steady trickle of refetches cannot postpone the write forever.
 * - **Going to the background flushes.** The OS may kill a backgrounded app
 *   without warning, and a save still waiting on its timer would be lost with
 *   it. The flush runs on the `background` and `inactive` transitions, which is
 *   the last moment JS is reliably running.
 *
 * The save dehydrates when it runs, not when it was scheduled, so it always
 * writes the cache as it stands. That is also why a sign-out needs nothing
 * special here: a save that lands after `queryClient.clear()` writes the
 * cleared cache, and `restoreClient` refuses it anyway with no owner stamped.
 *
 * Plain functions with no React Native import, so the node suite covers them.
 */

/** How long the cache must be quiet before it is saved. */
export const PERSIST_IDLE_MS = 1_500;
/** The longest a change waits to be saved while events keep arriving. */
export const PERSIST_MAX_WAIT_MS = 10_000;

export interface SaveScheduler {
  /** Note a change. The save runs once the cache has been quiet for `idleMs`. */
  schedule(): void;
  /** Save now if a change is waiting. A no-op otherwise. */
  flush(): Promise<void>;
  /** Drop a waiting save without running it. */
  cancel(): void;
  /** Whether a change is waiting to be saved. */
  pending(): boolean;
}

export function createSaveScheduler({
  save,
  idleMs = PERSIST_IDLE_MS,
  maxWaitMs = PERSIST_MAX_WAIT_MS,
  now = Date.now,
}: {
  save: () => Promise<void> | void;
  idleMs?: number;
  maxWaitMs?: number;
  now?: () => number;
}): SaveScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** When the oldest unsaved change arrived, or null when nothing is waiting. */
  let firstChangeAt: number | null = null;

  const run = async () => {
    if (timer) clearTimeout(timer);
    timer = null;
    firstChangeAt = null;
    try {
      await save();
    } catch {
      // A failed save costs a cold start that opens on an older snapshot, or
      // on a skeleton. Nothing on screen depends on it.
    }
  };

  return {
    schedule() {
      const t = now();
      if (firstChangeAt === null) firstChangeAt = t;
      if (timer) clearTimeout(timer);
      // Never later than maxWait after the first unsaved change.
      const delay = Math.max(0, Math.min(idleMs, firstChangeAt + maxWaitMs - t));
      timer = setTimeout(() => void run(), delay);
    },
    flush() {
      if (firstChangeAt === null) return Promise.resolve();
      return run();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      firstChangeAt = null;
    },
    pending() {
      return firstChangeAt !== null;
    },
  };
}

/** The cache events that change what a save would write. */
const CACHE_EVENT_TYPES = new Set(['added', 'removed', 'updated']);

/** The parts of a QueryClient this needs. Narrow so a test can hand in a real one. */
interface PersistableClient {
  getQueryCache(): { subscribe(cb: (event: { type: string }) => void): () => void };
  getMutationCache(): {
    subscribe(cb: (event: { type: string }) => void): () => void;
  };
}

/**
 * Save the cache after it goes quiet, and when the app leaves the foreground.
 *
 * The replacement for `persistQueryClientSubscribe`. Same events, same return
 * shape (an unsubscribe), but one save per quiet period rather than one per
 * event. `onBackground` is handed in so this file has no React Native import;
 * the provider wires it to `AppState`.
 *
 * Unsubscribing flushes rather than dropping a waiting save, so a change made
 * just before the provider unmounts is still written.
 */
export function subscribeDebouncedPersist({
  queryClient,
  save,
  onBackground,
  idleMs,
  maxWaitMs,
}: {
  queryClient: PersistableClient;
  save: () => Promise<void> | void;
  onBackground: (flush: () => void) => () => void;
  idleMs?: number;
  maxWaitMs?: number;
}): () => void {
  const scheduler = createSaveScheduler({ save, idleMs, maxWaitMs });
  const onEvent = (event: { type: string }) => {
    if (CACHE_EVENT_TYPES.has(event.type)) scheduler.schedule();
  };
  const offQueries = queryClient.getQueryCache().subscribe(onEvent);
  const offMutations = queryClient.getMutationCache().subscribe(onEvent);
  const offBackground = onBackground(() => void scheduler.flush());
  return () => {
    offQueries();
    offMutations();
    offBackground();
    void scheduler.flush();
  };
}
