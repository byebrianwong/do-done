/**
 * The editor's autosave writes the saved row into the cache instead of
 * refetching every list (`patchSavedTask`), and seeds its subtask list from
 * rows already cached (`cachedSubtasks`). Both have to walk every root that
 * holds a `Task[]` and leave the single-task detail cache in one piece.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { Task } from "@do-done/shared";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity } },
});
vi.mock("./query-client", () => ({ queryClient }));
vi.mock("./supabase", () => ({
  getTasksApi: async () => ({}),
  getProjectsApi: async () => ({}),
}));
vi.mock("./widgets", () => ({ refreshTaskWidgets: vi.fn() }));
vi.mock("./location-queries", () => ({ scheduleGeofenceSync: vi.fn() }));
vi.mock("./task-reminders", () => ({ scheduleTaskReminderSync: vi.fn() }));
vi.mock("./wear", () => ({ scheduleWatchSync: vi.fn() }));

const { taskKeys, listKeys, patchSavedTask, cachedSubtasks, cachedTask } =
  await import("./task-queries");
const { scheduleTaskReminderSync } = await import("./task-reminders");
const { refreshTaskWidgets } = await import("./widgets");
const { scheduleWatchSync } = await import("./wear");
const { scheduleGeofenceSync } = await import("./location-queries");

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    status: "not_started",
    sort_order: 1000,
    parent_task_id: null,
    ...over,
  } as unknown as Task;
}

beforeEach(() => {
  queryClient.clear();
});

describe("patchSavedTask", () => {
  it("writes the saved row into every list that holds it, and no others", () => {
    queryClient.setQueryData(taskKeys.today(), [task("a"), task("b")]);
    queryClient.setQueryData(taskKeys.everything(), [task("a")]);
    queryClient.setQueryData(listKeys.itemsFor("l1"), [task("c")]);
    const todayBefore = queryClient.getQueryData<Task[]>(taskKeys.today());
    const itemsBefore = queryClient.getQueryData<Task[]>(listKeys.itemsFor("l1"));

    patchSavedTask(task("a", { title: "renamed" }));

    const today = queryClient.getQueryData<Task[]>(taskKeys.today())!;
    expect(today.map((t) => t.title)).toEqual(["renamed", "b"]);
    expect(today).not.toBe(todayBefore);
    expect(
      queryClient.getQueryData<Task[]>(taskKeys.everything())![0].title
    ).toBe("renamed");
    // A list without the row keeps its identity, so nothing re-renders for it.
    expect(queryClient.getQueryData(listKeys.itemsFor("l1"))).toBe(itemsBefore);
  });

  it("keeps fields the editor's copy does not carry", () => {
    queryClient.setQueryData(taskKeys.today(), [
      task("a", { project_name: "Work" } as Partial<Task>),
    ]);
    patchSavedTask(task("a", { title: "new" }));
    const row = queryClient.getQueryData<Task[]>(taskKeys.today())![0] as Task & {
      project_name?: string;
    };
    expect(row.title).toBe("new");
    expect(row.project_name).toBe("Work");
  });

  it("patches the single-task detail cache without treating it as a list", () => {
    queryClient.setQueryData(taskKeys.detail("p"), task("p"));
    queryClient.setQueryData(taskKeys.today(), [task("x")]);
    expect(() => patchSavedTask(task("p", { title: "Parent v2" }))).not.toThrow();
    expect(queryClient.getQueryData<Task>(taskKeys.detail("p"))!.title).toBe(
      "Parent v2"
    );
  });

  it("does not touch a list that does not hold the row", () => {
    queryClient.setQueryData(taskKeys.today(), [task("a")]);
    queryClient.setQueryData(taskKeys.inbox(), [task("other")]);
    const before = queryClient.getQueryState(taskKeys.inbox())!.dataUpdatedAt;
    vi.useFakeTimers();
    vi.setSystemTime(before + 5000);
    patchSavedTask(task("a", { title: "x" }));
    vi.useRealTimers();
    expect(queryClient.getQueryState(taskKeys.inbox())!.dataUpdatedAt).toBe(
      before
    );
  });

  it("still re-arms reminders and refreshes the widgets, watch and geofences", () => {
    vi.mocked(scheduleTaskReminderSync).mockClear();
    vi.mocked(refreshTaskWidgets).mockClear();
    vi.mocked(scheduleWatchSync).mockClear();
    vi.mocked(scheduleGeofenceSync).mockClear();
    patchSavedTask(task("a", { scheduled_time: "15:00" } as Partial<Task>));
    expect(scheduleTaskReminderSync).toHaveBeenCalledTimes(1);
    expect(refreshTaskWidgets).toHaveBeenCalledTimes(1);
    expect(scheduleWatchSync).toHaveBeenCalledTimes(1);
    expect(scheduleGeofenceSync).toHaveBeenCalledTimes(1);
  });

  it("does not create a detail cache that was never there", () => {
    patchSavedTask(task("z"));
    expect(queryClient.getQueryData(taskKeys.detail("z"))).toBeUndefined();
  });
});

describe("cachedSubtasks", () => {
  it("collects a parent's children across lists, once each, in sort order", () => {
    queryClient.setQueryData(taskKeys.today(), [
      task("s2", { parent_task_id: "p", sort_order: 2000 }),
      task("other"),
    ]);
    queryClient.setQueryData(taskKeys.everything(), [
      task("s1", { parent_task_id: "p", sort_order: 1000 }),
      task("s2", { parent_task_id: "p", sort_order: 2000 }),
      task("s3", { parent_task_id: "q" }),
    ]);
    queryClient.setQueryData(taskKeys.detail("p"), task("p"));
    expect(cachedSubtasks("p").map((t) => t.id)).toEqual(["s1", "s2"]);
  });

  it("is empty when nothing is cached", () => {
    expect(cachedSubtasks("p")).toEqual([]);
  });
});

describe("cachedTask", () => {
  it("finds a row in any list root, and null otherwise", () => {
    queryClient.setQueryData(listKeys.itemsFor("l1"), [task("item")]);
    queryClient.setQueryData(taskKeys.detail("d"), task("d"));
    expect(cachedTask("item")?.id).toBe("item");
    expect(cachedTask("d")).toBeNull();
  });
});
