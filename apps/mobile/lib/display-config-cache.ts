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
const writtenLocally = new Set<string>();

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
 * Record that the user changed this view's config on this device this launch.
 *
 * After that, the database read a remount makes can only be older than what
 * is showing: the change is written to the database 500ms later, debounced, so
 * a swap away and back inside that window could read the previous config back
 * and undo the change on screen. The write still lands; the read is what is
 * skipped.
 */
export function markDisplayConfigWritten(viewKey: string): void {
  writtenLocally.add(viewKey);
}

/** Whether the database's copy of this view's config should be applied. */
export function shouldApplyRemoteConfig(viewKey: string): boolean {
  return !writtenLocally.has(viewKey);
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

/** Test seam. */
export function resetDisplayConfigCache(): void {
  cache.clear();
  writtenLocally.clear();
}
