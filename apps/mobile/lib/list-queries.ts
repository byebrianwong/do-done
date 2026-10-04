import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  Aisle,
  AisleMemory,
  CreateTaskInput,
  PantryEntry,
  Project,
  Task,
} from '@do-done/shared';
import {
  ALL_SHOPPING_ID,
  learnableTerm,
  shoppingLists,
  splitProjects,
} from '@do-done/shared';

import {
  getAisleTermsApi,
  getPantryApi,
  getProjectsApi,
  getTasksApi,
} from './supabase';
import { queryClient } from './query-client';
import { scheduleListShortcutSync } from './list-shortcuts';
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
 *
 * `ALL_SHOPPING_ID` asks for the items of every shopping list instead: "All
 * shopping". Same hook and the same key shape (`itemsFor('shopping')`), so the
 * cache holds a `Task[]` under `listKeys.items()` like every other list. That
 * is what lets the optimistic sweeps in `task-queries.ts` tick a row off here
 * without knowing this view exists.
 */
export function useListItems(listId: string) {
  return useQuery({
    queryKey: listKeys.itemsFor(listId),
    queryFn: async (): Promise<Task[]> => {
      const api = await getTasksApi();
      if (listId === ALL_SHOPPING_ID) {
        // Which lists count is decided from the project rows, so the read is
        // two round trips. The project read is the same one `useLists` makes;
        // a failure in it fails this query, rather than reading as a view with
        // nothing on it.
        const projects = await getProjectsApi();
        const lists = await projects.list();
        if (lists.error) throw lists.error;
        const ids = shoppingLists(lists.data ?? []).map((l) => l.id);
        const { data, error } = await api.listItemsIn(ids);
        if (error) throw error;
        return data ?? [];
      }
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
  // A list created, renamed or deleted has to reach the launcher: its quick
  // action is labelled with the list's name, and a pinned icon outlives the
  // list unless something disables it. Debounced and fire-and-forget, the same
  // shape as the widget refresh `invalidateTasks` drives. Android-only.
  scheduleListShortcutSync();
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
  input: Omit<CreateTaskInput, 'project_id'>,
  options: {
    /**
     * Another cached view to append the row to: "All shopping", which shows
     * this list's items without being this list. Only the screen adding the
     * item knows it is in that view.
     */
    alsoInto?: string;
  } = {}
): Promise<Task | null> {
  const api = await getTasksApi();
  const { data, error } = await api.create({ ...input, project_id: listId });
  if (error) throw error;
  if (data) {
    for (const key of [listId, ...(options.alsoInto ? [options.alsoInto] : [])]) {
      queryClient.setQueryData<Task[]>(listKeys.itemsFor(key), (prev) =>
        // Guarded against a refetch having already landed the row — same race
        // the web composer has, and the same one-line answer.
        !prev || prev.some((t) => t.id === data.id) ? prev ?? [data] : [...prev, data]
      );
    }
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

/**
 * `clearGotItems` across several lists: "Put away" on "All shopping", whose
 * cart holds items from every shopping list. One sweep, one undo token.
 */
export async function clearGotItemsIn(listIds: string[]): Promise<string[]> {
  const api = await getTasksApi();
  const { data, error } = await api.clearGotIn(listIds);
  if (error) throw error;
  invalidateLists();
  return data;
}

// ─── All shopping: which list a new item goes to ────────────

/**
 * The list last added to from "All shopping". Per device, in AsyncStorage,
 * the same as the Lists tab's resume memory: it is a habit of this phone's
 * user, not a setting worth syncing. Resolved against the current shopping
 * lists by `defaultAllShoppingTarget`, so a stale id falls back on its own.
 */
const ALL_SHOPPING_TARGET_KEY = 'lists:all-shopping:target';

export async function loadAllShoppingTarget(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(ALL_SHOPPING_TARGET_KEY);
  } catch {
    return null;
  }
}

export async function saveAllShoppingTarget(listId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(ALL_SHOPPING_TARGET_KEY, listId);
  } catch {
    // A default that did not save costs one chip tap next time.
  }
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
 * Put a correction into the cached memory now, before anything is written.
 *
 * For a drag. The drop clears or replaces the row's `aisle:` tag in the cache
 * at once, and a row with no tag falls back to the memory. Until the lesson
 * write lands, that memory still holds the old lesson, so an item dragged into
 * Other would stop in the aisle the old lesson names and only reach Other a
 * round trip later. A setter rather than part of `rememberAisle`, because the
 * lesson itself is written only after the row's own write succeeds. A caller
 * whose write fails invalidates `aisleKeys.all` to take this back.
 */
export function previewAisleLesson(title: string, aisle: Aisle | null): void {
  const term = learnableTerm(title);
  if (!term) return;
  queryClient.setQueryData<AisleMemory>(aisleKeys.all, (prev) => {
    if (!prev) return prev;
    const next = new Map(prev);
    if (aisle) next.set(term, aisle);
    else next.delete(term);
    return next;
  });
}

/** Read the memory again, dropping anything `previewAisleLesson` put there. */
export function invalidateAisleMemory(): void {
  queryClient.invalidateQueries({ queryKey: aisleKeys.all });
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
  } catch {
    // Deliberately swallowed — see above.
  } finally {
    // Either way, so a lesson `previewAisleLesson` put in the cache is
    // replaced by what the server actually holds.
    queryClient.invalidateQueries({ queryKey: aisleKeys.all });
  }
}

// ─── The pantry ─────────────────────────────────────────────
//
// Its own key root beside `aisleKeys`, and deliberately not under `taskKeys`.
// The optimistic sweeps in `task-queries.ts` rewrite everything they match, and
// this cache holds `PantryEntry[]` rather than `Task[]`. Same reasoning as
// `tagKeys`, and the same trap `patchTaskLists` guards against.

export const pantryKeys = {
  all: ['pantry'] as const,
  forList: (listId: string) => ['pantry', listId] as const,
};

/**
 * Loads what has been bought on this list before.
 *
 * A failure resolves to an empty array rather than throwing. Without a pantry
 * the screen is a plain shopping list, which is what it was before this existed
 * and is still useful. Failing to render because a drawer did not load would be
 * much worse with the phone in your hand in a shop.
 */
export function usePantry(listId: string) {
  return useQuery({
    queryKey: pantryKeys.forList(listId),
    queryFn: async (): Promise<PantryEntry[]> => {
      const api = await getPantryApi();
      const { data } = await api.load(listId);
      return data;
    },
    enabled: !!listId,
    // Only a tick moves it, and that path invalidates explicitly.
    staleTime: 60_000,
  });
}

export function invalidatePantry(listId: string) {
  queryClient.invalidateQueries({ queryKey: pantryKeys.forList(listId) });
}

/**
 * Deletes a pantry entry. The only destructive operation on the pantry.
 *
 * Putting a list away is safe now, so it stays one tap. The friction sits here
 * instead, on the action that cannot be undone.
 */
export async function forgetPantryEntry(
  listId: string,
  term: string
): Promise<void> {
  queryClient.setQueryData<PantryEntry[]>(pantryKeys.forList(listId), (prev) =>
    (prev ?? []).filter((e) => e.term !== term)
  );
  const api = await getPantryApi();
  const { error } = await api.forget(listId, term);
  if (error) {
    // Refetch rather than leaving the row gone from the screen but present in
    // the database, which would make it reappear later with no explanation.
    invalidatePantry(listId);
    throw error;
  }
}
