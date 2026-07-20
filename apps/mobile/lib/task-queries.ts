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
import { refreshTaskWidgets } from './widgets';

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

export function invalidateTasks() {
  queryClient.invalidateQueries({ queryKey: taskKeys.all });
  queryClient.invalidateQueries({ queryKey: projectKeys.all });
  // Keep home-screen widgets in sync with in-app changes (debounced, Android-only).
  refreshTaskWidgets();
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
 * Persist a reordered set of task ids (drag-to-reorder). The caller owns the
 * optimistic local order; here we just write sort_order and reconcile.
 */
export async function reorderTasks(orderedIds: string[]) {
  const api = await getTasksApi();
  const { error } = await api.bulkUpdate(
    orderedIds.map((id, i) => ({ id, input: { sort_order: (i + 1) * 1000 } }))
  );
  queryClient.invalidateQueries({ queryKey: taskKeys.all });
  refreshTaskWidgets();
  if (error) throw error;
}
