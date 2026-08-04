import { describe, it, expect } from "vitest";
import type { Task } from "@do-done/shared";
import {
  shallowDiff,
  toUpdateInput,
  nextSaveStatus,
  type SaveEvent,
  type SaveStatus,
} from "./use-autosave-task.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    user_id: "00000000-0000-0000-0000-000000000099",
    title: "T",
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

describe("shallowDiff", () => {
  it("returns empty patch when no changes", () => {
    const a = makeTask();
    const b = makeTask();
    expect(shallowDiff(a, b)).toEqual({});
  });

  it("captures a single primitive field change", () => {
    const a = makeTask({ title: "Old" });
    const b = makeTask({ title: "New" });
    expect(shallowDiff(a, b)).toEqual({ title: "New" });
  });

  it("captures null transitions", () => {
    const a = makeTask({ when_date: null });
    const b = makeTask({ when_date: "2026-05-12" });
    expect(shallowDiff(a, b)).toEqual({ when_date: "2026-05-12" });

    const a2 = makeTask({ when_date: "2026-05-12" });
    const b2 = makeTask({ when_date: null });
    expect(shallowDiff(a2, b2)).toEqual({ when_date: null });
  });

  it("captures multiple field changes in one patch", () => {
    const a = makeTask({ title: "Old", priority: "p4", when_date: null });
    const b = makeTask({
      title: "New",
      priority: "p1",
      when_date: "2026-05-12",
    });
    expect(shallowDiff(a, b)).toEqual({
      title: "New",
      priority: "p1",
      when_date: "2026-05-12",
    });
  });

  it("shallow-compares arrays — equal contents = no diff", () => {
    const a = makeTask({ tags: ["web", "design"] });
    const b = makeTask({ tags: ["web", "design"] });
    expect(shallowDiff(a, b)).toEqual({});
  });

  it("shallow-compares arrays — different contents = diff", () => {
    const a = makeTask({ tags: ["web"] });
    const b = makeTask({ tags: ["web", "urgent"] });
    expect(shallowDiff(a, b)).toEqual({ tags: ["web", "urgent"] });
  });

  it("when_date and when_time change together produce both fields", () => {
    const a = makeTask({ when_date: "2026-05-12", when_time: null });
    const b = makeTask({ when_date: "2026-05-19", when_time: "09:00" });
    expect(shallowDiff(a, b)).toEqual({
      when_date: "2026-05-19",
      when_time: "09:00",
    });
  });
});

describe("toUpdateInput", () => {
  it("strips readonly fields (id, user_id, depth, timestamps)", () => {
    const patch = {
      id: "x",
      user_id: "y",
      depth: 1 as const,
      created_at: "...",
      updated_at: "...",
      completed_at: null,
      title: "new title",
    };
    expect(toUpdateInput(patch as Partial<Task>)).toEqual({ title: "new title" });
  });

  it("preserves writable fields", () => {
    const patch: Partial<Task> = {
      title: "T",
      priority: "p1",
      when_date: "2026-05-12",
      tags: ["a", "b"],
    };
    expect(toUpdateInput(patch)).toEqual(patch);
  });
});

describe("nextSaveStatus", () => {
  /** Replay a run of events from `idle`, returning every state along the way. */
  function run(...events: SaveEvent["type"][]): SaveStatus[] {
    let s: SaveStatus = "idle";
    return events.map((type) => (s = nextSaveStatus(s, { type } as SaveEvent)));
  }

  it("acknowledges the first keystroke before the debounce fires", () => {
    // The whole point: an `edit` alone — no commit, no round-trip — already
    // moves the indicator off its resting state.
    expect(nextSaveStatus("idle", { type: "edit" })).toBe("pending");
  });

  it("walks a normal edit through to a settled idle", () => {
    expect(run("edit", "commit", "success", "settle")).toEqual([
      "pending",
      "saving",
      "saved",
      "idle",
    ]);
  });

  it("re-enters pending from every resting state", () => {
    for (const from of ["idle", "saved", "error"] as SaveStatus[]) {
      expect(nextSaveStatus(from, { type: "edit" })).toBe("pending");
    }
  });

  it("does not flash Saved over keystrokes typed during the request", () => {
    // edit → commit (in flight) → user types again → the in-flight save lands.
    // That commit is already stale, so the indicator has to stay pending.
    expect(run("edit", "commit", "edit", "success")).toEqual([
      "pending",
      "saving",
      "pending",
      "pending",
    ]);
  });

  it("clears the pending hint when the queued patch turns out empty", () => {
    // Typed a character and deleted it: the debounce fires on nothing, and no
    // success is coming to clear `pending`.
    expect(run("edit", "noop")).toEqual(["pending", "idle"]);
  });

  it("leaves a resting state alone on noop", () => {
    expect(nextSaveStatus("saved", { type: "noop" })).toBe("saved");
    expect(nextSaveStatus("error", { type: "noop" })).toBe("error");
  });

  it("surfaces failures from anywhere", () => {
    for (const from of ["pending", "saving", "saved"] as SaveStatus[]) {
      expect(nextSaveStatus(from, { type: "failure" })).toBe("error");
    }
  });

  it("ignores a stale settle timer that outlives its Saved flash", () => {
    // The flash timer is fire-and-forget; if the user has started typing again
    // (or a save has failed) since, it must not wipe that.
    expect(nextSaveStatus("pending", { type: "settle" })).toBe("pending");
    expect(nextSaveStatus("error", { type: "settle" })).toBe("error");
    expect(nextSaveStatus("saving", { type: "settle" })).toBe("saving");
  });
});
