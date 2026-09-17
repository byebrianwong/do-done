import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, Task } from '@do-done/shared';

/**
 * The phone half of the watch bridge, at the level this suite can reach: the
 * order things happen in, and what ends up in the payload.
 *
 * Nothing here renders and nothing here talks to a watch. What it covers is the
 * sequencing — which is the half that fails silently on a device, because a
 * dropped sync and a sync that landed look identical from the wrist a minute
 * later.
 */

// The native seams, each stood in for explicitly — the convention this suite
// follows everywhere else.
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock('@/lib/runtime', () => ({ IS_EXPO_GO: false }));

const syncToWatch = vi.fn(async () => true);
const clearWatch = vi.fn(async () => true);
vi.mock('@/modules/dodone-wear', () => ({ syncToWatch, clearWatch }));

const complete = vi.fn(async () => ({ data: null, error: null }));
const update = vi.fn(async () => ({ data: null, error: null }));
const create = vi.fn(async () => ({ data: null, error: null }));
const listProjects = vi.fn(async () => ({ data: [] as Project[], error: null }));
let session: Record<string, unknown> | null = null;

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session } }) } },
  getTasksApi: async () => ({ complete, update, create }),
  getProjectsApi: async () => ({ list: listProjects }),
}));

let widgetTasks: { signedOut: boolean; tasks: Task[]; projects: Project[] } = {
  signedOut: false,
  tasks: [],
  projects: [],
};
vi.mock('@/widgets/widget-data', () => ({
  loadWidgetTasks: async () => widgetTasks,
}));

// A dynamic import, like `task-queries.test.ts`: a static one hoists above the
// `vi.fn()` declarations above and the mock factories then close over
// uninitialised bindings.
const { runWearTask, syncWatchNow } = await import('./wear');

const SESSION = {
  access_token: 'access-abc',
  refresh_token: 'refresh-xyz',
  expires_at: 1_800_000_000,
  user: { id: 'u1' },
};

beforeEach(() => {
  vi.clearAllMocks();
  syncToWatch.mockImplementation(async () => true);
  session = { ...SESSION };
  widgetTasks = { signedOut: false, tasks: [], projects: [] };
});

function lastSessionPayload() {
  const call = syncToWatch.mock.calls.at(-1) as unknown as [string, string];
  return JSON.parse(call[1]) as Record<string, unknown>;
}

describe('the session handed to the watch', () => {
  it('carries the access token and never the refresh token', async () => {
    await syncWatchNow();
    const payload = lastSessionPayload();
    expect(payload.accessToken).toBe('access-abc');
    // Supabase rotates a refresh token when it is spent, so a watch holding one
    // would sign the phone out an hour after pairing. This assertion is what
    // keeps that from being reintroduced by someone widening the payload.
    expect(JSON.stringify(payload)).not.toContain('refresh-xyz');
    expect(payload).not.toHaveProperty('refreshToken');
  });

  it('converts the expiry to epoch milliseconds', async () => {
    await syncWatchNow();
    // Supabase reports seconds; everything on the watch is ms, and the
    // conversion happens once, here.
    expect(lastSessionPayload().expiresAt).toBe(SESSION.expires_at * 1000);
  });
});

describe('signed out', () => {
  it('takes back what the watch is holding rather than leaving it', async () => {
    session = null;
    await syncWatchNow();
    expect(clearWatch).toHaveBeenCalled();
    expect(syncToWatch).not.toHaveBeenCalled();
  });

  it('clears when the task read reports no session too', async () => {
    widgetTasks = { signedOut: true, tasks: [], projects: [] };
    await syncWatchNow();
    expect(clearWatch).toHaveBeenCalled();
    expect(syncToWatch).not.toHaveBeenCalled();
  });
});

describe('a write relayed from the watch', () => {
  it('is applied before the snapshot goes back', async () => {
    const order: string[] = [];
    complete.mockImplementationOnce(async () => {
      order.push('write');
      return { data: null, error: null };
    });
    syncToWatch.mockImplementationOnce(async () => {
      order.push('sync');
      return true;
    });

    await runWearTask({ write: '{"op":"complete","taskId":"t1","value":""}' });

    expect(complete).toHaveBeenCalledWith('t1');
    expect(order).toEqual(['write', 'sync']);
  });

  it('goes through TasksApi, which is what feeds the pet and stamps the row', async () => {
    await runWearTask({ write: '{"op":"reschedule","taskId":"t1","value":"2026-09-09"}' });
    expect(update).toHaveBeenCalledWith('t1', { scheduled_date: '2026-09-09' });
  });

  it('parses a dictated create on this side', async () => {
    await runWearTask({ write: '{"op":"create","taskId":"","value":"call the bank p1"}' });
    expect(create).toHaveBeenCalledTimes(1);
    const input = (create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(input.title).toBe('call the bank');
    expect(input.priority).toBe('p1');
  });

  // The snapshot is the only thing that can put a row back on the watch, so it
  // must go out even when the write it was carrying did not land.
  it('still sends a snapshot when the write throws', async () => {
    complete.mockRejectedValueOnce(new Error('offline'));
    await runWearTask({ write: '{"op":"complete","taskId":"t1","value":""}' });
    expect(syncToWatch).toHaveBeenCalledTimes(1);
  });

  it('still sends a snapshot when there is no write at all', async () => {
    await runWearTask({});
    expect(complete).not.toHaveBeenCalled();
    expect(syncToWatch).toHaveBeenCalledTimes(1);
  });

  it('ignores a write it does not recognise rather than failing the task', async () => {
    await runWearTask({ write: '{"op":"launch_rocket"}' });
    expect(complete).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(syncToWatch).toHaveBeenCalledTimes(1);
  });
});

describe('two syncs at once', () => {
  it('runs them one at a time', async () => {
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    syncToWatch
      .mockImplementationOnce(async () => {
        order.push('a:start');
        await held;
        order.push('a:end');
        return true;
      })
      .mockImplementationOnce(async () => {
        order.push('b');
        return true;
      });

    const a = syncWatchNow();
    const b = syncWatchNow();
    // Wait for the first run to actually reach the put rather than guessing how
    // many microtasks the lazy imports take.
    await vi.waitFor(() => expect(order).toContain('a:start'));
    // If the two overlapped, the second put would already have happened.
    expect(order).not.toContain('b');
    release();
    await Promise.all([a, b]);

    expect(order).toEqual(['a:start', 'a:end', 'b']);
  });

  it('gives the second caller a promise for its own run, not the first one', async () => {
    // The headless task's JS context is torn down when its promise resolves, so
    // a caller handed the in-flight promise would take its own sync down with it.
    let resolved = 0;
    syncToWatch.mockImplementation(async () => {
      resolved++;
      return true;
    });
    const a = syncWatchNow();
    const b = syncWatchNow();
    await a;
    await b;
    expect(resolved).toBe(2);
  });

  it('does not let a failed run stop the next one', async () => {
    syncToWatch.mockRejectedValueOnce(new Error('data layer down'));
    await expect(syncWatchNow()).resolves.toBe(false);
    await expect(syncWatchNow()).resolves.toBe(true);
  });
});
