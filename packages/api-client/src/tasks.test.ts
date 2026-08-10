import { describe, it, expect, vi } from "vitest";
import type { Task } from "@do-done/shared";
import {
  addDaysLocalISO,
  parseStatusSyncSettings,
  resolveStatusSyncHorizon,
  todayISOInZone,
  todayLocalISO,
} from "@do-done/shared";
import { TasksApi } from "./tasks.js";

// Pet feeding is a best-effort side-effect of create/update; stub it out so the
// tests exercise only the task write path (and don't reach into pet tables).
vi.mock("./pets.js", () => ({
  PetsApi: class {
    async feedFromTask() {}
    async feedFromTaskCreate() {}
    async feedFromTaskEdit() {}
  },
}));

/**
 * Minimal chainable, awaitable stub of the Supabase query builder. Every
 * builder method returns `this` (so the call chain works) and records the
 * arguments it was given; awaiting the builder resolves to `{ data, error }`.
 */
function makeSupabaseStub() {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  const chain = (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  for (const m of ["from", "select", "not", "or", "order", "eq", "is", "gte", "lte"]) {
    builder[m] = chain(m);
  }
  // Thenable: `await query` yields an empty success result.
  builder.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data: [], error: null });
  return { supabase: builder, calls };
}

describe("TasksApi.getUpcoming", () => {
  it("lower-bounds the date window at today − 1 to absorb server/client TZ skew", async () => {
    const { supabase, calls } = makeSupabaseStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any);

    await api.getUpcoming(30);

    const orCall = calls.find((c) => c.method === "or");
    expect(orCall).toBeDefined();
    const filter = orCall!.args[0] as string;

    // The window must START a day before *server* today: getUpcoming runs
    // server-side (UTC on a deployed host) but the Upcoming view buckets on
    // the client in local time. A strict `>= today` dropped the user's
    // local-today tasks when the server had already rolled to tomorrow.
    expect(filter).toContain(`scheduled_date.gte.${addDaysLocalISO(-1)}`);
    expect(filter).toContain(`deadline_date.gte.${addDaysLocalISO(-1)}`);
    // Guard against a regression back to a strict same-day lower bound.
    expect(filter).not.toContain(`scheduled_date.gte.${todayLocalISO()}`);

    // Upper bound stays at today + days.
    expect(filter).toContain(`scheduled_date.lte.${addDaysLocalISO(30)}`);
  });
});

// ── create: subtask project inheritance ────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    user_id: "00000000-0000-0000-0000-000000000099",
    title: "Parent",
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
    sort_order: 0,
    focus_override: null,
    created_at: "2026-05-11T00:00:00.000Z",
    updated_at: "2026-05-11T00:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

/**
 * A per-`from()` query-builder stand-in for the create path. `getById` reads
 * through `.select().eq().single()` (returns `parent` for the tasks table);
 * `create` writes through `.insert().select().single()` (echoes the inserted
 * row back). Every insert row is captured in `inserts` so tests can assert
 * what was persisted.
 */
function makeCreateStub(parent: Task | null) {
  const inserts: Record<string, unknown>[] = [];
  const supabase = {
    from(table: string) {
      const state: {
        op: "select" | "insert";
        insertRow: Record<string, unknown> | null;
      } = { op: "select", insertRow: null };
      const proxy: unknown = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "insert") {
              return (row: Record<string, unknown>) => {
                state.op = "insert";
                state.insertRow = row;
                inserts.push(row);
                return proxy;
              };
            }
            if (prop === "single" || prop === "maybeSingle") {
              return () =>
                Promise.resolve(
                  state.op === "insert"
                    ? {
                        data: { id: "new-task-id", ...state.insertRow },
                        error: null,
                      }
                    : { data: table === "tasks" ? parent : null, error: null }
                );
            }
            // Every other builder method (select, eq, order, …) chains.
            return () => proxy;
          },
        }
      );
      return proxy;
    },
  };
  return { supabase, inserts };
}

