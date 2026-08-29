/**
 * An optimistic write has to cancel, patch and roll back over the *same* set of
 * caches.
 *
 * `patchTaskLists` grew a second root when shopping lists arrived — a list's
 * items are ordinary task rows kept under `listKeys.items()` — while the cancel
 * and the rollback either side of it still named `taskKeys.all` alone. Both
 * gaps show up as the same thing on screen, which is the row not moving:
 *
 * - **Cancel.** `invalidateTasks()` refetches `listKeys.all` after every write,
 *   so on a list there is very often a fetch in the air. It was sent before this
 *   write existed, so its answer is the state the user is trying to change —
 *   and landing on top of the patch puts the row back for a whole round trip.
 * - **Rollback.** A failed write put the task lists back and left the item
 *   showing a change that never landed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { Task } from '@do-done/shared';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity } },
});
vi.mock('./query-client', () => ({ queryClient }));

const update = vi.fn();
vi.mock('./supabase', () => ({
  getTasksApi: async () => ({ update }),
  getProjectsApi: async () => ({}),
}));
vi.mock('./widgets', () => ({ refreshTaskWidgets: vi.fn() }));
vi.mock('./location-queries', () => ({ scheduleGeofenceSync: vi.fn() }));
// Unmocked, this reaches `react-native` at its first line and the suite dies
// parsing Flow. Its three sibling tests around `task-queries` all mock it.
vi.mock('./task-reminders', () => ({ scheduleTaskReminderSync: vi.fn() }));

const { listKeys, updateTask } = await import('./task-queries');

const ITEMS = listKeys.itemsFor('groceries');

function item(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    status: 'not_started',
    sort_order: 1000,
    scheduled_date: '2026-08-20',
    is_list_item: true,
    tags: [],
    ...over,
  } as unknown as Task;
}

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  update.mockResolvedValue({ data: null, error: null });
});

describe('an optimistic reschedule of a shopping-list item', () => {
  it('is not undone by a fetch that was already in the air', async () => {
    queryClient.setQueryData(ITEMS, [item('milk')]);

    // A refetch sent before the tap — it can only answer with the state the tap
    // is about to change.
    let answerStale: (() => void) | undefined;
    const stalePending = queryClient.prefetchQuery({
      queryKey: ITEMS,
      queryFn: () =>
        new Promise<Task[]>((resolve) => {
          answerStale = () => resolve([item('milk')]);
        }),
    });

    await updateTask('milk', { scheduled_date: '2026-08-17' });

    // …and it answers only now, after the write has landed.
    answerStale?.();
    await stalePending;

    const list = queryClient.getQueryData<Task[]>(ITEMS);
    expect(list?.[0]?.scheduled_date).toBe('2026-08-17');
  });

  it('is rolled back when the write fails', async () => {
    queryClient.setQueryData(ITEMS, [item('milk')]);
    update.mockResolvedValue({ data: null, error: new Error('offline') });

    await expect(
      updateTask('milk', { scheduled_date: '2026-08-17' })
    ).rejects.toThrow();

    const list = queryClient.getQueryData<Task[]>(ITEMS);
    expect(list?.[0]?.scheduled_date).toBe('2026-08-20');
  });
});
