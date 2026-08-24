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
import { buildSuggestionIndex } from '@do-done/shared';
import type {
  CreateProjectInput,
  Project,
  Task,
  TaskFilterInput,
  TaskStatus,
  UpdateProjectInput,
  UpdateTaskInput,
} from '@do-done/shared';
import { getProjectsApi, getTasksApi } from './supabase';
import { queryClient } from './query-client';
import { refreshTaskWidgets } from './widgets';
import { scheduleGeofenceSync } from './location-queries';
import { notifyAutoSync } from './auto-sync-notice';

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
  // A tag list holds finished tasks too (the view's Display menu decides
  // whether to show them), so it can't live under lists() — a completion
  // must not optimistically drop the row out of a list that means to keep it.
  tagged: (tag: string) => [...taskKeys.all, 'tag', tag] as const,
  /**
   * One task on its own — a subtask's parent, for the "↳ parent" breadcrumb.
   *
   * **The only cache under this root that isn't a `Task[]`.** Every optimistic
   * sweep filters on `taskKeys.all`, which matches this by prefix, so they all
   * go through `patchTaskLists` and skip anything that isn't a list. Named here
   * rather than spelled out at the hook so the exception is visible next to the
   * rule it breaks.
   */
  detail: (id: string) => [...taskKeys.all, 'detail', id] as const,
};

export const tagKeys = {
  all: ['tags'] as const,
  summary: () => [...tagKeys.all, 'summary'] as const,
};

/**
 * Shopping lists. Defined here rather than in `list-queries.ts` — which is
 * where every hook that uses it lives — because the optimistic sweeps below
 * have to reach the *items*, and a `list-queries` import here would be a cycle.
 *
 * A list item is a task, so completing one, deleting it or rescheduling it goes
 * through the same writes every other row does. But its cache is under this
 * root rather than `taskKeys`, so a sweep scoped to `taskKeys.all` misses it:
 * ticking something off left the row sitting exactly where it was until the
 * screen was left and re-entered, on the one surface where the tick *is* the
 * feedback.
 *
 * `items()` is swept and the other two are not, and that distinction matters:
 * `index()` caches `Project[]`, which is an array and would sail straight
 * through an `Array.isArray` guard into an updater written for tasks.
 */
export const listKeys = {
  all: ['lists'] as const,
  index: () => [...listKeys.all, 'index'] as const,
  counts: () => [...listKeys.all, 'counts'] as const,
  /** Prefix for every list's items — what the sweeps below match on. */
  items: () => [...listKeys.all, 'items'] as const,
  itemsFor: (listId: string) => [...listKeys.items(), listId] as const,
};

/**
 * Its own root, outside `taskKeys`, for the same reason `tagKeys` is: the
 * optimistic `setQueriesData<Task[]>` sweeps rewrite everything under
 * `taskKeys.all`, and this cache holds a `SuggestionIndex` — a pair of Maps,
 * not an array of tasks.
 *
 * Deliberately **not** in `invalidateTasks()`, which is where it differs from
 * tags. A tag count is an index of what exists and is wrong the moment a task
 * moves; this is a guess from habit, and one more task changes it by about
 * nothing. Refetching 800 rows after every create would be the most expensive
 * write in the app, in service of a suggestion that would have been the same.
 */
