/**
 * The last display config each view used this launch, kept in module state.
 *
 * `useDisplayConfig` reads its config from AsyncStorage and then the database,
 * both asynchronously. Before this cache it started every mount on the
 * defaults, so a customised list drew itself once in the default grouping and
 * then regrouped a moment later — on every swap between Today and Upcoming or
 * All and Inbox, since a swap remounts the view. Now a remount starts from what
 * the view last showed, and the async reads only change something when they
 * disagree with it.
 *
 * Module state rather than the query cache: `invalidateTasks()` sweeps the
 * query cache, and this is a preference, not data. Plain module state with no
 * React or native imports, so the node suite covers it.
 */
import type { DisplayConfig } from '@do-done/shared';

const cache = new Map<string, DisplayConfig>();
const unsyncedWrites = new Map<string, number>();

/** What a view should draw with before anything async has answered. */
export function initialDisplayConfig(
  viewKey: string,
  fallback: DisplayConfig
): DisplayConfig {
  return cache.get(viewKey) ?? fallback;
}

export function hasDisplayConfig(viewKey: string): boolean {
  return cache.has(viewKey);
}

export function rememberDisplayConfig(
  viewKey: string,
  config: DisplayConfig
): void {
  cache.set(viewKey, config);
}

/**
 * Record that the user changed this view's config and the database write has
 * not landed yet.
 *
 * The write is debounced 500ms. Inside that window the database still holds
 * the previous config, so a swap away and back could read it back and undo the
 * change on screen. While a write is outstanding the database copy is skipped;
 * `markDisplayConfigSynced` lifts that once the write has gone out.
 */
export function markDisplayConfigWritten(viewKey: string): void {
  unsyncedWrites.set(viewKey, (unsyncedWrites.get(viewKey) ?? 0) + 1);
}

/** The debounced write for one change has gone out (or failed for good). */
export function markDisplayConfigSynced(viewKey: string, changes: number): void {
  const left = (unsyncedWrites.get(viewKey) ?? 0) - changes;
  if (left > 0) unsyncedWrites.set(viewKey, left);
  else unsyncedWrites.delete(viewKey);
}

/** How many local changes to this view have not reached the database yet. */
export function unsyncedDisplayChanges(viewKey: string): number {
  return unsyncedWrites.get(viewKey) ?? 0;
}

/** Whether the database's copy of this view's config should be applied. */
export function shouldApplyRemoteConfig(viewKey: string): boolean {
  return !unsyncedWrites.has(viewKey);
}

/**
 * Whether two configs would draw the same list. A read that returns what is
 * already showing must not set state: a new object with the same values still
 * re-renders the whole list and re-runs its grouping.
 */
export function sameDisplayConfig(a: DisplayConfig, b: DisplayConfig): boolean {
  return a === b || stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0
        )
      );
    }
    return v;
  });
}

/**
 * Forget everything. Called on sign-out, so the next account does not start
 * from the previous one's configs. Also the test seam.
 */
export function resetDisplayConfigCache(): void {
  cache.clear();
  unsyncedWrites.clear();
}