describe("TasksApi.create — subtask project inheritance", () => {
  it("inherits the parent's project when the subtask names none", async () => {
    const { supabase, inserts } = makeCreateStub(
      makeTask({ id: "parent-1", project_id: "proj-9" })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    const { data } = await api.create({
      title: "Subtask",
      parent_task_id: "parent-1",
    });

    expect(inserts[0].project_id).toBe("proj-9");
    expect(data?.project_id).toBe("proj-9");
  });

  it("keeps an explicitly chosen project over the parent's", async () => {
    const { supabase, inserts } = makeCreateStub(
      makeTask({ id: "parent-1", project_id: "proj-9" })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await api.create({
      title: "Subtask",
      parent_task_id: "parent-1",
      project_id: "proj-1",
    });

    expect(inserts[0].project_id).toBe("proj-1");
  });

  it("leaves the subtask project-less when the parent has no project", async () => {
    const { supabase, inserts } = makeCreateStub(
      makeTask({ id: "parent-1", project_id: null })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await api.create({ title: "Subtask", parent_task_id: "parent-1" });

    expect(inserts[0].project_id).toBeUndefined();
  });

  it("doesn't touch project for a top-level task (no parent)", async () => {
    const { supabase, inserts } = makeCreateStub(
      makeTask({ id: "parent-1", project_id: "proj-9" })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await api.create({ title: "Top-level task" });

    expect(inserts[0].project_id).toBeUndefined();
  });
});

// ── bulkUpdate: partial failure + bounded fan-out ──────────────────────

/**
 * A stub for the `update()` round-trip pair (prior read, then write). Ids in
 * `failTimes` fail that many attempts before succeeding (`Infinity` = always);
 * ids in `throwIds` reject instead of returning an error tuple. Records every
 * persisted patch, per-id attempt counts, and the peak number of writes in
 * flight at once.
 */
function makeBulkStub(
  opts: { failTimes?: Map<string, number>; throwIds?: Set<string> } = {}
) {
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const attempts = new Map<string, number>();
  let inFlight = 0;
  let peak = 0;

  const supabase = {
    from(_table: string) {
      const state = {
        op: "select" as "select" | "update",
        patch: null as Record<string, unknown> | null,
        id: "",
      };
      const proxy: unknown = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "update") {
              return (patch: Record<string, unknown>) => {
                state.op = "update";
                state.patch = patch;
                return proxy;
              };
            }
            if (prop === "eq") {
              return (_col: string, val: unknown) => {
                state.id = String(val);
                return proxy;
              };
            }
            if (prop === "single" || prop === "maybeSingle") {
              return async () => {
                if (state.op !== "update") {
                  return { data: makeTask({ id: state.id }), error: null };
                }
                const n = (attempts.get(state.id) ?? 0) + 1;
                attempts.set(state.id, n);
                inFlight++;
                peak = Math.max(peak, inFlight);
                try {
                  await new Promise((r) => setTimeout(r, 1));
                  if (n <= (opts.failTimes?.get(state.id) ?? 0)) {
                    if (opts.throwIds?.has(state.id)) throw new Error("network");
                    return { data: null, error: new Error("write failed") };
                  }
                  updates.push({ id: state.id, patch: state.patch! });
                  return {
                    data: makeTask({ id: state.id, ...state.patch }),
                    error: null,
                  };
                } finally {
                  inFlight--;
                }
              };
            }
            return () => proxy;
          },
        }
      );
      return proxy;
    },
  };
  return { supabase, updates, attempts, peak: () => peak };
}

