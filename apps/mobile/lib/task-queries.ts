/**
 * TanStack Query layer for tasks + projects (Phase 0.3 of the mobile roadmap).
 *
 * One shared, normalized cache replaces the old per-screen `useState` +
 * fetch-on-focus pattern, so tabs share data, refetches dedupe, and mutations
 * patch the cache optimistically instead of every screen reloading its full
 * list. Optimistic patches are best-effort; the `onSettled` invalidate is the
 * safety net that reconciles against server truth.
 *
 * NOTE: only call these hooks inside the QueryClientProvider (the in-app tree
 * under app/_layout.tsx). The home-screen widget activity (quick-add-root.tsx)
 * is a separate React root with no provider — it must keep using getTasksApi()
 * directly.
 */

import { useQuery } from '@tanstack/react-query';
import type {
  CreateProjectInput,
  Project,
  Task,
  TaskFilterInput,
  UpdateTaskInput,
} from '@do-done/shared';
import { getProjectsApi, getTasksApi } from './supabase';
import { queryClient } from './query-client';
import { scheduleGeofenceSync } from './location-queries';

type ProjectWithCounts = Project & { task_count: number; open_count: number };

// ─── Query keys ─────────────────────────────────────────────
// Active task lists live under ['tasks','list',…]; completed is kept separate
// so a completion optimistically drops the row from active lists without
// touching the completed cache (the invalidate refills it).
export const taskKeys = {
  all: ['tasks'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  today: () => [...taskKeys.lists(), 'today'] as const,
  inbox: () => [...taskKeys.lists(), 'inbox'] as const,
  project: (id: string) => [...taskKeys.lists(), 'project', id] as const,
  // "Everything" lives under lists() so a completion optimistically drops the
  // row from it too (same as today/inbox/project).
  everything: () => [...taskKeys.lists(), 'all'] as const,
  completed: () => [...taskKeys.all, 'completed'] as const,
  search: (q: string) => [...taskKeys.all, 'search', q] as const,
};

export const projectKeys = {
  all: ['projects'] as const,
  list: () => [...projectKeys.all, 'list'] as const,
  withCounts: () => [...projectKeys.all, 'withCounts'] as const,
};

async function fetchTasks(filters?: TaskFilterInput): Promise<Task[]> {
  const api = await getTasksApi();
  const { data, error } = await api.list(filters);
  if (error) throw error;
  return data ?? [];
}

// ─── Queries ────────────────────────────────────────────────

export function useTodayTasks() {
  return useQuery({
    queryKey: taskKeys.today(),
    queryFn: () => fetchTasks({ limit: 100, offset: 0 }),
  });
}

export function useInboxTasks() {
  return useQuery({
    queryKey: taskKeys.inbox(),
    queryFn: () => fetchTasks({ status: 'inbox', limit: 50, offset: 0 }),
  });
}

export function useProjectTasks(projectId: string) {
  return useQuery({
    queryKey: taskKeys.project(projectId),
    queryFn: () => fetchTasks({ project_id: projectId, limit: 200, offset: 0 }),
  });
}

/** Every task (active + done) — the "All" browse view groups these by status. */
export function useAllTasks() {
  return useQuery({
    queryKey: taskKeys.everything(),
    queryFn: () => fetchTasks({ limit: 500, offset: 0 }),
  });
}

/** Full-text task search; disabled until the query is non-empty. */
export function useSearchTasks(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: taskKeys.search(q),
    enabled: q.length > 0,
    queryFn: async () => {
      const api = await getTasksApi();
      const { data, error } = await api.search(q);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCompletedTasks() {
  return useQuery({
    queryKey: taskKeys.completed(),
    queryFn: async () => {
      const api = await getTasksApi();
      const { data, error } = await api.listCompleted({ limit: 200 });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: [...projectKeys.all, 'detail', projectId] as const,
    queryFn: async () => {
      const api = await getProjectsApi();
      const { data, error } = await api.getById(projectId);
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Resolve a parent task (title, mainly) for a subtask row's "↳ parent"
 * reference. Deduped by parent id, so all subtasks of one parent share a single
 * lookup. Tries the already-cached task lists first — the parent is usually
 * loaded — and only falls back to a fetch when it isn't. Disabled (no query)
 * when the row isn't a subtask.
 */
export function useParentTask(parentId: string | null) {
  return useQuery({
    queryKey: [...taskKeys.all, 'detail', parentId ?? 'none'] as const,
    enabled: !!parentId,
    queryFn: async () => {
      const cached = queryClient
        .getQueriesData<Task[]>({ queryKey: taskKeys.all })
        .flatMap(([, list]) => list ?? [])
        .find((t) => t.id === parentId);
      if (cached) return cached;
      const api = await getTasksApi();
      const { data, error } = await api.getById(parentId as string);
      if (error) throw error;
      return data;
    },
  });
}

/** Plain project list (no counts) — powers the project picker on rows/modal. */
export function useProjects() {
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: async () => {
      const api = await getProjectsApi();
      const { data, error } = await api.list();
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useProjectsWithCounts() {
  return useQuery({
    queryKey: projectKeys.withCounts(),
    queryFn: async () => {
      const api = await getProjectsApi();
      const { data, error } = await api.listWithCounts();
      if (error) throw error;
      return (data ?? []) as ProjectWithCounts[];
    },
  });
}

// ─── Mutations (plain functions, not hooks) ─────────────────
//
// These run through the singleton queryClient rather than a component-scoped
// useMutation observer. A task row is removed from its list by its own
// optimistic update, which unmounts it mid-flight — a component-scoped
// observer would then skip onError/onSettled (no rollback, no reconcile).
// Module-level functions outlive the row, so rollback and the reconciling
// invalidate always run.

type TaskListSnapshot = ReturnType<
  typeof queryClient.getQueriesData<Task[]>
>;

function snapshotTaskLists(): TaskListSnapshot {
  return queryClient.getQueriesData<Task[]>({ queryKey: taskKeys.all });
}

function restoreTaskLists(prev: TaskListSnapshot) {
  for (const [key, data] of prev) queryClient.setQueryData(key, data);
}

/**
 * The cached copy of each id, taken before a bulk write patches it. Keyed by id
 * (first cache hit wins) so a partial failure can put back exactly the rows that
 * didn't land, instead of reverting the whole cache — including the writes that
 * succeeded.
 */
function snapshotTasksById(ids: Set<string>): Map<string, Task> {
  const byId = new Map<string, Task>();
  for (const [, list] of queryClient.getQueriesData<Task[]>({
    queryKey: taskKeys.all,
  })) {
    for (const t of list ?? []) {
      if (ids.has(t.id) && !byId.has(t.id)) byId.set(t.id, t);
    }
  }
  return byId;
}

/** Merge a per-id patch into every cached list. */
function patchCachedTasks(patches: Map<string, UpdateTaskInput>) {
  if (patches.size === 0) return;
  queryClient.setQueriesData<Task[]>({ queryKey: taskKeys.all }, (old) =>
    old?.map((t) => {
      const input = patches.get(t.id);
      return input ? ({ ...t, ...input } as Task) : t;
    })
  );
}

/** Put the pre-write copy back for `ids` only; every other row keeps its patch. */
function restoreCachedTasks(prevById: Map<string, Task>, ids: Set<string>) {
  if (ids.size === 0) return;
  queryClient.setQueriesData<Task[]>({ queryKey: taskKeys.all }, (old) =>
    old?.map((t) => (ids.has(t.id) ? prevById.get(t.id) ?? t : t))
  );
}

export function invalidateTasks() {
  queryClient.invalidateQueries({ queryKey: taskKeys.all });
  queryClient.invalidateQueries({ queryKey: projectKeys.all });
  // Completing the last task at a place should retire its geofence, and
  // reopening one should bring it back. Debounced — this runs on every write.
  scheduleGeofenceSync();
}

/** Complete or reopen a task, optimistically removing it from the relevant cache. */
export async function toggleComplete(id: string, complete: boolean) {
  await queryClient.cancelQueries({ queryKey: taskKeys.all });
  const prev = snapshotTaskLists();
  if (complete) {
    // Drop from active lists (today / inbox / project).
    queryClient.setQueriesData<Task[]>({ queryKey: taskKeys.lists() }, (old) =>
      old?.filter((t) => t.id !== id)
    );
  } else {
    // Reopening removes the row from the completed list.
    queryClient.setQueriesData<Task[]>({ queryKey: taskKeys.completed() }, (old) =>
      old?.filter((t) => t.id !== id)
    );
  }
  try {
    const api = await getTasksApi();
    const { error } = complete ? await api.complete(id) : await api.reopen(id);
    if (error) throw error;
  } catch (e) {
    restoreTaskLists(prev);
    throw e;
  } finally {
    invalidateTasks();
  }
}

/** Patch a task in place across every cached list (reschedule, field edits). */
export async function updateTask(id: string, input: UpdateTaskInput) {
  await queryClient.cancelQueries({ queryKey: taskKeys.all });
  const prev = snapshotTaskLists();
  queryClient.setQueriesData<Task[]>({ queryKey: taskKeys.all }, (old) =>
    old?.map((t) => (t.id === id ? ({ ...t, ...input } as Task) : t))
  );
  try {
    const api = await getTasksApi();
    const { error } = await api.update(id, input);
    if (error) throw error;
  } catch (e) {
    restoreTaskLists(prev);
    throw e;
  } finally {
    invalidateTasks();
  }
}

/** Delete a task, optimistically removing it from every cached list. */
export async function deleteTask(id: string) {
  await queryClient.cancelQueries({ queryKey: taskKeys.all });
  const prev = snapshotTaskLists();
  queryClient.setQueriesData<Task[]>({ queryKey: taskKeys.all }, (old) =>
    old?.filter((t) => t.id !== id)
  );
  try {
    const api = await getTasksApi();
    const { error } = await api.delete(id);
    if (error) throw error;
  } catch (e) {
    restoreTaskLists(prev);
    throw e;
  } finally {
    invalidateTasks();
  }
}

/** How a bulk write went, so the caller can tell the user when part of it didn't. */
export interface BulkWriteResult {
  /** Rows the server accepted. */
  updated: number;
  /** Rows that didn't land and were rolled back locally. */
  failed: number;
}

/**
 * Apply per-task patches in one go (bulk reschedule / move / priority).
 * Optimistically patches every target row across the cache, then writes via
 * TasksApi.bulkUpdate (which fans out to update, so pet feeding still fires).
 *
 * A bulk write is not all-or-nothing: rows that landed keep their new values and
 * only the failures are rolled back. Reverting the whole batch because one row
 * failed is what made a bulk reschedule look like it silently undid itself.
 */
async function bulkPatchTasks(
  patches: Array<{ id: string; input: UpdateTaskInput }>
): Promise<BulkWriteResult> {
  if (patches.length === 0) return { updated: 0, failed: 0 };
  await queryClient.cancelQueries({ queryKey: taskKeys.all });
  const byId = new Map(patches.map((p) => [p.id, p.input]));
  const prevById = snapshotTasksById(new Set(byId.keys()));
  patchCachedTasks(byId);

  let failedIds: string[];
  try {
    const api = await getTasksApi();
    ({ failedIds } = await api.bulkUpdate(patches));
  } catch {
    // bulkUpdate contains per-row failures itself, so reaching here means the
    // batch never ran (no session, no client) — nothing landed.
    failedIds = [...byId.keys()];
  }

  const failed = new Set(failedIds);
  // Re-assert the patch for everything that landed. A background refetch kicked
  // off mid-write (screen focus, app resume) can resolve *after* the optimistic
  // patch and overwrite it with pre-write rows — the longer the batch, the wider
  // that window, which is why it bit bulk actions and not single-row edits.
  patchCachedTasks(new Map([...byId].filter(([id]) => !failed.has(id))));
  restoreCachedTasks(prevById, failed);
  invalidateTasks();
  return { updated: patches.length - failed.size, failed: failed.size };
}

/** Apply one patch to many tasks at once. */
export async function bulkUpdateTasks(
  ids: string[],
  input: UpdateTaskInput
): Promise<BulkWriteResult> {
  return bulkPatchTasks(ids.map((id) => ({ id, input })));
}

/**
 * Bulk reschedule: set the do-date, dragging a now-stale hard deadline along
 * with it exactly as the single-row swipe reschedule does (see
 * TaskItem.buildReschedule).
 *
 * Without the due_date bump, pushing an overdue task to a later day leaves
 * `due_date` in the past, so `isOverdue()` stays true and the task never leaves
 * Today's Overdue section — the reschedule reads as though it reverted.
 */
export async function bulkRescheduleTasks(
  ids: string[],
  date: string
): Promise<BulkWriteResult> {
  const byId = snapshotTasksById(new Set(ids));
  return bulkPatchTasks(
    ids.map((id) => {
      const task = byId.get(id);
      const input: UpdateTaskInput = { when_date: date };
      if (task?.due_date && task.due_date < date) input.due_date = date;
      return { id, input };
    })
  );
}

/**
 * Complete or delete many tasks at once, optimistically dropping them from the
 * cache. Unlike a patch these remove rows, so a partial failure can't be undone
 * row-by-row in place — the full snapshot goes back only when nothing landed,
 * and otherwise the reconciling invalidate brings the stragglers back.
 */
async function bulkRemoveTasks(
  ids: string[],
  scope: readonly unknown[],
  write: (api: Awaited<ReturnType<typeof getTasksApi>>) => Promise<string[]>
): Promise<BulkWriteResult> {
  if (ids.length === 0) return { updated: 0, failed: 0 };
  await queryClient.cancelQueries({ queryKey: taskKeys.all });
  const prev = snapshotTaskLists();
  const idSet = new Set(ids);
  queryClient.setQueriesData<Task[]>({ queryKey: scope }, (old) =>
    old?.filter((t) => !idSet.has(t.id))
  );

  let failedIds: string[];
  try {
    failedIds = await write(await getTasksApi());
  } catch {
    failedIds = ids;
  }
  if (failedIds.length === ids.length) restoreTaskLists(prev);
  invalidateTasks();
  return { updated: ids.length - failedIds.length, failed: failedIds.length };
}

/** Complete many tasks at once, optimistically dropping them from active lists. */
export async function bulkCompleteTasks(ids: string[]): Promise<BulkWriteResult> {
  // status→done routes through update(), which stamps completed_at.
  return bulkRemoveTasks(ids, taskKeys.lists(), async (api) => {
    const { failedIds } = await api.bulkUpdate(
      ids.map((id) => ({ id, input: { status: 'done' as const } }))
    );
    return failedIds;
  });
}

/** Delete many tasks at once, optimistically removing them from every list. */
export async function bulkDeleteTasks(ids: string[]): Promise<BulkWriteResult> {
  return bulkRemoveTasks(ids, taskKeys.all, async (api) => {
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          return { id, error: (await api.delete(id)).error };
        } catch (e) {
          return { id, error: e as Error };
        }
      })
    );
    return results.filter((r) => r.error).map((r) => r.id);
  });
}

/** Create a project, then refetch project lists. Returns the new project. */
export async function createProject(
  input: CreateProjectInput
): Promise<Project> {
  const api = await getProjectsApi();
  const { data, error } = await api.create(input);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: projectKeys.all });
  return data as Project;
}

/**
 * Persist a reordered set of project ids (drag-to-reorder). The caller owns the
 * optimistic local order; here we just write sort_order and reconcile. The new
 * order flows to every project list (this tab, the picker, the web sidebar).
 */
export async function reorderProjects(orderedIds: string[]) {
  const api = await getProjectsApi();
  const { error } = await api.reorder(orderedIds);
  queryClient.invalidateQueries({ queryKey: projectKeys.all });
  if (error) throw error;
}

/**
 * Persist a reordered set of task ids (drag-to-reorder). The caller owns the
 * optimistic local order; here we just write sort_order and reconcile.
 */
export async function reorderTasks(orderedIds: string[]) {
  const api = await getTasksApi();
  const { error } = await api.bulkUpdate(
    orderedIds.map((id, i) => ({ id, input: { sort_order: (i + 1) * 1000 } }))
  );
  queryClient.invalidateQueries({ queryKey: taskKeys.all });
  if (error) throw error;
}
