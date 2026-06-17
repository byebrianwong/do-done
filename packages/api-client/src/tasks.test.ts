import { describe, it, expect } from "vitest";
import { addDaysLocalISO, todayLocalISO } from "@do-done/shared";
import { TasksApi } from "./tasks.js";

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
