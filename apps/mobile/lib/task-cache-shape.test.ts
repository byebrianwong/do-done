/**
 * Not every cache under `['tasks']` holds a list.
 *
 * The optimistic sweeps are all `setQueriesData<Task[]>({ queryKey:
 * taskKeys.all }, …)` with an array-shaped updater — `old?.map`, `old?.filter`,
 * `.sort`. `useParentTask` caches a *single* `Task` under
 * `['tasks','detail',<id>]`, which that filter matches by prefix, so the moment
 * a subtask row was on screen the next write hit `old.map is not a function`.
 *
 * The throw came out of `setQueriesData` synchronously, i.e. *before* the try
 * block that owns the write and the reconciling invalidate, and every caller
 * swallows it (`.catch(() => {})`). So the lists visited before the detail
 * query in cache order kept their optimistic patch — the row vanished — and
 * nothing was ever sent. The task stayed exactly where it was.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { Task } from "@do-done/shared";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity } },
});
vi.mock("./query-client", () => ({ queryClient }));

const update = vi.fn();
const bulkUpdate = vi.fn();
const del = vi.fn();
vi.mock("./supabase", () => ({
  getTasksApi: async () => ({ update, bulkUpdate, delete: del }),
  getProjectsApi: async () => ({}),
}));

vi.mock("./widgets", () => ({ refreshTaskWidgets: vi.fn() }));
vi.mock("./location-queries", () => ({ scheduleGeofenceSync: vi.fn() }));
// invalidateTasks() re-arms the per-task reminders, which reaches native
// notification APIs. Stubbed for the same reason the geofence sync above is.
vi.mock("./task-reminders", () => ({ scheduleTaskReminderSync: vi.fn() }));

const { taskKeys, updateTask, deleteTask, bulkRescheduleTasks } = await import(
  "./task-queries"
);

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    status: "not_started",
    sort_order: 1000,
    scheduled_date: "2026-08-13",
    ...over,
  } as unknown as Task;
}

/**
 * The cache as it stands with a subtask row on screen: the lists, then the
 * parent lookup that row mounted. Insertion order matters — `setQueriesData`
 * walks the cache in it, so a throw part-way leaves the earlier lists patched.
 */
function seedWithParentDetail() {
  queryClient.setQueryData(taskKeys.today(), [task("a"), task("b")]);
  queryClient.setQueryData(taskKeys.everything(), [task("a"), task("b")]);
  queryClient.setQueryData(taskKeys.detail("p1"), task("p1"));
}

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  update.mockResolvedValue({ data: null, error: null });
  bulkUpdate.mockResolvedValue({ failedIds: [] });
  del.mockResolvedValue({ ids: ["a"], error: null });
});

describe("a single-task cache under taskKeys.all", () => {
  it("does not stop a reschedule from being written", async () => {
    seedWithParentDetail();

    await updateTask("a", { scheduled_date: "2026-08-14" });

    expect(update).toHaveBeenCalledWith("a", { scheduled_date: "2026-08-14" });
    const list = queryClient.getQueryData<Task[]>(taskKeys.everything());
    expect(list?.find((t) => t.id === "a")?.scheduled_date).toBe("2026-08-14");
  });

  it("is left alone rather than mangled", async () => {
    seedWithParentDetail();

    await updateTask("a", { scheduled_date: "2026-08-14" });

    expect(queryClient.getQueryData(taskKeys.detail("p1"))).toEqual(
      task("p1")
    );
  });

  it("does not stop a delete", async () => {
    seedWithParentDetail();

    await deleteTask("a");

    expect(del).toHaveBeenCalledWith("a");
  });

  it("does not stop a bulk reschedule", async () => {
    seedWithParentDetail();

    const result = await bulkRescheduleTasks(["a", "b"], "2026-08-14");

    expect(result).toEqual({ updated: 2, failed: 0 });
    expect(bulkUpdate).toHaveBeenCalled();
  });
});
