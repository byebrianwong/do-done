import { describe, expect, it, vi } from "vitest";
import type { TasksApi } from "@do-done/api-client";
import type { Task, TaskFilterInput, UpdateTaskInput } from "@do-done/shared";
import { compareTaskOrder } from "@do-done/shared";
import { ORGANIZE_PAGE_SIZE, executeOrganize } from "./organize.js";

const TODAY = "2026-08-03";
const YESTERDAY = "2026-08-02";

let seq = 0;
function task(overrides: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    user_id: "00000000-0000-4000-8000-0000000000ff",
    title: `Task ${seq}`,
    description: null,
    status: "not_started",
    priority: "p3",
    project_id: null,
    scheduled_date: null,
    scheduled_time: null,
    deadline_date: null,
    deadline_time: null,
    duration_minutes: null,
    recurrence_rule: null,
    calendar_event_id: null,
    tags: [],
    parent_task_id: null,
    depth: 0,
    sort_order: seq * 1024,
    focus_override: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

/**
 * A stand-in for `TasksApi` over an array, with `list()` behaving as the real
 * one does: filtered by status and priority, in `(sort_order, id)` order, one
 * page of `limit` rows from `offset`.
 */
function fakeApi(rows: Task[]) {
  const list = vi.fn(async (filters?: TaskFilterInput) => {
    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? 50;
    const page = rows
      .filter((t) => !filters?.status || t.status === filters.status)
      .filter((t) => !filters?.priority || t.priority === filters.priority)
      .sort(compareTaskOrder)
      .slice(offset, offset + limit);
    return { data: page, error: null };
  });
  const update = vi.fn(async (id: string, input: UpdateTaskInput) => {
    void id;
    void input;
    return { data: null, error: null as Error | null };
  });
  const complete = vi.fn(async (id: string) => {
    void id;
    return { data: null, error: null as Error | null };
  });
  const api = { list, update, complete } as unknown as TasksApi;
  return { api, list, update, complete };
}

const updatedIds = (update: ReturnType<typeof fakeApi>["update"]) =>
  update.mock.calls.map(([id]) => id);

describe("organize_tasks: overdue", () => {
  it("counts a task with only a past scheduled_date as overdue", async () => {
    const planned = task({ title: "Planned yesterday", scheduled_date: YESTERDAY });
    const { api, update } = fakeApi([planned]);

    const outcome = await executeOrganize(api, "set all overdue to p1", TODAY);

    expect(outcome.ok && outcome.result.matched).toBe(1);
    expect(update).toHaveBeenCalledWith(planned.id, { priority: "p1" });
  });

  it("still counts a past deadline_date", async () => {
    const late = task({ deadline_date: YESTERDAY });
    const { api, update } = fakeApi([late]);

    await executeOrganize(api, "set all overdue to p1", TODAY);

    expect(updatedIds(update)).toEqual([late.id]);
  });

  it("does not count a done task with a past date", async () => {
    const finished = task({
      status: "done",
      scheduled_date: YESTERDAY,
      deadline_date: YESTERDAY,
      completed_at: "2026-08-02T10:00:00.000Z",
    });
    const cancelled = task({ status: "cancelled", scheduled_date: YESTERDAY });
    const { api, update } = fakeApi([finished, cancelled]);

    const outcome = await executeOrganize(api, "set all overdue to p1", TODAY);

    expect(outcome.ok && outcome.result.matched).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it("judges against the user's day it is given, not the process clock", async () => {
    // Scheduled for the user's today: not overdue, whatever day it is in UTC.
    const today = task({ scheduled_date: TODAY });
    const yesterday = task({ scheduled_date: YESTERDAY });
    const { api, update } = fakeApi([today, yesterday]);

    await executeOrganize(api, "set all overdue to p1", TODAY);

    expect(updatedIds(update)).toEqual([yesterday.id]);
  });
});

describe("organize_tasks: reading every row", () => {
  it("applies a match beyond the first 100 rows", async () => {
    const filler = Array.from({ length: 150 }, () => task({ scheduled_date: TODAY }));
    const deep = task({ title: "Row 151", scheduled_date: YESTERDAY });
    const { api, update } = fakeApi([...filler, deep]);

    const outcome = await executeOrganize(api, "set all overdue to p1", TODAY);

    expect(outcome.ok && outcome.result.applied).toBe(1);
    expect(updatedIds(update)).toEqual([deep.id]);
  });

  it("pages past a full page, for a filter on done tasks too", async () => {
    const old = { completed_at: "2026-01-01T00:00:00.000Z" };
    const done = Array.from({ length: ORGANIZE_PAGE_SIZE + 20 }, () =>
      task({ status: "done", ...old })
    );
    const { api, update, list } = fakeApi(done);

    const outcome = await executeOrganize(
      api,
      "archive done tasks older than 30 days",
      TODAY
    );

    expect(outcome.ok && outcome.result.applied).toBe(done.length);
    expect(new Set(updatedIds(update)).size).toBe(done.length);
    // Done is filtered by the database, so no open status is read.
    expect(new Set(list.mock.calls.map(([f]) => f?.status))).toEqual(
      new Set(["done"])
    );
  });

  it("reads everything before writing anything", async () => {
    const rows = Array.from({ length: ORGANIZE_PAGE_SIZE + 1 }, () =>
      task({ priority: "p4" })
    );
    const { api, list, complete } = fakeApi(rows);

    await executeOrganize(api, "complete all p4 tasks", TODAY);

    const lastRead = Math.max(...list.mock.invocationCallOrder);
    const firstWrite = Math.min(...complete.mock.invocationCallOrder);
    expect(lastRead).toBeLessThan(firstWrite);
    expect(complete).toHaveBeenCalledTimes(rows.length);
  });
});

describe("organize_tasks: no status word", () => {
  it("matches open tasks only", async () => {
    const open = task({ priority: "p4", status: "next" });
    const done = task({ priority: "p4", status: "done" });
    const cancelled = task({ priority: "p4", status: "cancelled" });
    const { api, complete } = fakeApi([open, done, cancelled]);

    const outcome = await executeOrganize(api, "complete all p4 tasks", TODAY);

    expect(outcome.ok && outcome.result.matched).toBe(1);
    expect(complete.mock.calls.map(([id]) => id)).toEqual([open.id]);
  });
});

describe("organize_tasks: failed writes", () => {
  it("reports an error the write returned rather than counting it applied", async () => {
    const a = task({ scheduled_date: YESTERDAY });
    const { api, update } = fakeApi([a]);
    update.mockResolvedValueOnce({ data: null, error: new Error("offline") });

    const outcome = await executeOrganize(api, "set all overdue to p1", TODAY);

    expect(outcome.ok && outcome.result.applied).toBe(0);
    expect(outcome.ok && outcome.result.errors).toEqual([`${a.id}: offline`]);
  });
});
