import { describe, it, expect } from "vitest";
import { CreateTaskInput, TaskSchema, UpdateTaskInput } from "./schemas.js";

// Base set of fields that satisfy TaskSchema's non-when requirements.
// Returns a plain object so test cases can spread arbitrary overrides
// (including intentionally-invalid ones for negative tests).
function baseTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    user_id: "00000000-0000-0000-0000-000000000002",
    title: "Test task",
    description: null,
    status: "inbox",
    priority: "p4",
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
    created_at: "2026-05-11T00:00:00.000Z",
    updated_at: "2026-05-11T00:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

describe("TaskSchema · when_date", () => {
  it("accepts a concrete when_date", () => {
    const r = TaskSchema.safeParse(baseTask({ when_date: "2026-05-12" }));
    expect(r.success).toBe(true);
  });

  it("accepts an unscheduled task (when_date null)", () => {
    const r = TaskSchema.safeParse(baseTask());
    expect(r.success).toBe(true);
  });

  it("rejects a non-date when_date string", () => {
    const r = TaskSchema.safeParse(baseTask({ when_date: "someday" }));
    expect(r.success).toBe(false);
  });
});

describe("CreateTaskInput", () => {
  it("accepts when_date", () => {
    const r = CreateTaskInput.safeParse({
      title: "x",
      when_date: "2026-05-12",
    });
    expect(r.success).toBe(true);
  });

  it("accepts parent_task_id for subtasks", () => {
    const r = CreateTaskInput.safeParse({
      title: "subtask",
      parent_task_id: "00000000-0000-0000-0000-000000000099",
    });
    expect(r.success).toBe(true);
  });
});

describe("UpdateTaskInput", () => {
  it("allows clearing when_date (set to null)", () => {
    const r = UpdateTaskInput.safeParse({ when_date: null });
    expect(r.success).toBe(true);
  });

  it("accepts a new when_date", () => {
    const r = UpdateTaskInput.safeParse({ when_date: "2026-05-12" });
    expect(r.success).toBe(true);
  });
});

describe("TaskSchema · depth", () => {
  it("accepts depths 0, 1, 2", () => {
    for (const d of [0, 1, 2]) {
      const r = TaskSchema.safeParse(baseTask({ depth: d }));
      expect(r.success, `depth ${d} should parse`).toBe(true);
    }
  });

  it("rejects depth 3 (too deep)", () => {
    const r = TaskSchema.safeParse(baseTask({ depth: 3 }));
    expect(r.success).toBe(false);
  });

  it("rejects negative depth", () => {
    const r = TaskSchema.safeParse(baseTask({ depth: -1 }));
    expect(r.success).toBe(false);
  });
});
