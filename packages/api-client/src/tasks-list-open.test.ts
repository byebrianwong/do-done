import { describe, it, expect, vi } from "vitest";
import type { Task } from "@do-done/shared";
import { TasksApi } from "./tasks.js";

vi.mock("./pets.js", () => ({
  PetsApi: class {
    async feedFromTask() {}
    async feedFromTaskCreate() {}
    async feedFromTaskEdit() {}
  },
}));

type Row = Record<string, unknown>;
type Pred = (row: Row) => boolean;

/**
 * A Supabase query builder over an in-memory table that applies the filters,
 * ordering and range it is given. The other test files record calls instead;
 * this one has to evaluate them, because the bug it guards against is which
 * rows a page leaves out.
 *
 * Only the operators `list` and `listOpen` use are implemented.
 */
function makeTable(rows: Row[]) {
  const compare = (op: string, value: unknown, arg: string): boolean => {
    if (op === "eq") return String(value) === arg;
    if (value === null || value === undefined) return false;
    if (op === "lte") return String(value) <= arg;
    if (op === "gte") return String(value) >= arg;
    if (op === "lt") return String(value) < arg;
    throw new Error(`unsupported op ${op}`);
  };

  const query = () => {
    const preds: Pred[] = [];
    const orders: { col: string; asc: boolean }[] = [];
    let range: [number, number] | null = null;
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = self;
    b.eq = (col: string, v: unknown) => {
      preds.push((r) => r[col] === v);
      return b;
    };
    b.gte = (col: string, v: string) => {
      preds.push((r) => compare("gte", r[col], v));
      return b;
    };
    b.lte = (col: string, v: string) => {
      preds.push((r) => compare("lte", r[col], v));
      return b;
    };
    b.is = (col: string, v: null) => {
      preds.push((r) => (r[col] ?? null) === v);
      return b;
    };
    b.not = (col: string, op: string, list: string) => {
      if (op !== "in") throw new Error(`unsupported not.${op}`);
      const values = list.replace(/[()]/g, "").split(",");
      preds.push((r) => !values.includes(String(r[col])));
      return b;
    };
    b.or = (expr: string) => {
      const clauses = expr.split(",").map((c) => {
        const [col, op, ...rest] = c.split(".");
        return { col: col!, op: op!, arg: rest.join(".") };
      });
      preds.push((r) =>
        clauses.some((c) =>
          c.op === "not" && c.arg === "is.null"
            ? r[c.col] !== null && r[c.col] !== undefined
            : compare(c.op, r[c.col], c.arg)
        )
      );
      return b;
    };
    b.order = (col: string, opts?: { ascending?: boolean }) => {
      orders.push({ col, asc: opts?.ascending ?? true });
      return b;
    };
    b.range = (from: number, to: number) => {
      range = [from, to];
      return b;
    };
    b.then = (resolve: (v: { data: Row[]; error: null }) => unknown) => {
      let out = rows.filter((r) => preds.every((p) => p(r)));
      out = [...out].sort((x, y) => {
        for (const o of orders) {
          const a = x[o.col] as string | number;
          const c = y[o.col] as string | number;
          if (a < c) return o.asc ? -1 : 1;
          if (a > c) return o.asc ? 1 : -1;
        }
        return 0;
      });
      if (range) out = out.slice(range[0], range[1] + 1);
      return resolve({ data: out, error: null });
    };
    return b;
  };

  return { from: () => query() };
}

let seq = 0;
function task(over: Partial<Task>): Row {
  seq += 1;
  return {
    id: `t${seq}`,
    title: `Task ${seq}`,
    status: "not_started",
    priority: "p4",
    sort_order: seq,
    scheduled_date: null,
    scheduled_time: null,
    deadline_date: null,
    deadline_time: null,
    duration_minutes: null,
    focus_override: null,
    completed_at: null,
    deleted_at: null,
    is_list_item: false,
    tags: [],
    ...over,
  };
}

const TODAY = "2026-10-29";
const TOMORROW = "2026-10-30";

/**
 * 150 tasks, most of them finished, with today's and an overdue task filed at
 * the bottom of the sort order. This is the account the old Today read failed:
 * the first 100 rows by `sort_order` hold none of them.
 */
