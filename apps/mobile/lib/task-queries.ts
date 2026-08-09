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
  TaskStatus,
  UpdateTaskInput,
} from '@do-done/shared';
import { getProjectsApi, getTasksApi } from './supabase';
import { queryClient } from './query-client';
import { refreshTaskWidgets } from './widgets';
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

/** The `sort_order` a drag assigns to the nth id it hands back. */
function rankFor(index: number): number {
  return (index + 1) * 1000;
}

/**
 * Apply a drag's new order to every cached list, so the order the finger chose
 * is the order the cache holds for the whole round trip.
 *
 * Without this the cache kept the *pre-drag* order until the write came back,
 * and anything that re-read the cache in between — an optimistic field patch,
 * a background refetch — re-seeded the list into that stale order and then out
 * of it again a moment later. Every list is ordered by `sort_order` alone
 * (`TasksApi.list`) and `generateFocusList` breaks its ties the same way, so
 * re-sorting here reproduces exactly what the refetch will return. Sort is
 * stable, so rows the drag didn't touch keep their relative places.
 */
function patchCachedOrder(orderedIds: string[]) {
  if (orderedIds.length === 0) return;
  const ranks = new Map(orderedIds.map((id, i) => [id, rankFor(i)]));
  queryClient.setQueriesData<Task[]>({ queryKey: taskKeys.all }, (old) =>
    old
      ? old
          .map((t) => {
            const rank = ranks.get(t.id);
            return rank === undefined ? t : ({ ...t, sort_order: rank } as Task);
          })
          .sort((a, b) => a.sort_order - b.sort_order)
      : old
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
  // Keep home-screen widgets in sync with in-app changes (debounced, Android-only).
  refreshTaskWidgets();
  // Completing the last task at a place should retire its geofence, and
  // reopening one should bring it back. Debounced — this runs on every write.
  scheduleGeofenceSync();
}

export interface ToggleCompleteOptions {
  /**
   * Keep the task in its list for this long before dropping it, so the row can
   * play its completion animation while it is still mounted.
   *
   * Only the *disappearance* is held. The write goes out immediately either
   * way, so nothing is lost if the app is backgrounded or killed mid-animation
   * — the hold is a rendering concern that never reaches the network.
   */
  holdMs?: number;
  /**
   * Reopening only: the status the task held before it was completed, so an
   * Undo restores the state the user actually had. Omitted for a plain
   * uncheck, which has no earlier state to go back to and lands on
   * `not_started`. Ignored when completing.
   */
  restoreStatus?: TaskStatus;
}

/**
 * Completion writes in flight, one chain per task id, and the sequence number
 * of the most recent *intent* for that id.
 *
 * Undo is a second write to the same row while the first is still in the air:
 * the toast goes up the moment the completion is sent, and the row is still
 * being held on screen for its collapse animation. Fired concurrently, the two
 * UPDATEs race — the row keeps whichever reached Postgres second — so tapping
 * Undo quickly could leave the task completed and the toast looking inert.
 *
 * Chaining per id makes the *last intent* the last write. The sequence number
 * is claimed before the queue is joined, so a superseded write also knows to
 * keep its hands off the cache on the way out: its `dropFromLists()` would
 * otherwise fire mid-undo and take the row the user just asked back.
 */
const completionChains = new Map<string, Promise<unknown>>();
const completionSeq = new Map<string, number>();

/** Complete or reopen a task, optimistically removing it from the relevant cache. */
export async function toggleComplete(
  id: string,
  complete: boolean,
  options: ToggleCompleteOptions = {}
) {
  const seq = (completionSeq.get(id) ?? 0) + 1;
  completionSeq.set(id, seq);

  const run = () => runToggleComplete(id, complete, options, seq);
  // `.then(run, run)` rather than `.finally` — a failed write must not stop the
  // next one from being attempted, and must not reject *its* promise either.
  const chained = (completionChains.get(id) ?? Promise.resolve()).then(run, run);
  completionChains.set(
    id,
    chained.catch(() => {})
  );

  try {
    return await chained;
  } finally {
    // Last one out clears the row's slot, so the map can't grow with the
    // session. A newer intent means the chain is still someone else's.
    if (completionSeq.get(id) === seq) {
      completionSeq.delete(id);
      completionChains.delete(id);
    }
  }
}

async function runToggleComplete(
  id: string,
  complete: boolean,
  options: ToggleCompleteOptions,
  seq: number
) {
  /** True once a newer toggle for this row has been asked for (an Undo tap). */
  const superseded = () => (completionSeq.get(id) ?? seq) !== seq;

  const holdMs = options.holdMs ?? 0;
  await queryClient.cancelQueries({ queryKey: taskKeys.all });
  const prev = snapshotTaskLists();

  const dropFromLists = () => {
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
  };

  // Without a hold this is the usual optimistic patch: the row goes on the same
  // frame as the tap. With one, the row stays put and the caller's animation
  // owns the exit.
  if (holdMs === 0) dropFromLists();

  const startedAt = Date.now();
  try {
    const api = await getTasksApi();
    const { error } = complete
      ? await api.complete(id)
      : await api.reopen(id, options.restoreStatus);
    if (error) throw error;
  } catch (e) {
    // A no-op when we never dropped anything, which is exactly right — the
    // caller un-collapses the row and it was never missing from the list.
    restoreTaskLists(prev);
    if (!superseded()) invalidateTasks();
    throw e;
  }

  if (holdMs > 0) {
    // Measured from the tap, not from here: a slow write has already spent part
    // of the animation's runtime, and waiting the full hold on top of it would
    // leave a finished row sitting there.
    const remaining = holdMs - (Date.now() - startedAt);
    // Nothing to hold *for* once an Undo is queued behind us: the row is
    // staying, and the sooner the reopen goes out the better.
    if (remaining > 0 && !superseded())
      await new Promise((r) => setTimeout(r, remaining));
    if (!superseded()) dropFromLists();
  }
  // Held until now on purpose: a refetch landing mid-animation would report the
  // task as done and pull the row out from under it. Skipped when superseded —
  // the write queued behind us invalidates on its own, and this one's refetch
  // would only race it with an answer the user has already taken back.
  if (!superseded()) invalidateTasks();
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
 * Without the deadline_date bump, pushing an overdue task to a later day leaves
 * `deadline_date` in the past, so `isOverdue()` stays true and the task never leaves
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
      const input: UpdateTaskInput = { scheduled_date: date };
      if (task?.deadline_date && task.deadline_date < date) input.deadline_date = date;
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
 * The quick-add surfaces' inline "New project" action. Same write as
 * {@link createProject}, but it reports failure by returning null instead of
 * throwing: the caller is a popover floating over a half-typed task, and an
 * unhandled rejection there would take the capture down with it.
 */
export async function createProjectOrNull(
  name: string,
  color: string
): Promise<Project | null> {
  try {
    return await createProject({ name, color });
  } catch (err) {
    console.error("Create project failed:", err);
    return null;
  }
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

/** The `sort_order` patches a drag's id list turns into. */
function orderPatches(orderedIds: string[]) {
  return orderedIds.map((id, i) => ({ id, input: { sort_order: rankFor(i) } }));
}

/**
 * Persist a reordered set of task ids (drag-to-reorder).
 *
 * The dropped order goes into the cache *before* the write, not after it. The
 * drag list keeps a local copy too, but it re-seeds itself from the cache
 * whenever the cache changes — so a cache still holding the pre-drag order is
 * one background refetch away from yanking the row back out from under the
 * finger.
 */
export async function reorderTasks(orderedIds: string[]) {
  await queryClient.cancelQueries({ queryKey: taskKeys.all });
  const prev = snapshotTaskLists();
  patchCachedOrder(orderedIds);
  const api = await getTasksApi();
  const { error } = await api.bulkUpdate(orderPatches(orderedIds));
  if (error) restoreTaskLists(prev);
  queryClient.invalidateQueries({ queryKey: taskKeys.all });
  refreshTaskWidgets();
  if (error) throw error;
}

/**
 * A drag that both re-files a task and re-orders its destination section: the
 * field patch and the new order land together, as one optimistic update and
 * one reconciling invalidate.
 *
 * This was `updateTask(id, input).then(() => reorderTasks(ids))`, and that
 * sequence is what made a move flash the whole list. `updateTask` patched the
 * cache and invalidated on its own, so the list re-seeded twice — both times
 * from a cache carrying the new *section* but the pre-drag `sort_order`, which
 * is the only thing that decides a row's position within it. The row landed in
 * the wrong slot, the list re-laid-out around it, and only the second write's
 * refetch put it where the finger had left it a second earlier.
 */
export async function moveTask(
  id: string,
  input: UpdateTaskInput,
  orderedIds: string[]
) {
  await queryClient.cancelQueries({ queryKey: taskKeys.all });
  const prev = snapshotTaskLists();
  patchCachedTasks(new Map([[id, input]]));
  patchCachedOrder(orderedIds);
  try {
    const api = await getTasksApi();
    const { error } = await api.update(id, input);
    if (error) throw error;
    // The move landed; the order is a separate write because `sort_order` has
    // to be stamped across the whole destination section, not just this row.
    const { error: orderError } = await api.bulkUpdate(orderPatches(orderedIds));
    if (orderError) throw orderError;
  } catch (e) {
    restoreTaskLists(prev);
    throw e;
  } finally {
    invalidateTasks();
  }
}
