import { describe, expect, it } from "vitest";
import {
  TASK_ORDER_STEP,
  adoptedRanks,
  compareTaskOrder,
  planPlacement,
  rankBetween,
  sortByTaskOrder,
} from "./task-order.js";

const row = (id: string, sort_order: number) => ({ id, sort_order });

describe("compareTaskOrder", () => {
  it("orders by key first", () => {
    const rows = [row("c", 3), row("a", 1), row("b", 2)];
    expect(sortByTaskOrder(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks a tied key by id, the same way every time", () => {
    const a = row("0a7c1e2f-0000-4000-8000-000000000000", 5);
    const b = row("9f00aa00-0000-4000-8000-000000000000", 5);
    expect(compareTaskOrder(a, b)).toBeLessThan(0);
    expect(compareTaskOrder(b, a)).toBeGreaterThan(0);
    expect(sortByTaskOrder([b, a])).toEqual(sortByTaskOrder([a, b]));
  });

  it("keeps two tasks' relative order however the list around them is filtered", () => {
    const all = [row("a", 1), row("h", 2), row("b", 3), row("x", 4)];
    const order = (ids: string[]) =>
      sortByTaskOrder(all.filter((r) => ids.includes(r.id))).map((r) => r.id);
    expect(order(["b", "a"])).toEqual(["a", "b"]);
    expect(order(["x", "b", "a"])).toEqual(["a", "b", "x"]);
    expect(order(["h", "b", "a"])).toEqual(["a", "h", "b"]);
  });
});

describe("rankBetween", () => {
  it("steps past an open end", () => {
    expect(rankBetween(null, 2048)).toBe(2048 - TASK_ORDER_STEP);
    expect(rankBetween(2048, null)).toBe(2048 + TASK_ORDER_STEP);
    expect(rankBetween(null, null)).toBe(0);
  });

  it("takes the midpoint of a gap", () => {
    expect(rankBetween(1024, 2048)).toBe(1536);
  });

  it("reports no room for an empty or reversed gap", () => {
    expect(rankBetween(1024, 1024)).toBeNull();
    expect(rankBetween(2048, 1024)).toBeNull();
  });

  it("runs out after repeated inserts into the same gap, rather than returning a bound", () => {
    let lo = 1024;
    const hi = 2048;
    let steps = 0;
    for (;;) {
      const mid = rankBetween(lo, hi);
      if (mid === null) break;
      expect(mid).toBeGreaterThan(lo);
      expect(mid).toBeLessThan(hi);
      lo = mid;
      steps++;
    }
    // A float8 has a 52-bit fraction; a gap of 2^10 at magnitude 2^11 halves
    // about 52 times before it closes.
    expect(steps).toBeGreaterThan(40);
    expect(steps).toBeLessThan(60);
  });
});

describe("planPlacement", () => {
  const keys = new Map([
    ["a", 1024],
    ["b", 2048],
    ["c", 3072],
  ]);
  const keyOf = (id: string) => keys.get(id);

  it("names both neighbours and ranks between them", () => {
    expect(planPlacement(["a", "c", "b"], "c", keyOf)).toEqual({
      after: "a",
      before: "b",
      rank: 1536,
    });
  });

  it("ranks above the first row when dropped at the top", () => {
    expect(planPlacement(["c", "a", "b"], "c", keyOf)).toEqual({
      after: null,
      before: "a",
      rank: 1024 - TASK_ORDER_STEP,
    });
  });

  it("ranks below the last row when dropped at the bottom", () => {
    expect(planPlacement(["b", "c", "a"], "a", keyOf)).toEqual({
      after: "c",
      before: null,
      rank: 3072 + TASK_ORDER_STEP,
    });
  });

  it("keeps the current key when the list holds nothing else", () => {
    expect(planPlacement(["b"], "b", keyOf)).toEqual({
      after: null,
      before: null,
      rank: 2048,
    });
  });

  it("falls back to the upper neighbour's key when the client sees no room", () => {
    const tied = new Map([
      ["a", 1024],
      ["b", 1024],
      ["c", 3072],
    ]);
    const plan = planPlacement(["a", "c", "b"], "c", (id) => tied.get(id));
    expect(plan?.rank).toBe(1024);
  });

  it("returns null for an id that is not in the list", () => {
    expect(planPlacement(["a", "b"], "z", keyOf)).toBeNull();
  });
});

describe("adoptedRanks", () => {
  it("deals the listed tasks their own keys in the listed order", () => {
    const keys = new Map([
      ["p1", 5120],
      ["p2", 1024],
      ["p3", 3072],
    ]);
    const ranks = adoptedRanks(["p1", "p3", "p2"], (id) => keys.get(id));
    expect([...ranks]).toEqual([
      ["p1", 1024],
      ["p3", 3072],
      ["p2", 5120],
    ]);
  });

  it("leaves a task outside the list where it was", () => {
    // `h` sits between two of the slots and is not in the view.
    const keys = new Map([
      ["a", 1024],
      ["h", 2048],
      ["b", 3072],
    ]);
    const ranks = adoptedRanks(["b", "a"], (id) => keys.get(id));
    const after = [...keys].map(([id, k]) => row(id, ranks.get(id) ?? k));
    expect(sortByTaskOrder(after).map((r) => r.id)).toEqual(["b", "h", "a"]);
  });

  it("skips ids it has no key for", () => {
    const ranks = adoptedRanks(["x", "a"], (id) => (id === "a" ? 7 : undefined));
    expect([...ranks]).toEqual([["a", 7]]);
  });
});
