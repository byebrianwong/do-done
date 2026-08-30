/**
 * Ticking a shopping-list item moves it; it does not remove it.
 *
 * Every other list in the app drops a completed row, so `toggleComplete`'s
 * optimistic patch is a filter. A shopping list keeps its items — a bought one
 * moves into the "Got it" section, which is what makes a mis-tick while walking
 * one glance from being found. That root therefore has to be patched in place
 * instead, and nothing else in the app has that shape.
 *
 * Without the patch the row's only way to reach the cart was the refetch, which
 * arrives a round trip after the completion animation has finished: the row
 * collapses out of its aisle, nothing takes its place, and the item reappears
 * lower down a second later. The settled state was always right, which is why
 * these assertions are about the frames in between.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { Task } from '@do-done/shared';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity } },
});
vi.mock('./query-client', () => ({ queryClient }));

const complete = vi.fn();
const reopen = vi.fn();
vi.mock('./supabase', () => ({
  getTasksApi: async () => ({ complete, reopen }),
  getProjectsApi: async () => ({}),
}));
vi.mock('./widgets', () => ({ refreshTaskWidgets: vi.fn() }));
vi.mock('./location-queries', () => ({ scheduleGeofenceSync: vi.fn() }));
// Unmocked, this reaches `react-native` at its first line and the suite dies
// parsing Flow — the same reason its three sibling tests mock it.
vi.mock('./task-reminders', () => ({ scheduleTaskReminderSync: vi.fn() }));

const { listKeys, taskKeys, toggleComplete } = await import('./task-queries');

const ITEMS = listKeys.itemsFor('groceries');

function item(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    status: 'not_started',
    sort_order: 1000,
    is_list_item: true,
    completed_at: null,
    tags: [],
    ...over,
  } as unknown as Task;
}

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  complete.mockResolvedValue({ data: null, error: null });
  reopen.mockResolvedValue({ data: null, error: null });
});

describe('ticking a shopping-list item off', () => {
  it('keeps it in the list, marked bought', async () => {
    queryClient.setQueryData(ITEMS, [item('milk'), item('bread')]);

    await toggleComplete('milk', true);

    const list = queryClient.getQueryData<Task[]>(ITEMS);
    // Still two rows: the tick moved one between sections, it did not remove it.
    expect(list).toHaveLength(2);
    expect(list?.find((t) => t.id === 'milk')?.status).toBe('done');
    expect(list?.find((t) => t.id === 'milk')?.completed_at).toBeTruthy();
    expect(list?.find((t) => t.id === 'bread')?.status).toBe('not_started');
  });

  it('still drops it from the ordinary task lists', async () => {
    queryClient.setQueryData(taskKeys.today(), [item('milk')]);
    queryClient.setQueryData(ITEMS, [item('milk')]);

    await toggleComplete('milk', true);

    expect(queryClient.getQueryData<Task[]>(taskKeys.today())).toHaveLength(0);
    expect(queryClient.getQueryData<Task[]>(ITEMS)).toHaveLength(1);
  });

  it('holds the row as to-buy until the animation is spent', async () => {
    queryClient.setQueryData(ITEMS, [item('milk')]);

    const pending = toggleComplete('milk', true, { holdMs: 60 });
    // The write is already out; only the row's move waits. Marking it bought
    // here would collapse the row into the cart mid-animation.
    await Promise.resolve();
    expect(queryClient.getQueryData<Task[]>(ITEMS)?.[0]?.status).toBe(
      'not_started'
    );

    await pending;
    expect(queryClient.getQueryData<Task[]>(ITEMS)?.[0]?.status).toBe('done');
  });

  it('puts it back where it was when the write fails', async () => {
    queryClient.setQueryData(ITEMS, [item('milk')]);
    complete.mockResolvedValue({ data: null, error: new Error('offline') });

    await expect(toggleComplete('milk', true)).rejects.toThrow();

    expect(queryClient.getQueryData<Task[]>(ITEMS)?.[0]?.status).toBe(
      'not_started'
    );
  });
});

describe('putting a bought item back on the list', () => {
  it('returns it to the aisles, un-bought', async () => {
    queryClient.setQueryData(ITEMS, [
      item('milk', { status: 'done', completed_at: '2026-08-29T10:00:00Z' }),
    ]);

    await toggleComplete('milk', false);

    const row = queryClient.getQueryData<Task[]>(ITEMS)?.[0];
    expect(row?.status).toBe('not_started');
    expect(row?.completed_at).toBeNull();
  });

  it('never lands back on "done" when undo hands it that status', async () => {
    // The undo toast passes the status the row held *before* the tap. On a
    // shopping list that row was read out of a cache this patch had already
    // marked bought, so a naive restore would put the item straight back in the
    // cart — and the row would show the Undo doing nothing. `TasksApi.reopen`
    // guards the same case; this is the optimistic half agreeing with it.
    queryClient.setQueryData(ITEMS, [item('milk', { status: 'done' })]);

    await toggleComplete('milk', false, { restoreStatus: 'done' });

    expect(queryClient.getQueryData<Task[]>(ITEMS)?.[0]?.status).toBe(
      'not_started'
    );
  });

  it('restores a real earlier status', async () => {
    queryClient.setQueryData(ITEMS, [item('milk', { status: 'done' })]);

    await toggleComplete('milk', false, { restoreStatus: 'in_progress' });

    expect(queryClient.getQueryData<Task[]>(ITEMS)?.[0]?.status).toBe(
      'in_progress'
    );
  });
});
