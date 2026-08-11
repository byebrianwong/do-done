/**
 * Sequencing tests for `toggleComplete`'s completion hold.
 *
 * The row's collapse animation is a device concern — you can see whether it
 * looks right in two seconds on a real build. What you *can't* see is the order
 * these four things happen in, and getting it wrong is silent: the write must go
 * out immediately (so a backgrounded app never loses a completion), the row must
 * stay in the list for the length of the animation, the invalidate must not land
 * during it (a refetch would report the task done and pull the row out from
 * under itself), and a failed write must leave the list untouched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { Task } from "@do-done/shared";

// A real QueryClient — the cache behaviour under test is TanStack's, not ours.
// The module it normally lives in imports react-native and expo-router.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity } },
});
vi.mock("./query-client", () => ({ queryClient }));

const complete = vi.fn();
const reopen = vi.fn();
const remove = vi.fn();
const restore = vi.fn();
vi.mock("./supabase", () => ({
  getTasksApi: async () => ({ complete, reopen, delete: remove, restore }),
  getProjectsApi: async () => ({}),
}));

// Native seams `invalidateTasks` fans out to; irrelevant here, absent in node.
const refreshTaskWidgets = vi.fn();
const scheduleGeofenceSync = vi.fn();
vi.mock("./widgets", () => ({ refreshTaskWidgets }));
vi.mock("./location-queries", () => ({ scheduleGeofenceSync }));

const { taskKeys, toggleComplete, deleteTask, restoreTasks } = await import(
  "./task-queries"
);

/**
 * A fresh id per test. Completion writes are serialized per task id, so a test
 * that deliberately leaves one in flight would otherwise queue the *next*
 * test's write behind a promise that never settles.
 */
let idCounter = 0;
let TASK_ID = "";
const HOLD = 500;

function seedList(...ids: string[]) {
  queryClient.setQueryData(
    taskKeys.today(),
    ids.map((id) => ({ id, title: id, status: "not_started" }) as Task)
  );
}
const listIds = () =>
  (queryClient.getQueryData<Task[]>(taskKeys.today()) ?? []).map((t) => t.id);

/** A write we can leave in flight for as long as the test needs. */
function deferredWrite() {
  let settle!: (v: { data: null; ids: string[]; error: Error | null }) => void;
  const promise = new Promise<{
    data: null;
    ids: string[];
    error: Error | null;
  }>((res) => {
    settle = res;
  });
  return {
    promise,
    ok: (ids: string[] = []) => settle({ data: null, ids, error: null }),
    fail: () => settle({ data: null, ids: [], error: new Error("offline") }),
  };
}

let invalidateSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  TASK_ID = `11111111-1111-1111-1111-${String(++idCounter).padStart(12, "0")}`;
  queryClient.clear();
  complete.mockReset();
  reopen.mockReset();
  remove.mockReset();
  restore.mockReset();
  invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
});
afterEach(() => {
  vi.useRealTimers();
  invalidateSpy.mockRestore();
});

