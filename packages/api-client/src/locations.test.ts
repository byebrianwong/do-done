import { describe, it, expect } from "vitest";
import { LocationsApi } from "./locations.js";
import type { Location } from "@do-done/shared";

function makeLocation(id: string, name: string): Location {
  return {
    id,
    user_id: "user-1",
    name,
    latitude: 51.5,
    longitude: -0.12,
    radius_meters: 200,
    address: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  };
}

/**
 * Chainable Supabase stub that resolves each `from()` chain with the next
 * queued result, so a method issuing two queries can be given two payloads.
 */
function makeSupabaseStub(results: { data: unknown; error: unknown }[]) {
  let next = 0;
  const builder: Record<string, unknown> = {};
  const chain =
    () =>
    (...__args: unknown[]) =>
      builder;
  for (const m of ["from", "select", "order", "eq", "in"]) {
    builder[m] = chain();
  }
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve(results[next++] ?? { data: [], error: null });
  return builder;
}

describe("LocationsApi.listWithPendingTasks", () => {
  it("drops locations whose only tasks are done or cancelled", async () => {
    const supabase = makeSupabaseStub([
      {
        data: [makeLocation("loc-live", "Tesco"), makeLocation("loc-dead", "Gym")],
        error: null,
      },
      {
        data: [
          {
            location_id: "loc-live",
            trigger_type: "enter",
            tasks: { id: "t1", status: "todo" },
          },
          {
            location_id: "loc-dead",
            trigger_type: "enter",
            tasks: { id: "t2", status: "done" },
          },
          {
            location_id: "loc-dead",
            trigger_type: "exit",
            tasks: { id: "t3", status: "cancelled" },
          },
        ],
        error: null,
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new LocationsApi(supabase as any, "user-1");
    const { data, error } = await api.listWithPendingTasks();

    expect(error).toBeNull();
    expect(data.map((d) => d.location.id)).toEqual(["loc-live"]);
    expect(data[0].pendingCount).toBe(1);
    expect(data[0].triggers).toEqual(["enter"]);
  });

  it("collects the distinct trigger directions a location still needs", async () => {
    const supabase = makeSupabaseStub([
      { data: [makeLocation("loc-1", "Office")], error: null },
      {
        data: [
          {
            location_id: "loc-1",
            trigger_type: "enter",
            tasks: { id: "t1", status: "todo" },
          },
          {
            location_id: "loc-1",
            trigger_type: "exit",
            tasks: { id: "t2", status: "in_progress" },
          },
          // Second open task on an already-seen direction: counts, no dupe.
          {
            location_id: "loc-1",
            trigger_type: "enter",
            tasks: { id: "t3", status: "inbox" },
          },
        ],
        error: null,
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new LocationsApi(supabase as any, "user-1");
    const { data } = await api.listWithPendingTasks();

    expect(data).toHaveLength(1);
    expect(data[0].pendingCount).toBe(3);
    expect([...data[0].triggers].sort()).toEqual(["enter", "exit"]);
  });

  it("normalises an embedded task returned as a single-element array", async () => {
    const supabase = makeSupabaseStub([
      { data: [makeLocation("loc-1", "Home")], error: null },
      {
        data: [
          {
            location_id: "loc-1",
            trigger_type: "enter",
            tasks: [{ id: "t1", status: "todo" }],
          },
        ],
        error: null,
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new LocationsApi(supabase as any, "user-1");
    const { data } = await api.listWithPendingTasks();

    expect(data).toHaveLength(1);
    expect(data[0].pendingCount).toBe(1);
  });

  it("skips the link query entirely when the user has no locations", async () => {
    const supabase = makeSupabaseStub([{ data: [], error: null }]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new LocationsApi(supabase as any, "user-1");
    const { data, error } = await api.listWithPendingTasks();

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("surfaces a link-query failure instead of reporting an empty set", async () => {
    const supabase = makeSupabaseStub([
      { data: [makeLocation("loc-1", "Home")], error: null },
      { data: null, error: new Error("boom") },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new LocationsApi(supabase as any, "user-1");
    const { data, error } = await api.listWithPendingTasks();

    expect(error).toBeInstanceOf(Error);
    expect(data).toEqual([]);
  });
});
