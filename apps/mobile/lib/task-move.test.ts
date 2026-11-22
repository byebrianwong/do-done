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
 * A drop now writes one task's position (`place`), or a sorted view's whole
 * order (`adoptOrder`). Every other task keeps its key.
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
const place = vi.fn();
const adoptOrder = vi.fn();
vi.mock("./supabase", () => ({
  getTasksApi: async () => ({ update, place, adoptOrder }),
  getProjectsApi: async () => ({}),
}));

// Native seams `invalidateTasks` fans out to; irrelevant here, absent in node.
vi.mock("./widgets", () => ({ refreshTaskWidgets: vi.fn() }));
vi.mock("./location-queries", () => ({ scheduleGeofenceSync: vi.fn() }));
// invalidateTasks() re-arms the per-task reminders, which reaches native
// notification APIs. Stubbed for the same reason the geofence sync above is.
vi.mock("./task-reminders", () => ({ scheduleTaskReminderSync: vi.fn() }));
// `./wear` reaches for react-native at module scope (AppState, Platform), so
// it is stood in for here like every other native seam in this suite.
vi.mock("./wear", () => ({ scheduleWatchSync: vi.fn() }));

const { taskKeys, listKeys, moveTask, reorderTasks, adoptTaskOrder } =
  await import("./task-queries");
const { isLocalReconcile, resetLocalWrite } = await import("./local-write");

function rowsFor(ids: string[]): Task[] {
  return ids.map(
    (id, i) =>
      ({
        id,
        title: id,
        status: "not_started",
        sort_order: (i + 1) * 1024,
        scheduled_date: null,
      }) as unknown as Task
  );
}

function seed(...ids: string[]) {
  queryClient.setQueryData(taskKeys.today(), rowsFor(ids));
}

const cached = () => queryClient.getQueryData<Task[]>(taskKeys.today()) ?? [];
const order = () => cached().map((t) => t.id);
const keyOf = (id: string) => cached().find((t) => t.id === id)?.sort_order;

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
  place.mockReset();
  adoptOrder.mockReset();
  update.mockResolvedValue({ data: null, error: null });
  place.mockResolvedValue({ data: 0, error: null });
  adoptOrder.mockResolvedValue({ error: null });
});

describe("reorderTasks", () => {
  it("puts the dropped order in the cache before the write goes out", async () => {
    seed("a", "b", "c");
    const write = deferred<{ data: number; error: null }>();
    place.mockReturnValue(write.promise);

    const done = reorderTasks("c", ["c", "a", "b"]);
    // Let getTasksApi() and the optimistic patch settle, but not the write.
    await flush();

    expect(order()).toEqual(["c", "a", "b"]);

    write.resolve({ data: 0, error: null });
    await done;
    expect(order()).toEqual(["c", "a", "b"]);
  });

  it("writes the moved task's place and re-keys nothing else", async () => {
    seed("a", "b", "c");
    await reorderTasks("a", ["b", "a", "c"]);

    expect(place.mock.calls).toEqual([["a", { after: "b", before: "c" }]]);
    expect(update).not.toHaveBeenCalled();
    expect(keyOf("b")).toBe(2048);
    expect(keyOf("c")).toBe(3072);
    expect(order()).toEqual(["b", "a", "c"]);
  });

  it("puts the old order back when the write fails", async () => {
    seed("a", "b", "c");
    place.mockResolvedValue({ data: null, error: new Error("offline") });

    await expect(reorderTasks("c", ["c", "a", "b"])).rejects.toThrow("offline");
    expect(order()).toEqual(["a", "b", "c"]);
  });

  /**
   * The refetch after a drop only confirms the order the drop already drew,
   * so the "updating" bar must stay down for it. Every other write gets that
   * from `invalidateTasks()`; a reorder does not call it.
   */
  it("marks its refetch as the reconcile of a local write", async () => {
    resetLocalWrite();
    seed("a", "b", "c");
    await reorderTasks("c", ["c", "a", "b"]);
    expect(isLocalReconcile()).toBe(true);
  });
});

