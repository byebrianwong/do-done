import { describe, it, expect } from "vitest";
import { ProjectsApi } from "./projects.js";

type Op = { m: string; args: unknown[] };
type Result = { data: unknown; error: unknown };

/**
 * Per-chain Supabase query-builder stub. Every `from()` starts a fresh chain
 * that records the methods called on it; awaiting the chain (or its `.single()`)
 * resolves whatever `resolver(ops)` returns for that chain. `chains` exposes the
 * recorded ops so tests can assert what was written.
 */
function makeSupabaseStub(resolver: (ops: Op[]) => Result) {
  const chains: Op[][] = [];
  function from(...args: unknown[]) {
    const ops: Op[] = [{ m: "from", args }];
    chains.push(ops);
    const builder: Record<string, unknown> = {};
    const rec =
      (m: string) =>
      (...a: unknown[]) => {
        ops.push({ m, args: a });
        return builder;
      };
    for (const m of [
      "select",
      "insert",
      "update",
      "delete",
      "eq",
      "order",
      "limit",
      "single",
    ]) {
      builder[m] = rec(m);
    }
    builder.then = (resolve: (v: Result) => unknown) => resolve(resolver(ops));
    return builder;
  }
  return { supabase: { from }, chains };
}

function payloadOf(ops: Op[], method: string): Record<string, unknown> {
  return ops.find((o) => o.m === method)!.args[0] as Record<string, unknown>;
}

describe("ProjectsApi.reorder", () => {
  it("stamps evenly spaced sort_order values in the given order, scoped to the user", async () => {
    const { supabase, chains } = makeSupabaseStub(() => ({
      data: null,
      error: null,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new ProjectsApi(supabase as any, "user-1");

    const { error } = await api.reorder(["id-a", "id-b", "id-c"]);
    expect(error).toBeNull();

    const updates = chains.filter((ops) => ops.some((o) => o.m === "update"));
    expect(updates).toHaveLength(3);

    // First position → 1000, second → 2000, third → 3000.
    expect(payloadOf(updates[0], "update")).toEqual({ sort_order: 1000 });
    expect(payloadOf(updates[1], "update")).toEqual({ sort_order: 2000 });
    expect(payloadOf(updates[2], "update")).toEqual({ sort_order: 3000 });

    // Each write targets its id AND is scoped to the caller's rows.
    const eqs0 = updates[0].filter((o) => o.m === "eq").map((o) => o.args);
    expect(eqs0).toContainEqual(["id", "id-a"]);
    expect(eqs0).toContainEqual(["user_id", "user-1"]);
  });

  it("returns the first write error", async () => {
    const { supabase } = makeSupabaseStub((ops) => {
      const idEq = ops.find((o) => o.m === "eq" && o.args[0] === "id");
      if (idEq && idEq.args[1] === "id-b") {
        return { data: null, error: new Error("boom") };
      }
      return { data: null, error: null };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new ProjectsApi(supabase as any, "user-1");

    const { error } = await api.reorder(["id-a", "id-b", "id-c"]);
    expect(error).toBeTruthy();
    expect((error as Error).message).toBe("boom");
  });
});

describe("ProjectsApi.create", () => {
  it("appends the new project one step past the current max sort_order", async () => {
    const { supabase, chains } = makeSupabaseStub((ops) => {
      if (ops.some((o) => o.m === "insert")) {
        return { data: { id: "new", ...payloadOf(ops, "insert") }, error: null };
      }
      // nextSortOrder() lookup — current highest is 5000.
      return { data: [{ sort_order: 5000 }], error: null };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new ProjectsApi(supabase as any, "user-1");

    const { error } = await api.create({ name: "Roadmap", color: "#6366f1" });
    expect(error).toBeNull();

    const insertChain = chains.find((ops) => ops.some((o) => o.m === "insert"))!;
    expect(payloadOf(insertChain, "insert")).toMatchObject({
      name: "Roadmap",
      sort_order: 6000,
      user_id: "user-1",
    });
  });

  it("starts at the first step when the user has no projects yet", async () => {
    const { supabase, chains } = makeSupabaseStub((ops) => {
      if (ops.some((o) => o.m === "insert")) {
        return { data: { id: "new", ...payloadOf(ops, "insert") }, error: null };
      }
      return { data: [], error: null };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new ProjectsApi(supabase as any, "user-1");

    await api.create({ name: "First", color: "#6366f1" });

    const insertChain = chains.find((ops) => ops.some((o) => o.m === "insert"))!;
    expect(payloadOf(insertChain, "insert")).toMatchObject({ sort_order: 1000 });
  });
});

describe("ProjectsApi.list", () => {
  it("orders by sort_order then created_at, scoped to the user", async () => {
    const { supabase, chains } = makeSupabaseStub(() => ({
      data: [],
      error: null,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new ProjectsApi(supabase as any, "user-1");

    await api.list();

    const orders = chains[0].filter((o) => o.m === "order").map((o) => o.args);
    expect(orders[0]).toEqual(["sort_order", { ascending: true }]);
    expect(orders[1]).toEqual(["created_at", { ascending: true }]);
    const eqs = chains[0].filter((o) => o.m === "eq").map((o) => o.args);
    expect(eqs).toContainEqual(["user_id", "user-1"]);
  });
});
