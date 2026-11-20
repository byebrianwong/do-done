import { describe, expect, it, vi } from "vitest";
import type { Task } from "@do-done/shared";
import { makeTask } from "@/components/__stories__/mocks";
import {
  adoptLocally,
  commitAdoptedOrder,
  commitPlacement,
  placeLocally,
} from "./task-order";

function rows(): Task[] {
  return [
    makeTask({ id: "a", sort_order: 1024 }),
    makeTask({ id: "b", sort_order: 2048 }),
    makeTask({ id: "c", sort_order: 3072 }),
  ];
}

function fakeApi() {
  return {
    update: vi.fn(async () => ({ data: null, error: null })),
    place: vi.fn(async () => ({ data: 0, error: null })),
    adoptOrder: vi.fn(async () => ({ error: null })),
  };
}

describe("placeLocally", () => {
  it("re-keys only the moved row, between its new neighbours", () => {
    const { tasks, placement } = placeLocally(rows(), ["a", "c", "b"], "c", {
      status: "next",
    });
    expect(placement).toEqual({ after: "a", before: "b", rank: 1536 });
    expect(tasks.map((t) => [t.id, t.sort_order, t.status])).toEqual([
      ["a", 1024, "not_started"],
      ["b", 2048, "not_started"],
      ["c", 1536, "next"],
    ]);
  });
});

describe("adoptLocally", () => {
  it("deals the listed rows their own keys in the listed order", () => {
    const tasks = adoptLocally(rows(), ["c", "a"]);
    expect(tasks.map((t) => [t.id, t.sort_order])).toEqual([
      ["a", 3072],
      ["b", 2048],
      ["c", 1024],
    ]);
  });
});

describe("commitPlacement", () => {
  it("writes the field change before the position", async () => {
    const api = fakeApi();
    await commitPlacement(api, "c", { after: "a", before: "b", rank: 1536 }, {
      status: "next",
    });
    expect(api.update).toHaveBeenCalledWith("c", { status: "next" });
    expect(api.place).toHaveBeenCalledWith("c", { after: "a", before: "b" });
    expect(api.update.mock.invocationCallOrder[0]).toBeLessThan(
      api.place.mock.invocationCallOrder[0]
    );
  });

  it("does not place when the field change failed", async () => {
    const api = fakeApi();
    const failure = new Error("nope");
    api.update.mockResolvedValueOnce({ data: null, error: failure as never });
    const { error } = await commitPlacement(
      api,
      "c",
      { after: "a", before: null, rank: 0 },
      { status: "next" }
    );
    expect(error).toBe(failure);
    expect(api.place).not.toHaveBeenCalled();
  });

  it("writes no position for a row alone in its list", async () => {
    const api = fakeApi();
    await commitPlacement(api, "c", { after: null, before: null, rank: 0 });
    expect(api.update).not.toHaveBeenCalled();
    expect(api.place).not.toHaveBeenCalled();
  });
});

describe("commitAdoptedOrder", () => {
  it("writes the dragged row's field change, then the order", async () => {
    const api = fakeApi();
    await commitAdoptedOrder(api, ["c", "a", "b"], {
      id: "c",
      patch: { priority: "p1" },
    });
    expect(api.update).toHaveBeenCalledWith("c", { priority: "p1" });
    expect(api.adoptOrder).toHaveBeenCalledWith(["c", "a", "b"]);
  });
});