describe("adoptTaskOrder", () => {
  it("swaps keys among the listed tasks only, before the write goes out", async () => {
    // `h` is on the list but not in the sorted view being made manual.
    seed("a", "h", "b");
    const write = deferred<{ error: null }>();
    adoptOrder.mockReturnValue(write.promise);

    const done = adoptTaskOrder(["b", "a"]);
    await flush();

    expect(order()).toEqual(["b", "h", "a"]);
    expect(keyOf("h")).toBe(2048);

    write.resolve({ error: null });
    await done;
    expect(adoptOrder).toHaveBeenCalledWith(["b", "a"]);
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

  it("writes the field change, then places the one task beside its new neighbours", async () => {
    seed("a", "b", "c");
    await moveTask("c", { scheduled_date: "2026-08-09" }, ["c", "a", "b"]);

    expect(update).toHaveBeenCalledWith("c", { scheduled_date: "2026-08-09" });
    expect(place.mock.calls).toEqual([["c", { after: null, before: "a" }]]);
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(
      place.mock.invocationCallOrder[0]
    );
  });

  it("adopts the whole shown order when a sorted view is being made manual", async () => {
    seed("a", "b", "c");
    await moveTask("c", { priority: "p1" }, ["c", "b", "a"], { adopt: true });

    expect(update).toHaveBeenCalledWith("c", { priority: "p1" });
    expect(adoptOrder).toHaveBeenCalledWith(["c", "b", "a"]);
    expect(place).not.toHaveBeenCalled();
  });

  it("writes no position when the task lands alone in its section", async () => {
    seed("a", "b", "c");
    await moveTask("c", { scheduled_date: "2026-08-09" }, ["c"]);

    expect(update).toHaveBeenCalledTimes(1);
    expect(place).not.toHaveBeenCalled();
  });

  it("rolls back to the pre-drag state when the field write fails", async () => {
    seed("a", "b", "c");
    update.mockResolvedValue({ data: null, error: new Error("offline") });

    await expect(
      moveTask("c", { scheduled_date: "2026-08-09" }, ["c", "a", "b"])
    ).rejects.toThrow("offline");

    expect(order()).toEqual(["a", "b", "c"]);
    expect(cached().find((t) => t.id === "c")?.scheduled_date).toBeNull();
    // The position never went out. A move that didn't land must not move the
    // task within the section it failed to join.
    expect(place).not.toHaveBeenCalled();
  });

  it("rolls back the field patch too when only the position write fails", async () => {
    seed("a", "b", "c");
    place.mockResolvedValue({ data: null, error: new Error("offline") });

    await expect(
      moveTask("c", { scheduled_date: "2026-08-09" }, ["c", "a", "b"])
    ).rejects.toThrow("offline");

    expect(order()).toEqual(["a", "b", "c"]);
    expect(cached().find((t) => t.id === "c")?.scheduled_date).toBeNull();
  });
});

/**
 * A shopping list's order, after a drag.
 *
 * A new item gets the last key in the user's order (`task_place_new`), so it
 * goes to the bottom of its aisle, where people look for it. A drag writes one
 * item, so it cannot push a later item anywhere else. This used to need the
 * dragged run ranked below zero (`aheadOfNew`), because items were created
 * with 0 and a drag stamped 1000 and up.
 */
describe("a shopping list", () => {
  const listKey = listKeys.itemsFor("groceries");
  const listOrder = () =>
    (queryClient.getQueryData<Task[]>(listKey) ?? []).map((t) => t.id);

  it("moves only the dragged item, and an item still being added stays last", async () => {
    const stillAdding = {
      id: "pending:1",
      title: "eggs",
      status: "inbox",
      sort_order: Number.MAX_SAFE_INTEGER,
    } as unknown as Task;
    queryClient.setQueryData(listKey, [...rowsFor(["a", "b", "c"]), stillAdding]);

    await reorderTasks("c", ["c", "a", "b"]);

    expect(place.mock.calls).toEqual([["c", { after: null, before: "a" }]]);
    expect(listOrder()).toEqual(["c", "a", "b", "pending:1"]);
  });
});