describe("TasksApi.bulkUpdate", () => {
  const patch = { scheduled_date: "2026-06-18" };
  const batch = (ids: string[]) => ids.map((id) => ({ id, input: patch }));

  it("names the rows that failed and keeps the ones that landed", async () => {
    const { supabase, updates } = makeBulkStub({
      failTimes: new Map([["b", Infinity]]),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    const res = await api.bulkUpdate(batch(["a", "b", "c"]));

    // One bad row must not discard the two good ones — reverting a whole bulk
    // reschedule over a single failure is what made it look self-undoing.
    expect(res.failedIds).toEqual(["b"]);
    expect(res.data.map((t) => t.id)).toEqual(["a", "c"]);
    expect(res.error).toBeInstanceOf(Error);
    expect(updates.map((u) => u.id).sort()).toEqual(["a", "c"]);
  });

  it("retries a transient failure once before giving up on a row", async () => {
    const { supabase, attempts } = makeBulkStub({
      failTimes: new Map([["b", 1]]),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    const res = await api.bulkUpdate(batch(["a", "b"]));

    expect(res.failedIds).toEqual([]);
    expect(res.error).toBeNull();
    expect(attempts.get("b")).toBe(2);
    expect(attempts.get("a")).toBe(1);
  });

  it("contains a rejected write to its own row", async () => {
    const { supabase } = makeBulkStub({
      failTimes: new Map([["b", Infinity]]),
      throwIds: new Set(["b"]),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    // A thrown fetch used to reject the whole Promise.all and lose every other
    // result with it.
    const res = await api.bulkUpdate(batch(["a", "b", "c"]));

    expect(res.failedIds).toEqual(["b"]);
    expect(res.data.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("bounds how many writes are in flight at once", async () => {
    const { supabase, peak } = makeBulkStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    const ids = Array.from({ length: 40 }, (_, i) => `t${i}`);
    const res = await api.bulkUpdate(batch(ids));

    expect(res.data).toHaveLength(40);
    expect(peak()).toBeLessThanOrEqual(8);
    // Still concurrent, just capped — not serialized one-at-a-time.
    expect(peak()).toBeGreaterThan(1);
  });
});

// ── status ↔ schedule auto-sync ────────────────────────────────────────

/**
 * A stub that serves a `user_preferences` row alongside the task read/write
 * pair, so the sync rules have settings to run against. Captures the patch
 * that actually reached the tasks table — the point of these tests is that the
 * rule is folded into the *same* UPDATE, not chased with a second write.
 */
function makeSyncStub(prefs: Record<string, unknown> | null, prior: Task) {
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const bulkFilters: { method: string; args: unknown[] }[] = [];
  let prefsReads = 0;

  const supabase = {
    from(table: string) {
      const state = {
        op: "select" as "select" | "update" | "insert",
        patch: null as Record<string, unknown> | null,
        filtered: false,
      };
      const result = () => {
        if (table === "user_preferences") {
          prefsReads++;
          return { data: prefs, error: null };
        }
        if (state.op === "insert") {
          return { data: { id: "new-task-id", ...state.patch }, error: null };
        }
        if (state.op === "update") {
          return { data: { ...prior, ...state.patch }, error: null };
        }
        return { data: prior, error: null };
      };
      const proxy: unknown = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "update" || prop === "insert") {
              return (patch: Record<string, unknown>) => {
                state.op = prop as "update" | "insert";
                state.patch = patch;
                // Recorded on call, not on resolution: the bulk sweep awaits
                // the builder directly and never reaches .single().
                (prop === "insert" ? inserts : updates).push(patch);
                return proxy;
              };
            }
            if (prop === "single" || prop === "maybeSingle") {
              return async () => result();
            }
            if (prop === "then") {
              // The bulk sweep awaits the builder directly rather than calling
              // .single(); resolve it the same way.
              return (resolve: (v: unknown) => unknown) =>
                resolve({ data: [{ id: "a" }, { id: "b" }], error: null });
            }
            return (...args: unknown[]) => {
              if (table === "tasks" && state.op === "update") {
                bulkFilters.push({ method: prop, args });
              }
              return proxy;
            };
          },
        }
      );
      return proxy;
    },
  };
  return {
    supabase,
    updates,
    inserts,
    bulkFilters,
    prefsReads: () => prefsReads,
  };
}

const SYNC_ON = {
  timezone: "UTC",
  status_sync_promote: true,
  status_sync_backfill: true,
  status_sync_status: "next",
  status_sync_horizon_kind: "days",
  status_sync_horizon_days: 3,
  status_sync_horizon_key: "this_week",
};

/**
 * The horizon SYNC_ON resolves to right now. Derived the same way the code
 * derives it — through the preferences timezone, not the machine clock, which
 * is the whole point and is a day out from `todayLocalISO()` for half of each
 * day in the Americas.
 */
const horizon = () =>
  resolveStatusSyncHorizon(parseStatusSyncSettings(SYNC_ON), todayISOInZone("UTC"));

describe("TasksApi — status ↔ schedule sync", () => {
  it("dates a task in the same write that moves it to the target status", async () => {
    const { supabase, updates } = makeSyncStub(
      SYNC_ON,
      makeTask({ status: "not_started", scheduled_date: null })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await api.update("t1", { status: "next" });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      status: "next",
      scheduled_date: horizon(),
    });
  });

  it("promotes a task in the same write that gives it a near date", async () => {
    const { supabase, updates } = makeSyncStub(
      SYNC_ON,
      makeTask({ status: "not_started", scheduled_date: null })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await api.update("t1", { scheduled_date: todayLocalISO() });

    expect(updates[0]).toMatchObject({ status: "next" });
  });

  it("leaves writes alone when the feature is off", async () => {
    const { supabase, updates } = makeSyncStub(
      { timezone: "UTC" },
      makeTask({ status: "not_started", scheduled_date: null })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await api.update("t1", { status: "next" });

    expect(updates[0]).toEqual({ status: "next" });
  });

  it("survives a preferences row that predates the migration", async () => {
    const { supabase, updates } = makeSyncStub(
      null,
      makeTask({ status: "not_started", scheduled_date: null })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    const { error } = await api.update("t1", { status: "next" });

    expect(error).toBeNull();
    expect(updates[0]).toEqual({ status: "next" });
  });

  it("still stamps completed_at, and never re-dates a task on the way to done", async () => {
    const { supabase, updates } = makeSyncStub(
      SYNC_ON,
      makeTask({ status: "next", scheduled_date: null })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await api.complete("t1");

    expect(updates[0].status).toBe("done");
    expect(updates[0].completed_at).toEqual(expect.any(String));
    expect(updates[0].scheduled_date).toBeUndefined();
  });

  it("applies the rule to a newly created task too", async () => {
    const { supabase, inserts } = makeSyncStub(SYNC_ON, makeTask());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await api.create({ title: "Ship it", status: "next" });

    expect(inserts[0]).toMatchObject({ scheduled_date: horizon() });
  });

  it("reads preferences once for a burst of writes", async () => {
    const { supabase, prefsReads } = makeSyncStub(
      SYNC_ON,
      makeTask({ status: "not_started", scheduled_date: null })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await Promise.all([
      api.update("t1", { title: "a" }),
      api.update("t2", { title: "b" }),
      api.update("t3", { title: "c" }),
    ]);

    // Concurrent callers share one read; the cache covers the rest.
    expect(prefsReads()).toBe(1);
  });
});

describe("TasksApi.syncScheduledToStatus", () => {
  it("moves every near-dated task below the target in one filtered UPDATE", async () => {
    const { supabase, updates, bulkFilters } = makeSyncStub(SYNC_ON, makeTask());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    const { updated, error } = await api.syncScheduledToStatus();

    expect(error).toBeNull();
    expect(updated).toBe(2);
    expect(updates).toEqual([{ status: "next" }]);

    const lte = bulkFilters.find((c) => c.method === "lte");
    expect(lte?.args).toEqual(["scheduled_date", horizon()]);
    // Only statuses *below* the target — the sweep must never walk a task back
    // from In progress or resurrect a done one.
    const inFilter = bulkFilters.find((c) => c.method === "in");
    expect(inFilter?.args[1]).toEqual(["inbox", "later", "not_started"]);
    // Undated tasks are excluded explicitly, not just by SQL null semantics.
    const notNull = bulkFilters.find((c) => c.method === "not");
    expect(notNull?.args).toEqual(["scheduled_date", "is", null]);
  });

  it("does nothing when only the backfill half is on", async () => {
    const { supabase, updates } = makeSyncStub(
      { ...SYNC_ON, status_sync_promote: false },
      makeTask()
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    const { updated } = await api.syncScheduledToStatus();

    expect(updated).toBe(0);
    expect(updates).toEqual([]);
  });
});

/**
 * Undo has to give the task back the way it was. Reopening always wrote
 * `not_started`, so checking off something that was In progress and tapping
 * Undo silently demoted it — the row came back, at the wrong status, with
 * nothing on screen saying so.
 */
describe("TasksApi.reopen — the status a task comes back at", () => {
  const apiFor = (prior: Task) => {
    const { supabase, updates } = makeSyncStub({ timezone: "UTC" }, prior);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { api: new TasksApi(supabase as any, "user-1"), updates };
  };

  it("restores the status it was given, and clears completed_at", async () => {
    const { api, updates } = apiFor(makeTask({ status: "done" }));

    await api.reopen("t1", "in_progress");

    expect(updates[0]).toEqual({ status: "in_progress", completed_at: null });
  });

  it("falls back to not_started for a bare uncheck", async () => {
    const { api, updates } = apiFor(makeTask({ status: "done" }));

    await api.reopen("t1");

    expect(updates[0]).toEqual({ status: "not_started", completed_at: null });
  });

  it("refuses to restore done, which would leave Undo doing nothing", async () => {
    const { api, updates } = apiFor(makeTask({ status: "done" }));

    await api.reopen("t1", "done");

    expect(updates[0]).toMatchObject({ status: "not_started" });
  });
});

describe("TasksApi.update — leaving done", () => {
  it("clears completed_at when the status moves off done", async () => {
    const { supabase, updates } = makeSyncStub(
      { timezone: "UTC" },
      makeTask({ status: "done", completed_at: "2026-08-01T10:00:00.000Z" })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await api.update("t1", { status: "in_progress" });

    expect(updates[0]).toEqual({ status: "in_progress", completed_at: null });
  });

  it("leaves the stamp alone on a write that doesn't touch the status", async () => {
    const { supabase, updates } = makeSyncStub(
      { timezone: "UTC" },
      makeTask({ status: "done", completed_at: "2026-08-01T10:00:00.000Z" })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await api.update("t1", { title: "Renamed" });

    expect(updates[0]).toEqual({ title: "Renamed" });
  });
});

// ── delete / restore / purge ───────────────────────────────────────────

/**
 * A recording query-builder stub with enough shape for the soft-delete paths:
 * it captures every filter and payload, and answers reads from a fixed set of
 * rows per table.
 *
 * Deliberately dumb about *matching* — these tests are about which statements
 * the API issues and what it puts in them, which is the whole of the soft
 * delete's correctness. Whether Postgres applies `.in()` properly is not ours
 * to prove.
 */
function makeOpStub(rowsByTable: Record<string, unknown[]> = {}) {
  const ops: {
    table: string;
    op: string;
    payload?: Record<string, unknown>;
    filters: { method: string; args: unknown[] }[];
  }[] = [];
  const removedPaths: string[][] = [];

  const supabase = {
    from(table: string) {
      const entry = {
        table,
        op: "select",
        payload: undefined as Record<string, unknown> | undefined,
        filters: [] as { method: string; args: unknown[] }[],
      };
      ops.push(entry);
      const proxy: Record<string, unknown> = {};
      const chain =
        (method: string) =>
        (...args: unknown[]) => {
          if (method === "update" || method === "insert") {
            entry.op = method;
            entry.payload = args[0] as Record<string, unknown>;
          } else if (method === "delete") {
            entry.op = "delete";
          } else if (method !== "select") {
            entry.filters.push({ method, args });
          }
          return proxy;
        };
      for (const m of [
        "select", "update", "delete", "insert",
        "eq", "in", "is", "not", "lt", "lte", "gte", "or", "order", "limit",
        "range", "textSearch", "single", "maybeSingle",
      ]) {
        proxy[m] = chain(m);
      }
      proxy.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
        resolve({ data: rowsByTable[table] ?? [], error: null });
      return proxy;
    },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          removedPaths.push(paths);
          return { error: null };
        },
      }),
    },
  };
  return { supabase, ops, removedPaths };
}

const tasksOps = (ops: ReturnType<typeof makeOpStub>["ops"]) =>
  ops.filter((o) => o.table === "tasks");

describe("TasksApi.delete — the row survives", () => {
  it("stamps deleted_at instead of destroying anything", async () => {
    const { supabase, ops } = makeOpStub({ tasks: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await api.delete("task-1");

    // The single most important assertion in this file: a hard delete here is
    // what made Undo a lie. Restoring the same task is only possible while the
    // row is still there.
    const writes = tasksOps(ops).filter((o) => o.op !== "select");
    expect(writes.map((w) => w.op)).toEqual(["update"]);
    expect(writes[0].payload?.deleted_at).toEqual(expect.any(String));
    expect(tasksOps(ops).some((o) => o.op === "delete")).toBe(false);
  });

  it("leaves the attachment bytes exactly where they are", async () => {
    // The old hard delete cleared the bucket first, which is why undo could
    // never give the files back. Nothing may touch Storage until the purge.
    const { supabase, removedPaths } = makeOpStub({
      tasks: [],
      task_attachments: [{ storage_path: "u/t/a.png" }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await api.delete("task-1");

    expect(removedPaths).toEqual([]);
  });

  it("takes the whole subtree, and reports which rows it took", async () => {
    // The returned ids are the undo token — restore works off them rather than
    // re-deriving a tree that is, by then, invisible.
    const { supabase } = makeOpStub({ tasks: [{ id: "child-1" }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    const { ids } = await api.delete("task-1");

    expect(ids[0]).toBe("task-1");
    expect(ids).toContain("child-1");
  });

  it("walks the subtree over live rows only", async () => {
    // A subtask deleted separately five minutes ago must not be swept into
    // this delete — and so must not come back with the parent's undo.
    const { supabase, ops } = makeOpStub({ tasks: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await api.delete("task-1");

    const walk = tasksOps(ops).find((o) =>
      o.filters.some((f) => f.method === "in" && f.args[0] === "parent_task_id")
    );
    expect(walk?.filters).toContainEqual({
      method: "is",
      args: ["deleted_at", null],
    });
  });
});

describe("TasksApi.restore", () => {
  it("clears deleted_at on exactly the ids it was given", async () => {
    const { supabase, ops } = makeOpStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await api.restore(["task-1", "child-1"]);

    const write = tasksOps(ops).find((o) => o.op === "update");
    expect(write?.payload).toEqual({ deleted_at: null });
    expect(write?.filters).toContainEqual({
      method: "in",
      args: ["id", ["task-1", "child-1"]],
    });
  });

  it("never reads the rows it is restoring", async () => {
    // It can't: the RLS select policy hides deleted rows, so a read-then-write
    // would find nothing to write. One blind UPDATE is the point.
    const { supabase, ops } = makeOpStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await api.restore(["task-1"]);

    expect(tasksOps(ops).every((o) => o.op === "update")).toBe(true);
  });

  it("does nothing at all for an empty list", async () => {
    const { supabase, ops } = makeOpStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    const { error } = await api.restore([]);

    expect(error).toBeNull();
    expect(ops).toEqual([]);
  });
});

describe("TasksApi.purgeDeleted", () => {
  it("destroys only rows past the retention window", async () => {
    const { supabase, ops } = makeOpStub({ tasks: [{ id: "old-1" }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    const { purged } = await api.purgeDeleted(60_000);

    const find = tasksOps(ops)[0];
    const cutoff = find.filters.find((f) => f.method === "lt");
    expect(cutoff?.args[0]).toBe("deleted_at");
    expect(Date.parse(cutoff?.args[1] as string)).toBeLessThanOrEqual(
      Date.now() - 60_000
    );
    // And it is the one query in the class allowed to ask for deleted rows.
    expect(find.filters).toContainEqual({
      method: "not",
      args: ["deleted_at", "is", null],
    });
    expect(purged).toBe(1);
  });

  it("clears the bytes before the rows", async () => {
    // A row pointing at absent bytes renders as a permanently broken
    // attachment; bytes with no row are merely invisible. So a failure between
    // the two has to land on the invisible side.
    const { supabase, ops, removedPaths } = makeOpStub({
      tasks: [{ id: "old-1" }],
      task_attachments: [{ storage_path: "u/t/a.png" }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await api.purgeDeleted(60_000);

    expect(removedPaths).toEqual([["u/t/a.png"]]);
    expect(tasksOps(ops).some((o) => o.op === "delete")).toBe(true);
  });

  it("is a single read and nothing else when there is nothing to purge", async () => {
    const { supabase, ops, removedPaths } = makeOpStub({ tasks: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    const { purged } = await api.purgeDeleted();

    expect(purged).toBe(0);
    expect(removedPaths).toEqual([]);
    expect(ops).toHaveLength(1);
  });
});

describe("TasksApi — deleted rows are invisible", () => {
  it("filters every read, not just the ones someone remembered", async () => {
    // The filter lives in one private helper precisely so this holds. A read
    // that forgets it doesn't fail — it shows the user a task they deleted.
    const { supabase, ops } = makeOpStub({ tasks: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new TasksApi(supabase as any, "user-1");

    await api.list();
    await api.listTags();
    await api.getById("task-1");
    await api.listCompleted();
    await api.listSubtasks("task-1");
    await api.listUndated();
    await api.listOverdue();
    await api.search("milk");
    await api.getToday();
    await api.getUpcoming(7);
    await api.getOverdue("2026-08-10");
    await api.getDatedBetween("2026-08-01", "2026-08-31");

    for (const op of tasksOps(ops)) {
      expect(op.filters).toContainEqual({ method: "is", args: ["deleted_at", null] });
    }
  });
});
