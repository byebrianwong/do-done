import { describe, it, expect } from "vitest";
import type { Task } from "@do-done/shared";
import { shallowDiff, toUpdateInput } from "./use-autosave-task.js";

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
    when_bucket: null,
    due_date: null,
    due_time: null,
    duration_minutes: null,
    recurrence_rule: null,
    calendar_event_id: null,
    tags: [],
    parent_task_id: null,
    depth: 0,
    sort_order: 0,
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

  it("when_date ↔ when_bucket transition produces both fields", () => {
    const a = makeTask({ when_date: "2026-05-12", when_bucket: null });
    const b = makeTask({ when_date: null, when_bucket: "next_week" });
    expect(shallowDiff(a, b)).toEqual({
      when_date: null,
      when_bucket: "next_week",
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
      when_bucket: null,
      tags: ["a", "b"],
    };
    expect(toUpdateInput(patch)).toEqual(patch);
  });
});
