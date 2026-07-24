import { describe, it, expect, vi } from "vitest";
import type { Task } from "@do-done/shared";
import { addDaysLocalISO, todayLocalISO } from "@do-done/shared";
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
    expect(filter).toContain(`when_date.gte.${addDaysLocalISO(-1)}`);
    expect(filter).toContain(`due_date.gte.${addDaysLocalISO(-1)}`);
    // Guard against a regression back to a strict same-day lower bound.
    expect(filter).not.toContain(`when_date.gte.${todayLocalISO()}`);

    // Upper bound stays at today + days.
    expect(filter).toContain(`when_date.lte.${addDaysLocalISO(30)}`);
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
    when_date: null,
    when_time: null,
    due_date: null,
    due_time: null,
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
