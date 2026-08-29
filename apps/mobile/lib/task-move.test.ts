/**
 * What the cache holds *while* a drag is being written.
 *
 * A drag list re-seeds itself from the query cache whenever the cache changes,
 * so the cache holding the pre-drag order for the length of a round trip is not
 * a cosmetic detail — it is one background refetch away from moving the row out
 * from under the finger, and a cross-section move used to guarantee it: the
 * field patch went in first and on its own, leaving a cache that agreed about
 * the task's new section and still carried its old `sort_order`, which is the
 * only thing that decides its place inside one.
 *
 * These tests hold both writes open and assert on the cache in between, because
 * that in-between is the entire bug. The settled state was always correct.
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
vi.mock("./supabase", () => ({
  getTasksApi: async () => ({ update, bulkUpdate }),
  getProjectsApi: async () => ({}),
}));

// Native seams `invalidateTasks` fans out to; irrelevant here, absent in node.
vi.mock("./widgets", () => ({ refreshTaskWidgets: vi.fn() }));
vi.mock("./location-queries", () => ({ scheduleGeofenceSync: vi.fn() }));
// invalidateTasks() re-arms the per-task reminders, which reaches native
// notification APIs. Stubbed for the same reason the geofence sync above is.
vi.mock("./task-reminders", () => ({ scheduleTaskReminderSync: vi.fn() }));

const { taskKeys, moveTask, reorderTasks } = await import("./task-queries");

function seed(...ids: string[]) {
  queryClient.setQueryData(
    taskKeys.today(),
    ids.map(
      (id, i) =>
        ({
          id,
          title: id,
          status: "not_started",
          sort_order: (i + 1) * 1000,
          scheduled_date: null,
        }) as unknown as Task
    )
  );
}

const cached = () => queryClient.getQueryData<Task[]>(taskKeys.today()) ?? [];
const order = () => cached().map((t) => t.id);

/** Let every pending microtask settle, leaving only the deferred write. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** A write we can leave in flight for as long as the test needs. */
function deferred<T>() {
  let settle!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    settle = res;
  });
  return { promise, resolve: (v: T) => settle(v) };
}

beforeEach(() => {
  queryClient.clear();
  update.mockReset();
  bulkUpdate.mockReset();
  update.mockResolvedValue({ data: null, error: null });
  bulkUpdate.mockResolvedValue({ data: [], failedIds: [], error: null });
});

describe("reorderTasks", () => {
  it("puts the dropped order in the cache before the write goes out", async () => {
    seed("a", "b", "c");
    const write = deferred<{ failedIds: string[]; error: null }>();
    bulkUpdate.mockReturnValue(write.promise);

    const done = reorderTasks(["c", "a", "b"]);
    // Let getTasksApi() and the optimistic patch settle, but not the write.
    await flush();

    expect(order()).toEqual(["c", "a", "b"]);

    write.resolve({ failedIds: [], error: null });
    await done;
    expect(order()).toEqual(["c", "a", "b"]);
  });

  it("puts the old order back when the write fails", async () => {
    seed("a", "b", "c");
    bulkUpdate.mockResolvedValue({
      data: [],
      failedIds: ["c"],
      error: new Error("offline"),
    });

    await expect(reorderTasks(["c", "a", "b"])).rejects.toThrow("offline");
    expect(order()).toEqual(["a", "b", "c"]);
  });
});

describe("moveTask", () => {
  it("applies the field patch and the new order together", async () => {
    seed("a", "b", "c");
    const fieldWrite = deferred<{ data: null; error: null }>();
    update.mockReturnValue(fieldWrite.promise);

    const done = moveTask("c", { scheduled_date: "2026-08-09" }, ["c", "a", "b"]);
    await flush();

    // Mid-flight — the field write hasn't even come back yet. Both halves of
    // the drag are already visible, so nothing re-seeds into a half-applied
    // state and back out of it.
    expect(order()).toEqual(["c", "a", "b"]);
    expect(cached().find((t) => t.id === "c")?.scheduled_date).toBe("2026-08-09");

    fieldWrite.resolve({ data: null, error: null });
    await done;
    expect(order()).toEqual(["c", "a", "b"]);
  });

  it("writes the order across the whole destination section", async () => {
    seed("a", "b", "c");
    await moveTask("c", { scheduled_date: "2026-08-09" }, ["c", "a", "b"]);

    expect(update).toHaveBeenCalledWith("c", { scheduled_date: "2026-08-09" });
    expect(bulkUpdate).toHaveBeenCalledWith([
      { id: "c", input: { sort_order: 1000 } },
      { id: "a", input: { sort_order: 2000 } },
      { id: "b", input: { sort_order: 3000 } },
    ]);
  });

  it("rolls back to the pre-drag state when the field write fails", async () => {
    seed("a", "b", "c");
    update.mockResolvedValue({ data: null, error: new Error("offline") });

    await expect(
      moveTask("c", { scheduled_date: "2026-08-09" }, ["c", "a", "b"])
    ).rejects.toThrow("offline");

    expect(order()).toEqual(["a", "b", "c"]);
    expect(cached().find((t) => t.id === "c")?.scheduled_date).toBeNull();
    // The order write never went out — a move that didn't land must not
    // reshuffle the section it failed to join.
    expect(bulkUpdate).not.toHaveBeenCalled();
  });

  it("rolls back the field patch too when only the order write fails", async () => {
    seed("a", "b", "c");
    bulkUpdate.mockResolvedValue({
      data: [],
      failedIds: ["c"],
      error: new Error("offline"),
    });

    await expect(
      moveTask("c", { scheduled_date: "2026-08-09" }, ["c", "a", "b"])
    ).rejects.toThrow("offline");

    expect(order()).toEqual(["a", "b", "c"]);
    expect(cached().find((t) => t.id === "c")?.scheduled_date).toBeNull();
  });
});