describe("toggleComplete — completion hold", () => {
  it("writes immediately, before the hold has run", async () => {
    seedList(TASK_ID, "other");
    const write = deferredWrite();
    complete.mockReturnValue(write.promise);

    void toggleComplete(TASK_ID, true, { holdMs: HOLD });
    // Let the cancelQueries/getTasksApi awaits settle, but advance no timers.
    await vi.advanceTimersByTimeAsync(0);

    // This is the guarantee that makes the animation safe to add at all: kill
    // the app here and the completion is already on its way to the server.
    expect(complete).toHaveBeenCalledWith(TASK_ID);
  });

  it("keeps the row in the list for the whole hold", async () => {
    seedList(TASK_ID, "other");
    const write = deferredWrite();
    complete.mockReturnValue(write.promise);

    void toggleComplete(TASK_ID, true, { holdMs: HOLD });
    await vi.advanceTimersByTimeAsync(0);
    write.ok();
    await vi.advanceTimersByTimeAsync(0);

    // The write has landed but the row must stay — it's mid-animation.
    expect(listIds()).toEqual([TASK_ID, "other"]);

    await vi.advanceTimersByTimeAsync(HOLD - 1);
    expect(listIds()).toEqual([TASK_ID, "other"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(listIds()).toEqual(["other"]);
  });

  it("does not invalidate until the row is gone", async () => {
    seedList(TASK_ID);
    const write = deferredWrite();
    complete.mockReturnValue(write.promise);

    void toggleComplete(TASK_ID, true, { holdMs: HOLD });
    await vi.advanceTimersByTimeAsync(0);
    write.ok();
    await vi.advanceTimersByTimeAsync(HOLD - 1);

    // A refetch landing here would report the task done and drop the row
    // mid-collapse — the animation would visibly jump.
    expect(invalidateSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("counts a slow write against the hold instead of adding to it", async () => {
    seedList(TASK_ID);
    const write = deferredWrite();
    complete.mockReturnValue(write.promise);

    void toggleComplete(TASK_ID, true, { holdMs: HOLD });
    await vi.advanceTimersByTimeAsync(0);

    // The request itself takes longer than the hold: the row has already been
    // sitting there completed for all of it, so it should go at once rather
    // than serve a second sentence.
    await vi.advanceTimersByTimeAsync(HOLD + 200);
    write.ok();
    await vi.advanceTimersByTimeAsync(0);

    expect(listIds()).toEqual([]);
  });

  it("leaves the list untouched when the write fails", async () => {
    seedList(TASK_ID, "other");
    const write = deferredWrite();
    complete.mockReturnValue(write.promise);

    const call = toggleComplete(TASK_ID, true, { holdMs: HOLD });
    await vi.advanceTimersByTimeAsync(0);
    write.fail();

    await expect(call).rejects.toThrow("offline");
    await vi.advanceTimersByTimeAsync(HOLD * 4);

    // The row never left, so there is nothing to restore — and crucially no
    // late timer arrives to drop it after the caller has already put it back.
    expect(listIds()).toEqual([TASK_ID, "other"]);
  });

  it("without a hold, drops the row before the write even starts", async () => {
    seedList(TASK_ID, "other");
    const write = deferredWrite();
    complete.mockReturnValue(write.promise);

    void toggleComplete(TASK_ID, true);
    await vi.advanceTimersByTimeAsync(0);

    // The pre-animation behaviour, still what reduce-motion gets.
    expect(listIds()).toEqual(["other"]);
    write.ok();
  });

  it("restores the row when a hold-free write fails", async () => {
    seedList(TASK_ID, "other");
    const write = deferredWrite();
    complete.mockReturnValue(write.promise);

    const call = toggleComplete(TASK_ID, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(listIds()).toEqual(["other"]);

    write.fail();
    await expect(call).rejects.toThrow("offline");
    expect(listIds()).toEqual([TASK_ID, "other"]);
  });

  it("holds a reopen out of the completed list the same way", async () => {
    queryClient.setQueryData(taskKeys.completed(), [
      { id: TASK_ID, title: "done thing", status: "done" } as Task,
    ]);
    const write = deferredWrite();
    reopen.mockReturnValue(write.promise);

    void toggleComplete(TASK_ID, false, { holdMs: HOLD });
    await vi.advanceTimersByTimeAsync(0);
    write.ok();
    await vi.advanceTimersByTimeAsync(HOLD - 1);

    const completedIds = () =>
      (queryClient.getQueryData<Task[]>(taskKeys.completed()) ?? []).map(
        (t) => t.id
      );
    expect(completedIds()).toEqual([TASK_ID]);

    await vi.advanceTimersByTimeAsync(1);
    expect(completedIds()).toEqual([]);
    expect(reopen).toHaveBeenCalledWith(TASK_ID, undefined);
  });
});

/**
 * Undo is a second write to the same row issued while the first is still in the
 * air — the toast is up and the row is still being held for its animation.
 * Fired concurrently, the two UPDATEs race, and the row keeps whichever reached
 * the server second: tap Undo fast enough and the task stays completed while
 * the button appears to have done nothing.
 */
describe("toggleComplete — undo while the completion is in flight", () => {
  it("holds the reopen until the completion has answered", async () => {
    seedList(TASK_ID, "other");
    const completeWrite = deferredWrite();
    const reopenWrite = deferredWrite();
    complete.mockReturnValue(completeWrite.promise);
    reopen.mockReturnValue(reopenWrite.promise);

    void toggleComplete(TASK_ID, true, { holdMs: HOLD });
    await vi.advanceTimersByTimeAsync(0);
    expect(complete).toHaveBeenCalledTimes(1);

    // The toast is up; the user taps Undo before the completion has landed.
    void toggleComplete(TASK_ID, false);
    await vi.advanceTimersByTimeAsync(0);
    expect(reopen).not.toHaveBeenCalled();

    completeWrite.ok();
    await vi.advanceTimersByTimeAsync(0);
    expect(reopen).toHaveBeenCalledWith(TASK_ID, undefined);
  });

  // Undo means "put it back", so the row's status before the tap travels with
  // the reopen. Without it the write is a plain `not_started` and a task
  // checked off from In progress comes back demoted.
  it("carries the pre-completion status through to the reopen", async () => {
    seedList(TASK_ID, "other");
    complete.mockResolvedValue({ data: null, error: null });
    reopen.mockResolvedValue({ data: null, error: null });

    void toggleComplete(TASK_ID, true, { holdMs: HOLD });
    await vi.advanceTimersByTimeAsync(0);
    void toggleComplete(TASK_ID, false, { restoreStatus: "in_progress" });
    await vi.advanceTimersByTimeAsync(HOLD * 2);

    expect(reopen).toHaveBeenCalledWith(TASK_ID, "in_progress");
  });

  it("leaves the row in its list when the undo lands first", async () => {
    seedList(TASK_ID, "other");
    const completeWrite = deferredWrite();
    complete.mockReturnValue(completeWrite.promise);
    reopen.mockResolvedValue({ data: null, error: null });

    void toggleComplete(TASK_ID, true, { holdMs: HOLD });
    await vi.advanceTimersByTimeAsync(0);
    void toggleComplete(TASK_ID, false);
    completeWrite.ok();

    // Well past the hold: the superseded completion must not serve out its
    // timer and drop the row the undo just kept.
    await vi.advanceTimersByTimeAsync(HOLD * 4);
    expect(listIds()).toEqual([TASK_ID, "other"]);
  });

  it("still completes normally when nothing supersedes it", async () => {
    seedList(TASK_ID, "other");
    complete.mockResolvedValue({ data: null, error: null });

    void toggleComplete(TASK_ID, true, { holdMs: HOLD });
    await vi.advanceTimersByTimeAsync(HOLD);

    expect(listIds()).toEqual(["other"]);
  });
});

/**
 * The same four guarantees, for the deletion exit.
 *
 * Deleting had none of this: the optimistic patch dropped the row on the tick
 * of the tap, so there was no window for a row to animate in even if one had
 * wanted to. `holdMs` is what opens it, and — exactly as with the completion —
 * the ordering is the part a device can't show you.
 */
describe("deleteTask — the exit hold", () => {
  it("writes immediately, before the hold has run", async () => {
    seedList(TASK_ID, "other");
    const write = deferredWrite();
    remove.mockReturnValue(write.promise);

    void deleteTask(TASK_ID, { holdMs: HOLD }).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);

    // Kill the app here and the delete is already on its way to the server.
    expect(remove).toHaveBeenCalledWith(TASK_ID);
  });

  it("keeps the row in the list for the whole hold", async () => {
    seedList(TASK_ID, "other");
    const write = deferredWrite();
    remove.mockReturnValue(write.promise);

    void deleteTask(TASK_ID, { holdMs: HOLD }).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    write.ok();
    await vi.advanceTimersByTimeAsync(0);

    // The write has landed but the row must stay — it's mid-animation, and
    // dropping it here is precisely the vanishing this exists to stop.
    expect(listIds()).toEqual([TASK_ID, "other"]);

    await vi.advanceTimersByTimeAsync(HOLD - 1);
    expect(listIds()).toEqual([TASK_ID, "other"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(listIds()).toEqual(["other"]);
  });

  it("does not invalidate until the row is gone", async () => {
    seedList(TASK_ID);
    const write = deferredWrite();
    remove.mockReturnValue(write.promise);

    void deleteTask(TASK_ID, { holdMs: HOLD }).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    write.ok();
    await vi.advanceTimersByTimeAsync(HOLD - 1);

    // A refetch landing here would report the task as still present and pull
    // the row back out from under its own exit.
    expect(invalidateSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("leaves the list untouched when the write fails", async () => {
    seedList(TASK_ID, "other");
    const write = deferredWrite();
    remove.mockReturnValue(write.promise);

    const call = deleteTask(TASK_ID, { holdMs: HOLD });
    await vi.advanceTimersByTimeAsync(0);
    write.fail();
    await expect(call).rejects.toThrow();

    // The row never left, so there is nothing to put back — and the caller
    // un-collapses it on the same rejection.
    await vi.advanceTimersByTimeAsync(HOLD * 2);
    expect(listIds()).toEqual([TASK_ID, "other"]);
  });

  it("drops the row on the spot with no hold asked for", async () => {
    // The old behaviour, and still the right one for a caller with no row on
    // screen to animate.
    seedList(TASK_ID, "other");
    remove.mockResolvedValue({ data: null, error: null });

    void deleteTask(TASK_ID);
    await vi.advanceTimersByTimeAsync(0);
    expect(listIds()).toEqual(["other"]);
  });
});

/**
 * Undo after a delete.
 *
 * The point of the soft delete is that the *server* still holds the task, so
 * there is nothing in the cache to put back optimistically and the invalidate
 * is what makes the rows reappear — with their subtasks and files, which no
 * client-side snapshot ever had.
 */
describe("deleteTask → restoreTasks", () => {
  it("hands back the ids the delete actually touched", async () => {
    // Including the subtree. A parent's subtasks are rows the list never showed
    // and the caller has no idea exist, so the ids have to come from the write.
    seedList(TASK_ID);
    const write = deferredWrite();
    remove.mockReturnValue(write.promise);

    const call = deleteTask(TASK_ID);
    await vi.advanceTimersByTimeAsync(0);
    write.ok([TASK_ID, "child-1"]);

    expect(await call).toEqual([TASK_ID, "child-1"]);
  });

  it("restores by id and refetches", async () => {
    restore.mockResolvedValue({ error: null });

    await restoreTasks(["task-1", "child-1"]);

    expect(restore).toHaveBeenCalledWith(["task-1", "child-1"]);
    // No optimistic patch to make: the cache dropped these rows and has no copy
    // of them. The refetch is what brings the real ones back.
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("refetches even when the restore fails", async () => {
    // The list must not be left disagreeing with the server about a row the
    // user just tried to recover.
    restore.mockResolvedValue({ error: new Error("offline") });

    await expect(restoreTasks(["task-1"])).rejects.toThrow();
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("does nothing for an empty list", async () => {
    await restoreTasks([]);
    expect(restore).not.toHaveBeenCalled();
  });
});
