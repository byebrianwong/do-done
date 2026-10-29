/**
 * Every query that caches a Map or a Set is kept out of the persisted snapshot
 * by its key.
 *
 * `JSON.stringify` writes a Map as `{}`. A Map-holding query restored from a
 * snapshot comes back as a plain object, and the first `.get` on it takes the
 * whole app to the error boundary on every cold start. That happened with
 * `useListCounts`. The persister decides by key, not by walking the data, so a
 * new Map-holding query without an entry in `UNPERSISTED_KEY_PREFIXES` would
 * reintroduce it. The second test is what notices.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

const queryClient = new QueryClient();
vi.mock('./query-client', () => ({ queryClient }));
vi.mock('./supabase', () => ({
  supabase: { auth: { onAuthStateChange: () => ({}) } },
  getTasksApi: async () => ({}),
  getProjectsApi: async () => ({}),
  getAisleTermsApi: async () => ({}),
  getPantryApi: async () => ({}),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('@tanstack/query-async-storage-persister', () => ({
  createAsyncStoragePersister: () => ({}),
}));
vi.mock('./widgets', () => ({ refreshTaskWidgets: vi.fn() }));
vi.mock('./location-queries', () => ({ scheduleGeofenceSync: vi.fn() }));
vi.mock('./task-reminders', () => ({ scheduleTaskReminderSync: vi.fn() }));
vi.mock('./wear', () => ({ scheduleWatchSync: vi.fn() }));
vi.mock('./list-shortcuts', () => ({ scheduleListShortcutSync: vi.fn() }));

const { isPersistableKey } = await import('./query-persist');
const { listKeys, suggestionKeys, taskKeys } = await import('./task-queries');
const { aisleKeys } = await import('./list-queries');

/**
 * Every `queryKey:` expression of a query whose function returns a Map or a
 * Set, mapped to the key it evaluates to. A new one fails the scan below until
 * it is added here, and the next test then checks it is excluded.
 */
const MAP_HOLDING_KEYS: Record<string, readonly unknown[]> = {
  'listKeys.counts()': listKeys.counts(),
  'aisleKeys.all': aisleKeys.all,
  'suggestionKeys.index()': suggestionKeys.index(),
};

/** What marks a query's data as holding a Map or a Set, by its source. */
const MAP_SHAPED = /\bMap<|\bSet<|new Map\b|new Set\b|AisleMemory|SuggestionIndex|buildSuggestionIndex/;

function useQueryBlocks(source: string): string[] {
  const blocks: string[] = [];
  let at = source.indexOf('useQuery({');
  while (at !== -1) {
    // Up to the call's closing brace, counting braces from its opening one.
    let depth = 0;
    let end = at + 'useQuery('.length;
    for (; end < source.length; end++) {
      if (source[end] === '{') depth++;
      if (source[end] === '}' && --depth === 0) break;
    }
    blocks.push(source.slice(at, end + 1));
    at = source.indexOf('useQuery({', end);
  }
  return blocks;
}

describe('the snapshot key filter', () => {
  it('excludes every known Map-holding query', () => {
    for (const [name, key] of Object.entries(MAP_HOLDING_KEYS)) {
      expect(isPersistableKey(key), name).toBe(false);
    }
  });

  it('knows about every query in lib/ that caches a Map or a Set', () => {
    const dir = __dirname;
    const found: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!/\.tsx?$/.test(file) || file.includes('.test.')) continue;
      const source = readFileSync(join(dir, file), 'utf8');
      for (const block of useQueryBlocks(source)) {
        if (!MAP_SHAPED.test(block)) continue;
        const key = /queryKey:\s*([^,\n]+),/.exec(block)?.[1]?.trim();
        found.push(`${file}: ${key ?? '(no queryKey)'}`);
        expect(
          key && key in MAP_HOLDING_KEYS,
          `${file} caches a Map or a Set under ${key}. Add the key to ` +
            'UNPERSISTED_KEY_PREFIXES in query-persist.ts and to MAP_HOLDING_KEYS here.'
        ).toBe(true);
      }
    }
    // The scan has to be finding something, or it proves nothing.
    expect(found.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps search out and every task list in', () => {
    expect(isPersistableKey(taskKeys.search('milk'))).toBe(false);
    expect(isPersistableKey(taskKeys.today())).toBe(true);
    expect(isPersistableKey(taskKeys.everything())).toBe(true);
    expect(isPersistableKey(listKeys.itemsFor('groceries'))).toBe(true);
    expect(isPersistableKey(listKeys.index())).toBe(true);
  });
});
