/**
 * Adding an item to a shopping list puts the row on screen before the server
 * answers.
 *
 * The composer is a burst: Enter clears the field and the next word is typed at
 * once. While the add waited for the insert, the row and the "N added" count
 * arrived a round trip after the word was committed. These assertions are about
 * the frames in between, with the insert held open, because the settled state
 * was always right.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { Task } from '@do-done/shared';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity } },
});
vi.mock('./query-client', () => ({ queryClient }));

const create = vi.fn();
const listItems = vi.fn();
vi.mock('./supabase', () => ({
  getTasksApi: async () => ({ create, listItems }),
  getProjectsApi: async () => ({}),
  getAisleTermsApi: async () => ({}),
  getPantryApi: async () => ({}),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
}));
vi.mock('./list-shortcuts', () => ({ scheduleListShortcutSync: vi.fn() }));
vi.mock('./widgets', () => ({ refreshTaskWidgets: vi.fn() }));
vi.mock('./location-queries', () => ({ scheduleGeofenceSync: vi.fn() }));
vi.mock('./task-reminders', () => ({ scheduleTaskReminderSync: vi.fn() }));
vi.mock('./wear', () => ({ scheduleWatchSync: vi.fn() }));

const { addListItem, fetchListItems, listKeys } = await import(
  './list-queries'
);
const {
  isPendingItem,
  settlePendingItem,
  withPendingItems,
  dropPendingItem,
} = await import('./list-item-add');

const LIST = 'groceries';
const ITEMS = listKeys.itemsFor(LIST);
const ALL = listKeys.itemsFor('shopping');

function item(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    status: 'inbox',
    sort_order: 0,
    is_list_item: true,
    tags: [],
    ...over,
  } as unknown as Task;
}

/** A create that resolves only when the test says so. */
function holdCreate() {
  let resolve!: (v: { data: Task | null; error: Error | null }) => void;
  create.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    })
  );
  return resolve;
}

const ids = (key: readonly unknown[]) =>
  queryClient.getQueryData<Task[]>(key)?.map((t) => t.id);

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe('adding an item', () => {
  it('shows the row before the insert returns', async () => {
    queryClient.setQueryData(ITEMS, [item('milk')]);
    const resolve = holdCreate();

    const pending = addListItem(LIST, { title: 'eggs', tags: ['at:Target'] });
    await Promise.resolve();

    const rows = queryClient.getQueryData<Task[]>(ITEMS) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[1].title).toBe('eggs');
    expect(rows[1].tags).toEqual(['at:Target']);
    expect(isPendingItem(rows[1].id)).toBe(true);

    resolve({ data: item('eggs-id', { title: 'eggs' }), error: null });
    await pending;
    expect(ids(ITEMS)).toEqual(['milk', 'eggs-id']);
  });

  it('appends to All shopping too, and swaps the real row into both', async () => {
    queryClient.setQueryData(ITEMS, []);
    queryClient.setQueryData(ALL, [item('soap')]);
    const resolve = holdCreate();

    const pending = addListItem(LIST, { title: 'eggs' }, { alsoInto: 'shopping' });
    await Promise.resolve();
    expect(queryClient.getQueryData<Task[]>(ALL)).toHaveLength(2);

    resolve({ data: item('eggs-id'), error: null });
    await pending;
    expect(ids(ITEMS)).toEqual(['eggs-id']);
    expect(ids(ALL)).toEqual(['soap', 'eggs-id']);
  });

  it('keeps the row through a refetch that lands mid-add', async () => {
    queryClient.setQueryData(ITEMS, [item('milk')]);
    const resolve = holdCreate();
    const pending = addListItem(LIST, { title: 'eggs' });
    await Promise.resolve();

    // The previous add's invalidate answering now: the server has no eggs yet.
    listItems.mockResolvedValueOnce({ data: [item('milk')], error: null });
    await queryClient.fetchQuery({
      queryKey: ITEMS,
      queryFn: () => fetchListItems(LIST),
    });
    expect(queryClient.getQueryData<Task[]>(ITEMS)).toHaveLength(2);

    resolve({ data: item('eggs-id'), error: null });
    await pending;
    expect(ids(ITEMS)).toEqual(['milk', 'eggs-id']);
  });

  it('takes the row back out when the insert fails', async () => {
    queryClient.setQueryData(ITEMS, [item('milk')]);
    const resolve = holdCreate();
    const pending = addListItem(LIST, { title: 'eggs' });
    await Promise.resolve();
    expect(queryClient.getQueryData<Task[]>(ITEMS)).toHaveLength(2);

    resolve({ data: null, error: new Error('offline') });
    await expect(pending).rejects.toThrow('offline');
    expect(ids(ITEMS)).toEqual(['milk']);
  });

  it('keeps two quick adds in the order they were typed', async () => {
    queryClient.setQueryData(ITEMS, []);
    const first = holdCreate();
    const second = holdCreate();
    const a = addListItem(LIST, { title: 'eggs' });
    const b = addListItem(LIST, { title: 'milk' });
    await Promise.resolve();
    expect(
      queryClient.getQueryData<Task[]>(ITEMS)?.map((t) => t.title)
    ).toEqual(['eggs', 'milk']);

    // The second insert returns first.
    second({ data: item('milk-id', { title: 'milk' }), error: null });
    await b;
    first({ data: item('eggs-id', { title: 'eggs' }), error: null });
    await a;
    expect(ids(ITEMS)).toEqual(['eggs-id', 'milk-id']);
  });
});

describe('settlePendingItem', () => {
  const temp = item('pending:1');
  const real = item('real');

  it('swaps in place', () => {
    expect(
      settlePendingItem([item('a'), temp, item('b')], 'pending:1', real)?.map(
        (t) => t.id
      )
    ).toEqual(['a', 'real', 'b']);
  });

  it('never draws the item twice when a refetch already has it', () => {
    expect(
      settlePendingItem([temp, real], 'pending:1', real)?.map((t) => t.id)
    ).toEqual(['real']);
  });

  it('appends when the stand-in is gone', () => {
    expect(
      settlePendingItem([item('a')], 'pending:1', real)?.map((t) => t.id)
    ).toEqual(['a', 'real']);
  });

  it('leaves an unloaded cache unloaded', () => {
    expect(settlePendingItem(undefined, 'pending:1', real)).toBeUndefined();
    expect(dropPendingItem(undefined, 'pending:1')).toBeUndefined();
  });
});

describe('withPendingItems', () => {
  it('does not add a stand-in the rows already hold', () => {
    const rows = [item('pending:1')];
    expect(withPendingItems(rows, [item('pending:1')])).toBe(rows);
  });
});
