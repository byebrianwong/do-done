import { useQuery } from '@tanstack/react-query';
import type {
  Aisle,
  AisleMemory,
  CreateTaskInput,
  Project,
  Task,
} from '@do-done/shared';
import { splitProjects } from '@do-done/shared';

import { getAisleTermsApi, getProjectsApi, getTasksApi } from './supabase';
import { queryClient } from './query-client';
import { invalidateTasks, listKeys, projectKeys } from './task-queries';

/**
 * Shopping lists, on mobile.
 *
 * `listKeys` is *defined* in `task-queries.ts`, beside `tagKeys`, because the
 * optimistic sweeps there have to reach a list's items and an import back into
 * this module would be a cycle. The reasoning for its shape is written out at
 * the definition; it is re-exported here, where every hook that uses it lives.
 */
export { listKeys };

/** The user's shopping lists — projects with `kind = 'list'`. */
export function useLists() {
  return useQuery({
    queryKey: listKeys.index(),
    queryFn: async (): Promise<Project[]> => {
      const api = await getProjectsApi();
      const { data, error } = await api.list();
      if (error) throw error;
      return splitProjects(data ?? []).lists;
    },
  });
}

/** Open/bought counts per list, for the index rows. */
export function useListCounts() {
  return useQuery({
    queryKey: listKeys.counts(),
    queryFn: async (): Promise<Map<string, { open: number; got: number }>> => {
      const api = await getTasksApi();
      const { data, error } = await api.listCounts();
      if (error) throw error;
      return data;
    },
  });
}

/**
 * One list's items. The only query on mobile that asks for rows every other
 * one filters out.
 */
export function useListItems(listId: string) {
  return useQuery({
    queryKey: listKeys.itemsFor(listId),
    queryFn: async (): Promise<Task[]> => {
      const api = await getTasksApi();
      const { data, error } = await api.listItems(listId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!listId,
  });
}

/** A single list, for the screen's title bar. */
export function useList(listId: string) {
  return useQuery({
    queryKey: [...projectKeys.all, 'detail', listId] as const,
    queryFn: async () => {
      const api = await getProjectsApi();
      const { data, error } = await api.getById(listId);
      if (error) throw error;
      return data;
    },
    enabled: !!listId,
  });
}

// ─── Writes ─────────────────────────────────────────────────

/**
 * Invalidate everything a list write can move.
 *
 * `invalidateTasks()` on top, because the same write feeds the widgets and the
 * geofence sweep — and because a list *item* is still a task row, so the caches
 * that count rows have to hear about it even though no task view will show it.
 */
export function invalidateLists(listId?: string) {
  queryClient.invalidateQueries({ queryKey: listKeys.all });
  if (listId) {
    queryClient.invalidateQueries({ queryKey: listKeys.itemsFor(listId) });
  }
  invalidateTasks();
}

/**
 * Add an item, optimistically.
 *
 * Appends to the cached list before the write so the row is on screen by the
 * time the thumb leaves the return key — this is the one surface where capture
 * is a burst and a round trip per word would be felt.
 */
export async function addListItem(
  listId: string,
  input: Omit<CreateTaskInput, 'project_id'>
): Promise<Task | null> {
  const api = await getTasksApi();
  const { data, error } = await api.create({ ...input, project_id: listId });
  if (error) throw error;
  if (data) {
    queryClient.setQueryData<Task[]>(listKeys.itemsFor(listId), (prev) =>
      // Guarded against a refetch having already landed the row — same race
      // the web composer has, and the same one-line answer.
      !prev || prev.some((t) => t.id === data.id) ? prev ?? [data] : [...prev, data]
    );
  }
  invalidateLists(listId);
  return data;
}

/**
 * Clear the bought items at the end of a shop.
 *
 * Returns the ids it hid, which are the undo token — `TasksApi.restore` takes
 * exactly this and puts the same rows back, so a mis-tick found after clearing
 * is recoverable for the same nine seconds as any other deletion.
 */
export async function clearGotItems(listId: string): Promise<string[]> {
  const api = await getTasksApi();
  const { data, error } = await api.clearGot(listId);
  if (error) throw error;
  invalidateLists(listId);
  return data;
}

/** Put back what `clearGotItems` hid. */
export async function restoreItems(
  listId: string,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  const api = await getTasksApi();
  const { error } = await api.restore(ids);
  if (error) throw error;
  invalidateLists(listId);
}

// ─── Aisle memory ───────────────────────────────────────────
//
// Its own key root beside `listKeys`, and deliberately *not* invalidated by
// `invalidateLists`: this is a slowly-growing map of what the user has taught
// DoDone about their own words, and an ordinary list write cannot change it.
// Only a correction can, and that path invalidates it explicitly.

export const aisleKeys = {
  all: ['aisle-terms'] as const,
};

/**
 * The user's aisle memory. One read, held for the session — the map is small
 * and is consulted while grouping, so a per-lookup query would be the wrong
 * shape entirely.
 *
 * A failure resolves to an empty map rather than throwing: without a memory
 * the lexicon still guesses, which is a good answer, and a list that refuses
 * to render because a preference didn't load would be a much worse one.
 */
export function useAisleMemory() {
  return useQuery({
    queryKey: aisleKeys.all,
    queryFn: async (): Promise<AisleMemory> => {
      const api = await getAisleTermsApi();
      const { data } = await api.load();
      return data;
    },
    // Nothing else in the app writes it, so it need not be re-fetched on every
    // screen focus the way a task list does.
    staleTime: 5 * 60_000,
  });
}

/**
 * Record a correction, or un-teach one.
 *
 * The caller has already written the `aisle:` tag on the row it corrected;
 * this is the half that outlives the item. Best-effort by design — the row is
 * already right, and failing the whole interaction because the lesson didn't
 * save would trade a visible fix for an invisible one.
 */
export async function rememberAisle(
  title: string,
  aisle: Aisle | null
): Promise<void> {
  try {
    const api = await getAisleTermsApi();
    if (aisle) await api.learn(title, aisle);
    else await api.forget(title);
    queryClient.invalidateQueries({ queryKey: aisleKeys.all });
  } catch {
    // Deliberately swallowed — see above.
  }
}
