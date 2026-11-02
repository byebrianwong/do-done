/**
 * What the cache holds while a row that is leaving its list plays its exit.
 *
 * A reschedule off Today, a reopen on Completed and a bulk reschedule from the
 * Overdue card all patch the cache, and a patch is what moves the row. Landing
 * it on the tap is what made those rows vanish in one frame. With a hold the
 * write goes out at once and the cache waits, so these tests assert on the
 * cache in between, the same way `task-move.test.ts` does.
 *
 * The second half covers "Show completed": a completion on a list that keeps
 * done rows has to mark the row done in place, not filter it out of every list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { Task } from '@do-done/shared';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity } },
});
vi.mock('./query-client', () => ({ queryClient }));

const update = vi.fn();
const bulkUpdate = vi.fn();
const complete = vi.fn();
const reopen = vi.fn();
vi.mock('./supabase', () => ({
  getTasksApi: async () => ({ update, bulkUpdate, complete, reopen }),
  getProjectsApi: async () => ({}),
}));
// Native seams `invalidateTasks` fans out to; absent in node.
vi.mock('./widgets', () => ({ refreshTaskWidgets: vi.fn() }));
vi.mock('./location-queries', () => ({ scheduleGeofenceSync: vi.fn() }));
vi.mock('./task-reminders', () => ({ scheduleTaskReminderSync: vi.fn() }));
vi.mock('./wear', () => ({ scheduleWatchSync: vi.fn() }));
vi.mock('./auto-sync-notice', () => ({ notifyAutoSync: vi.fn() }));

const {
  taskKeys,
  updateTask,
  bulkRescheduleTasks,
  toggleComplete,
  completionPatch,
} = await import('./task-queries');

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    status: 'not_started',
    sort_order: 1000,
    scheduled_date: '2026-10-29',
    deadline_date: null,
    completed_at: null,
    tags: [],
    ...over,
  } as unknown as Task;
}

const get = (key: readonly unknown[]) =>
  queryClient.getQueryData<Task[]>(key) ?? [];
const find = (key: readonly unknown[], id: string) =>
  get(key).find((t) => t.id === id);

/** Let pending microtasks settle so the write has gone out. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  update.mockResolvedValue({ data: null, error: null });
  bulkUpdate.mockResolvedValue({ failedIds: [] });
  complete.mockResolvedValue({ data: null, error: null });
  reopen.mockResolvedValue({ data: null, error: null });
});

describe('updateTask with a hold', () => {
  it('sends the write at once and leaves the cache alone until the hold ends', async () => {
    queryClient.setQueryData(taskKeys.today(), [task('a')]);

    const pending = updateTask('a', { scheduled_date: '2026-10-30' }, { holdMs: 40 });
    await flush();

    // The write is out, and the row still reads as today's, so it stays in
    // Today's list while it fades.
    expect(update).toHaveBeenCalledWith('a', { scheduled_date: '2026-10-30' });
    expect(find(taskKeys.today(), 'a')?.scheduled_date).toBe('2026-10-29');

    await pending;
    expect(find(taskKeys.today(), 'a')?.scheduled_date).toBe('2026-10-30');
  });

  it('patches on the tap without one, as before', async () => {
    queryClient.setQueryData(taskKeys.today(), [task('a')]);
    let release!: () => void;
    update.mockReturnValue(
      new Promise((r) => {
        release = () => r({ data: null, error: null });
      })
    );

    const pending = updateTask('a', { scheduled_date: '2026-10-30' });
    await flush();
    expect(find(taskKeys.today(), 'a')?.scheduled_date).toBe('2026-10-30');

    release();
    await pending;
  });

  it('never moves the row when the write fails', async () => {
    queryClient.setQueryData(taskKeys.today(), [task('a')]);
    update.mockResolvedValue({ data: null, error: new Error('offline') });

    await expect(
      updateTask('a', { scheduled_date: '2026-10-30' }, { holdMs: 40 })
    ).rejects.toThrow('offline');

    expect(find(taskKeys.today(), 'a')?.scheduled_date).toBe('2026-10-29');
  });
});

describe('bulkRescheduleTasks with a hold', () => {
  it('leaves every row in place until the hold ends, then moves the ones that landed', async () => {
    queryClient.setQueryData(taskKeys.today(), [
      task('a', { scheduled_date: '2026-10-20' }),
      task('b', { scheduled_date: '2026-10-21' }),
    ]);
    bulkUpdate.mockResolvedValue({ failedIds: ['b'] });

    const pending = bulkRescheduleTasks(['a', 'b'], '2026-10-30', { holdMs: 40 });
    await flush();
    expect(bulkUpdate).toHaveBeenCalled();
    // The Overdue card is still fading: nothing has moved yet.
    expect(find(taskKeys.today(), 'a')?.scheduled_date).toBe('2026-10-20');
    expect(find(taskKeys.today(), 'b')?.scheduled_date).toBe('2026-10-21');

    expect(await pending).toEqual({ updated: 1, failed: 1 });
    expect(find(taskKeys.today(), 'a')?.scheduled_date).toBe('2026-10-30');
    expect(find(taskKeys.today(), 'b')?.scheduled_date).toBe('2026-10-21');
  });
});

describe('completing on a list that keeps done tasks', () => {
  it('marks the row done in place in the lists that hold done rows', async () => {
    queryClient.setQueryData(taskKeys.everything(), [task('a'), task('b')]);
    queryClient.setQueryData(taskKeys.project('p'), [task('a')]);

    await toggleComplete('a', true, { keepInLists: true });

    expect(get(taskKeys.everything())).toHaveLength(2);
    expect(find(taskKeys.everything(), 'a')?.status).toBe('done');
    expect(find(taskKeys.everything(), 'a')?.completed_at).toBeTruthy();
    expect(find(taskKeys.project('p'), 'a')?.status).toBe('done');
  });

  it('still drops it from the inbox, whose query cannot return a done task', async () => {
    queryClient.setQueryData(taskKeys.inbox(), [task('a', { status: 'inbox' })]);

    await toggleComplete('a', true, { keepInLists: true });

    expect(get(taskKeys.inbox())).toHaveLength(0);
  });

  it('shows the check in place before the row moves to Done', async () => {
    queryClient.setQueryData(taskKeys.everything(), [task('a')]);

    const pending = toggleComplete('a', true, { holdMs: 40, keepInLists: true });
    await flush();
    expect(complete).toHaveBeenCalledWith('a');
    expect(find(taskKeys.everything(), 'a')?.status).toBe('not_started');

    await pending;
    expect(find(taskKeys.everything(), 'a')?.status).toBe('done');
  });

  it('filters the row out everywhere without the flag, as before', async () => {
    queryClient.setQueryData(taskKeys.everything(), [task('a')]);

    await toggleComplete('a', true);

    expect(get(taskKeys.everything())).toHaveLength(0);
  });

  it('marks tag and search results done in place either way', async () => {
    queryClient.setQueryData(taskKeys.tagged('home'), [task('a')]);
    queryClient.setQueryData(taskKeys.search('a'), [task('a')]);

    await toggleComplete('a', true);

    expect(find(taskKeys.tagged('home'), 'a')?.status).toBe('done');
    expect(find(taskKeys.search('a'), 'a')?.status).toBe('done');
  });
});

describe('reopening', () => {
  it('holds the row on Completed until its exit has played', async () => {
    queryClient.setQueryData(taskKeys.completed(), [
      task('a', { status: 'done', completed_at: '2026-10-29T08:00:00Z' }),
    ]);

    const pending = toggleComplete('a', false, { holdMs: 40 });
    await flush();
    expect(reopen).toHaveBeenCalled();
    expect(get(taskKeys.completed())).toHaveLength(1);

    await pending;
    expect(get(taskKeys.completed())).toHaveLength(0);
  });

  it('turns a done row open again in place in the active lists', async () => {
    queryClient.setQueryData(taskKeys.everything(), [
      task('a', { status: 'done', completed_at: '2026-10-29T08:00:00Z' }),
    ]);

    await toggleComplete('a', false, { restoreStatus: 'in_progress' });

    const row = find(taskKeys.everything(), 'a');
    expect(row?.status).toBe('in_progress');
    expect(row?.completed_at).toBeNull();
  });
});

describe('completionPatch', () => {
  it('never reopens to done', () => {
    expect(completionPatch(false, 'done').status).toBe('not_started');
    expect(completionPatch(false).status).toBe('not_started');
    expect(completionPatch(false, 'next').status).toBe('next');
  });

  it('stamps completed_at only when completing', () => {
    const now = new Date('2026-10-29T10:00:00Z');
    expect(completionPatch(true, undefined, now)).toEqual({
      status: 'done',
      completed_at: '2026-10-29T10:00:00.000Z',
    });
    expect(completionPatch(false, undefined, now).completed_at).toBeNull();
  });
});
