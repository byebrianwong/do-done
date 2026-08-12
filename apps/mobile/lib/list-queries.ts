import { useQuery } from '@tanstack/react-query';
import type { CreateTaskInput, Project, Task } from '@do-done/shared';
import { splitProjects } from '@do-done/shared';

import { getProjectsApi, getTasksApi } from './supabase';
import { queryClient } from './query-client';
import { invalidateTasks, projectKeys } from './task-queries';

/**
 * Shopping lists, on mobile.
 *
 * Its own query root, deliberately outside `taskKeys`. The optimistic
 * `setQueriesData<Task[]>` sweeps in `task-queries.ts` rewrite everything under
 * `taskKeys.all`, and a list's cached value is either a `Project[]` or a
 * `Map` of counts — the same argument that keeps `tagKeys` and
 * `suggestionKeys` out of there.
 *
 * Unlike `suggestionKeys` and like `tagKeys`, this *is* invalidated on every
 * task write: a count that is wrong is a number on screen disagreeing with the
 * list it opens, which is the one thing an index of counts must never do.
 */
export const listKeys = {
  all: ['lists'] as const,
  index: () => [...listKeys.all, 'index'] as const,
  counts: () => [...listKeys.all, 'counts'] as const,
  items: (listId: string) => [...listKeys.all, 'items', listId] as const,
};

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
    queryKey: listKeys.items(listId),
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
    queryClient.invalidateQueries({ queryKey: listKeys.items(listId) });
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
    queryClient.setQueryData<Task[]>(listKeys.items(listId), (prev) =>
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
