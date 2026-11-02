/**
 * A list write fetches the open list's items once.
 *
 * `invalidateLists` used to invalidate `listKeys.all`, then `itemsFor(listId)`,
 * then call `invalidateTasks()`, which invalidates `listKeys.all` again. Each
 * invalidate cancels a fetch in flight and starts another, so every list write
 * sent three item requests and threw two of them away.
 */
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity } },
});
vi.mock('./query-client', () => ({ queryClient }));
vi.mock('./supabase', () => ({
  getTasksApi: async () => ({}),
  getProjectsApi: async () => ({}),
  getAisleTermsApi: async () => ({}),
  getPantryApi: async () => ({}),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('./widgets', () => ({ refreshTaskWidgets: vi.fn() }));
vi.mock('./location-queries', () => ({ scheduleGeofenceSync: vi.fn() }));
vi.mock('./task-reminders', () => ({ scheduleTaskReminderSync: vi.fn() }));
vi.mock('./wear', () => ({ scheduleWatchSync: vi.fn() }));
vi.mock('./list-shortcuts', () => ({ scheduleListShortcutSync: vi.fn() }));

const { invalidateLists, listKeys } = await import('./list-queries');

describe('invalidateLists', () => {
  it('starts one item fetch, not three', async () => {
    const queryFn = vi.fn(async () => []);
    const observer = new QueryObserver(queryClient, {
      queryKey: listKeys.itemsFor('groceries'),
      queryFn,
    });
    const off = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
    queryFn.mockClear();

    invalidateLists('groceries');
    await vi.waitFor(() => expect(observer.getCurrentResult().isFetching).toBe(false));

    expect(queryFn).toHaveBeenCalledTimes(1);
    off();
  });
});