function longAccount(): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < 120; i++) {
    rows.push(task({ status: "done", completed_at: "2026-09-01T10:00:00Z" }));
  }
  for (let i = 0; i < 27; i++) rows.push(task({}));
  rows.push(task({ id: "today", scheduled_date: TODAY }));
  rows.push(task({ id: "overdue", deadline_date: "2026-10-20" }));
  rows.push(task({ id: "pinned", focus_override: "include" }));
  return rows;
}

describe("TasksApi.listOpen", () => {
  it("the old sort-order page misses tasks scheduled today on a long account", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(makeTable(longAccount()) as any);
    const { data } = await api.list({ limit: 100, offset: 0 });
    const ids = data.map((t) => t.id);
    expect(ids).not.toContain("today");
    expect(ids).not.toContain("overdue");
  });

  it("returns every open task dated through the given day, however it sorts", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(makeTable(longAccount()) as any);
    const { data, error } = await api.listOpen({ datedThrough: TOMORROW, limit: 10 });
    expect(error).toBeNull();
    const ids = data.map((t) => t.id);
    expect(ids).toContain("today");
    expect(ids).toContain("overdue");
    expect(ids).toContain("pinned");
  });

  it("leaves finished tasks out unless asked for recent ones", async () => {
    const rows = [
      ...longAccount(),
      task({ id: "doneToday", status: "done", completed_at: "2026-10-29T08:00:00Z" }),
      task({ id: "cancelled", status: "cancelled", scheduled_date: TODAY }),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(makeTable(rows) as any);

    const plain = await api.listOpen({ datedThrough: TOMORROW });
    expect(plain.data.every((t) => t.status !== "done" && t.status !== "cancelled")).toBe(
      true
    );

    const withDone = await api.listOpen({
      datedThrough: TOMORROW,
      completedSince: "2026-10-29T00:00:00Z",
    });
    const ids = withDone.data.map((t) => t.id);
    expect(ids).toContain("doneToday");
    expect(ids).not.toContain("cancelled");
    // Finished before the cutoff stays out.
    expect(withDone.data.filter((t) => t.status === "done")).toHaveLength(1);
  });

  it("fills the undated slots highest priority first, for Focus", async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 20; i++) rows.push(task({}));
    rows.push(task({ id: "urgent", priority: "p1" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(makeTable(rows) as any);
    const { data } = await api.listOpen({ datedThrough: TOMORROW, limit: 5 });
    expect(data.map((t) => t.id)).toContain("urgent");
    expect(data).toHaveLength(5);
  });

  it("reads every task with a Focus bonus, however low its priority", async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 20; i++) rows.push(task({ priority: "p1" }));
    rows.push(task({ id: "started", status: "in_progress" }));
    rows.push(task({ id: "quick", duration_minutes: 10 }));
    rows.push(task({ id: "timed", deadline_time: "15:00" }));
    rows.push(task({ id: "plain" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(makeTable(rows) as any);
    const { data } = await api.listOpen({ datedThrough: TOMORROW, limit: 5 });
    const ids = data.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["started", "quick", "timed"]));
    expect(ids).not.toContain("plain");
  });

  it("reads every inbox task only when asked", async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 20; i++) rows.push(task({ priority: "p1" }));
    rows.push(task({ id: "untriaged", status: "inbox" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(makeTable(rows) as any);
    const without = await api.listOpen({ datedThrough: TOMORROW, limit: 5 });
    expect(without.data.map((t) => t.id)).not.toContain("untriaged");
    const withInbox = await api.listOpen({ datedThrough: TOMORROW, limit: 5, inbox: true });
    expect(withInbox.data.map((t) => t.id)).toContain("untriaged");
  });

  it("returns each row once, in sort order", async () => {
    const rows = [
      task({ id: "b", sort_order: 2, scheduled_date: TODAY, priority: "p1" }),
      task({ id: "a", sort_order: 1, scheduled_date: TODAY }),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(makeTable(rows) as any);
    const { data } = await api.listOpen({ datedThrough: TOMORROW });
    expect(data.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