export const suggestionKeys = {
  all: ['suggestions'] as const,
  index: () => [...suggestionKeys.all, 'index'] as const,
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

/**
 * Every tag the user has, with its counts.
 *
 * Server-side rather than derived from a loaded list: the tags on the 100
 * tasks Today happens to hold are not the user's tags, and an index that
 * silently omits some is worse than no index.
 */
export function useTags() {
  return useQuery({
    queryKey: tagKeys.summary(),
    queryFn: async () => {
      const api = await getTasksApi();
      const { data, error } = await api.listTags();
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * The counted history behind quick-add's guesses.
 *
 * One fetch per session, held for it: `staleTime: Infinity` is what makes this
 * a session-long read rather than something `useRefreshOnFocus` re-fires on
 * every tab switch. The index it resolves to is a pair of Maps, built once
 * here rather than per keystroke in the composer.
 *
 * Never call this from `QuickAddFields` — it has to keep working in the widget
 * root, which has no QueryClientProvider. The hosts that *do* have one pass
 * the index down; the widget root builds its own.
 */
export function useSuggestionIndex() {
  return useQuery({
    queryKey: suggestionKeys.index(),
    staleTime: Infinity,
    queryFn: async () => {
      const api = await getTasksApi();
      const { data, error } = await api.suggestionHistory();
      if (error) throw error;
      return buildSuggestionIndex(data ?? []);
    },
  });
}

/** Every task carrying one tag — server-filtered, so nothing is off the page. */
export function useTaggedTasks(tag: string) {
  return useQuery({
    queryKey: taskKeys.tagged(tag),
    enabled: tag.length > 0,
    queryFn: async () => {
      const api = await getTasksApi();
      const { data, error } = await api.listByTag(tag);
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
    queryKey: taskKeys.detail(parentId ?? 'none'),
    enabled: !!parentId,
    queryFn: async () => {
      const cached = cachedTaskLists()
        .flat()
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

/**
 * The rollback token for an optimistic write: every cache `patchTaskLists` is
 * about to touch, as it stood before it touched it.
 *
 * **It has to cover the same roots the patch does.** It read `taskKeys.all`
 * alone while the patch had already grown a second root, so a failed write put
 * the task lists back and left the shopping-list items showing a change that
 * never landed — visible until the next refetch, on the one surface where the
 * row *is* the feedback.
 */
function snapshotTaskLists(): TaskListSnapshot {
  return TASK_LIST_ROOTS.flatMap((key) =>
    queryClient.getQueriesData<Task[]>({ queryKey: key })
  );
}

function restoreTaskLists(prev: TaskListSnapshot) {
  for (const [key, data] of prev) queryClient.setQueryData(key, data);
}

/**
 * Apply an array-shaped updater to every cached task **list** in `scope`,
 * passing over any cache that doesn't hold one.
 *
 * Not everything under `taskKeys.all` is a list. `useParentTask` caches a
 * single `Task` under `taskKeys.detail(id)` for a subtask's "↳ parent"
 * breadcrumb, and a `{ queryKey: taskKeys.all }` filter matches it by prefix —
 * so every one of these sweeps met it with `old.map` / `old.filter` and threw
 * `is not a function`.
 *
 * That throw came out of `setQueriesData` **synchronously**, i.e. before the
 * `try` that owns the write and the reconciling `invalidateTasks()`, and every
 * caller swallows the rejection (`.catch(() => {})`). `setQueriesData` walks
 * the cache in insertion order, so the lists it reached first kept their
 * optimistic patch: the row left the list it was in, nothing was ever sent, and
 * the task stayed exactly where it was. One subtask row anywhere on screen was
 * enough, and the detail cache then outlived it — swipe-to-Tomorrow, delete and
 * every bulk action were dead for the rest of the session.
 *
 * A guard rather than a narrower filter, because the invariant these helpers
 * rely on ("everything here is a `Task[]`") is one a future query can break
 * again just by caching a task on its own. Skipped caches are reconciled by
 * `invalidateTasks()` like everything else.
 */
function patchTaskLists(
  updater: (old: Task[]) => Task[],
  scope?: readonly unknown[]
) {
  for (const key of scope ? [scope] : TASK_LIST_ROOTS) {
    queryClient.setQueriesData<Task[]>({ queryKey: key }, (old) =>
      Array.isArray(old) ? updater(old) : old
    );
  }
}

/**
 * Every root holding a `Task[]`. The shopping-list items are the second one:
 * they are ordinary task rows kept under their own key, so a sweep that only
 * knows about `taskKeys` leaves them showing the state before the write.
 */
const TASK_LIST_ROOTS: readonly (readonly unknown[])[] = [
  taskKeys.all,
  listKeys.items(),
];

/**
 * Stop any refetch that would land on top of the optimistic patch about to be
 * written, across the same roots `patchTaskLists` writes to.
 *
 * A fetch already in the air was sent before this write existed, so its answer
 * is the state the user is trying to change. Letting it resolve afterwards puts
 * the row back where it started — for a whole round trip, until the write's own
 * `invalidateTasks()` fetches again — which reads as the tap having done
 * nothing.
 *
 * `taskKeys.all` was the whole of it while it was the whole of `TASK_LIST_ROOTS`;
 * a shopping list's items are cached under their own root, and `invalidateTasks`
 * refetches that root on *every* write, so on a list the window was wide open.
 */
function cancelTaskFetches(): Promise<void[]> {
  return Promise.all(
    TASK_LIST_ROOTS.map((key) => queryClient.cancelQueries({ queryKey: key }))
  );
}

/** Every cached task list, ignoring the caches that hold something else. */
function cachedTaskLists(): Task[][] {
  return TASK_LIST_ROOTS.flatMap((key) =>
    queryClient
      .getQueriesData<Task[]>({ queryKey: key })
      .map(([, list]) => list)
      .filter((list): list is Task[] => Array.isArray(list))
  );
}

/**
 * The cached copy of each id, taken before a bulk write patches it. Keyed by id
 * (first cache hit wins) so a partial failure can put back exactly the rows that
 * didn't land, instead of reverting the whole cache — including the writes that
 * succeeded.
 */
function snapshotTasksById(ids: Set<string>): Map<string, Task> {
  const byId = new Map<string, Task>();
  for (const list of cachedTaskLists()) {
    for (const t of list) {
      if (ids.has(t.id) && !byId.has(t.id)) byId.set(t.id, t);
    }
  }
  return byId;
}

/** Merge a per-id patch into every cached list. */
function patchCachedTasks(patches: Map<string, UpdateTaskInput>) {
  if (patches.size === 0) return;
  patchTaskLists((old) =>
    old.map((t) => {
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
  patchTaskLists((old) =>
    old
      .map((t) => {
        const rank = ranks.get(t.id);
        return rank === undefined ? t : ({ ...t, sort_order: rank } as Task);
      })
      .sort((a, b) => a.sort_order - b.sort_order)
  );
}

/** Put the pre-write copy back for `ids` only; every other row keeps its patch. */
function restoreCachedTasks(prevById: Map<string, Task>, ids: Set<string>) {
  if (ids.size === 0) return;
  patchTaskLists((old) =>
    old.map((t) => (ids.has(t.id) ? prevById.get(t.id) ?? t : t))
  );
}

export function invalidateTasks() {
  queryClient.invalidateQueries({ queryKey: taskKeys.all });
  queryClient.invalidateQueries({ queryKey: projectKeys.all });
  // The tag summary is counts over tasks, so any write can move it — a tag
  // added in the editor, a task completed, a task deleted. Kept out of
  // taskKeys so the optimistic `setQueriesData<Task[]>` sweeps never reach
  // it: its cached value is TagSummary[], not Task[].
  queryClient.invalidateQueries({ queryKey: tagKeys.all });
  // Same argument as tags, one root over: a list's items and its open/bought
  // counts are a view of task rows, so any write can move them.
  queryClient.invalidateQueries({ queryKey: listKeys.all });
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
  await cancelTaskFetches();
  const prev = snapshotTaskLists();

  const dropFromLists = () => {
    if (complete) {
      // Drop from active lists (today / inbox / project).
      patchTaskLists((old) => old.filter((t) => t.id !== id), taskKeys.lists());
    } else {
      // Reopening removes the row from the completed list.
      patchTaskLists(
        (old) => old.filter((t) => t.id !== id),
        taskKeys.completed()
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
  await cancelTaskFetches();
  const prev = snapshotTaskLists();
  patchTaskLists((old) =>
    old.map((t) => (t.id === id ? ({ ...t, ...input } as Task) : t))
  );
  try {
    const api = await getTasksApi();
    const { error, autoSync } = await api.update(id, input);
    if (error) throw error;
    // The status ↔ schedule rule may have changed something the caller didn't
    // ask for — re-dating a task into the horizon moves it to Next. Said here,
    // at the one door every mobile write goes through, rather than at each of
    // the swipe / drag / editor / bulk call sites that would each have to
    // remember to.
    notifyAutoSync(autoSync?.notice);
  } catch (e) {
    restoreTaskLists(prev);
    throw e;
  } finally {
    invalidateTasks();
  }
}

export interface DeleteTaskOptions {
  /**
   * Keep the row in the cache for this long so the caller's exit animation can
   * play over it.
   *
   * Without it the optimistic patch drops the row on the same tick as the tap,
   * which is the whole reason a deletion had no gesture: the row was there, and
   * then it wasn't. Zero (the default) is the old behaviour, and is what a
   * caller with nothing on screen to animate should pass.
   */
  holdMs?: number;
}

/**
 * Delete a task, optimistically removing it from every cached list.
 *
 * Nothing is destroyed — `TasksApi.delete` stamps the rows and hides them —
 * so the returned ids are an undo token: hand them to {@link restoreTasks} and
 * the same tasks come back, subtasks and attachments included. See the
 * deletion notes in `packages/api-client/src/tasks.ts`.
 */
export async function deleteTask(
  id: string,
  options: DeleteTaskOptions = {}
): Promise<string[]> {
  const holdMs = options.holdMs ?? 0;
  await cancelTaskFetches();
  const prev = snapshotTaskLists();
  const dropFromLists = () =>
    patchTaskLists((old) => old.filter((t) => t.id !== id));

  if (holdMs === 0) dropFromLists();

  const startedAt = Date.now();
  let ids: string[];
  try {
    const api = await getTasksApi();
    const result = await api.delete(id);
    if (result.error) throw result.error;
    ids = result.ids;
  } catch (e) {
    // A no-op when we never dropped anything, which is exactly right — the
    // caller un-collapses the row and it was never missing from the list.
    restoreTaskLists(prev);
    invalidateTasks();
    throw e;
  }

  if (holdMs > 0) {
    // Measured from the tap, not from here: a slow write has already spent part
    // of the animation's runtime, and waiting the full envelope on top of it
    // would leave a finished row sitting there at zero height.
    const remaining = holdMs - (Date.now() - startedAt);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    dropFromLists();
  }
  // Held until now on purpose: a refetch landing mid-animation would report the
  // task as still present and pull the row back out from under its own exit.
  invalidateTasks();
  return ids;
}

/**
 * Undo a delete: the same rows, back where they were.
 *
 * No optimistic patch, deliberately. The cache dropped these rows and has no
 * copy of them to put back — the *server* is the only thing that still holds
 * the task, which is the entire point of the soft delete — so the invalidate
 * is what makes them reappear, with everything that hung off them intact.
 */
export async function restoreTasks(ids: string[]) {
  if (ids.length === 0) return;
  try {
    const api = await getTasksApi();
    const { error } = await api.restore(ids);
    if (error) throw error;
  } finally {
    invalidateTasks();
  }
}

/**
 * Destroy anything whose retention window has run out.
 *
 * Fire-and-forget housekeeping: nothing on screen depends on it, since these
 * rows have been invisible since the moment they were deleted. Driven from the
 * app's sweeps rather than a server timer — the same shape, and the same
 * reasoning, as `syncScheduledToStatus`.
 */
export async function purgeDeletedTasks() {
  try {
    const api = await getTasksApi();
    await api.purgeDeleted();
  } catch {
    // The next launch tries again.
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
  await cancelTaskFetches();
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
  await cancelTaskFetches();
  const prev = snapshotTaskLists();
  const idSet = new Set(ids);
  patchTaskLists((old) => old.filter((t) => !idSet.has(t.id)), scope);

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
 * Rename a project or list, or change its colour or icon.
 *
 * `projectKeys.all` covers the detail read the list screen's title bar uses,
 * so the header changes with the write rather than on the next focus.
 */
export async function updateProject(
  id: string,
  input: UpdateProjectInput
): Promise<Project> {
  const api = await getProjectsApi();
  const { data, error } = await api.update(id, input);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: projectKeys.all });
  return data as Project;
}

/**
 * Delete a project or list. The tasks in it survive, unfiled — that is what
 * the column's `on delete set null` does, and what the confirmation says.
 *
 * `invalidateTasks()` as well as the project caches, because every row that
 * pointed at it is now drawing a project that is gone.
 */
export async function deleteProject(id: string): Promise<void> {
  const api = await getProjectsApi();
  const { error } = await api.delete(id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: projectKeys.all });
  invalidateTasks();
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
  await cancelTaskFetches();
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
  await cancelTaskFetches();
  const prev = snapshotTaskLists();
  patchCachedTasks(new Map([[id, input]]));
  patchCachedOrder(orderedIds);
  try {
    const api = await getTasksApi();
    const { error, autoSync } = await api.update(id, input);
    if (error) throw error;
    notifyAutoSync(autoSync?.notice);
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
