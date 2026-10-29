/**
 * A phone with no watch does not build snapshots for one.
 *
 * Every sync reads the task list and builds a snapshot, after every write and
 * on every foreground. The gate is "a watch has ever been seen", stored, rather
 * than the live `hasWatchApp()`, which only sees connected watches: a watch out
 * of range must still be handed fresh snapshots for when it comes back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock('@/lib/runtime', () => ({ IS_EXPO_GO: false }));

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      store.set(k, v);
    },
  },
}));

const syncToWatch = vi.fn(async () => true);
const clearWatch = vi.fn(async () => true);
const hasWatchApp = vi.fn(async () => false);
vi.mock('@/modules/dodone-wear', () => ({ syncToWatch, clearWatch, hasWatchApp }));

const loadWidgetTasks = vi.fn(async () => ({
  signedOut: false,
  tasks: [],
  projects: [],
}));
vi.mock('@/widgets/widget-data', () => ({ loadWidgetTasks }));
const SESSION = { access_token: 'a', expires_at: 1, user: { id: 'u1' } };
let session: typeof SESSION | null = SESSION;
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session } }),
    },
  },
  getTasksApi: async () => ({ complete: vi.fn(async () => ({})) }),
  getProjectsApi: async () => ({ list: async () => ({ data: [], error: null }) }),
}));

async function loadWear() {
  vi.resetModules();
  return import('./wear');
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  hasWatchApp.mockResolvedValue(false);
  session = SESSION;
});

describe('the watch gate', () => {
  it('reads no tasks and sends nothing when no watch has been seen', async () => {
    const { syncWatchNow } = await loadWear();
    await expect(syncWatchNow()).resolves.toBe(false);
    expect(loadWidgetTasks).not.toHaveBeenCalled();
    expect(syncToWatch).not.toHaveBeenCalled();
  });

  it('syncs once a watch is connected, and remembers it', async () => {
    hasWatchApp.mockResolvedValue(true);
    const first = await loadWear();
    await first.syncWatchNow();
    expect(syncToWatch).toHaveBeenCalledTimes(1);

    // Out of range now, and a fresh launch. It is still paired, so the phone
    // keeps putting snapshots for the Data Layer to deliver when it is back.
    hasWatchApp.mockResolvedValue(false);
    const second = await loadWear();
    await second.syncWatchNow();
    expect(syncToWatch).toHaveBeenCalledTimes(2);
  });

  it('a watch asking for a snapshot counts as seen', async () => {
    const { runWearTask, syncWatchNow } = await loadWear();
    await runWearTask({});
    expect(syncToWatch).toHaveBeenCalledTimes(1);
    expect(hasWatchApp).not.toHaveBeenCalled();
    await syncWatchNow();
    expect(syncToWatch).toHaveBeenCalledTimes(2);
  });

  it('still clears the watch on sign-out when no watch has been seen', async () => {
    // A watch synced before the gate shipped, out of range at sign-out: the
    // clear has to go out for the Data Layer to deliver when it reconnects.
    session = null;
    const { syncWatchNow } = await loadWear();
    await syncWatchNow();
    expect(clearWatch).toHaveBeenCalledTimes(1);
    expect(loadWidgetTasks).not.toHaveBeenCalled();
  });
});
