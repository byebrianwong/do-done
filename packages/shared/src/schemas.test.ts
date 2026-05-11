import { describe, it, expect } from "vitest";
import {
  CreateTaskInput,
  TaskSchema,
  UpdateTaskInput,
  WhenBucket,
} from "./schemas.js";

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

describe("WhenBucket", () => {
  it("accepts each known bucket value", () => {
    for (const v of [
      "today",
      "tomorrow",
      "this_week",
      "next_week",
      "later",
      "someday",
    ]) {
      expect(WhenBucket.safeParse(v).success).toBe(true);
    }
  });

  it("rejects unknown bucket values", () => {
    expect(WhenBucket.safeParse("never").success).toBe(false);
    expect(WhenBucket.safeParse("").success).toBe(false);
  });
});

describe("TaskSchema · when_date vs when_bucket exclusivity", () => {
  it("accepts when_date set, when_bucket null", () => {
    const r = TaskSchema.safeParse(baseTask({ when_date: "2026-05-12" }));
    expect(r.success).toBe(true);
  });

  it("accepts when_bucket set, when_date null", () => {
    const r = TaskSchema.safeParse(baseTask({ when_bucket: "this_week" }));
    expect(r.success).toBe(true);
  });

  it("accepts both null (unscheduled task)", () => {
    const r = TaskSchema.safeParse(baseTask());
    expect(r.success).toBe(true);
  });

  it("rejects when both when_date and when_bucket are set", () => {
    const r = TaskSchema.safeParse(
      baseTask({ when_date: "2026-05-12", when_bucket: "this_week" })
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toMatch(/mutually exclusive/);
    }
  });
});

describe("CreateTaskInput · when exclusivity", () => {
  it("accepts when_date only", () => {
    const r = CreateTaskInput.safeParse({
      title: "x",
      when_date: "2026-05-12",
    });
    expect(r.success).toBe(true);
  });

  it("accepts when_bucket only", () => {
    const r = CreateTaskInput.safeParse({
      title: "x",
      when_bucket: "later",
    });
    expect(r.success).toBe(true);
  });

  it("rejects both set", () => {
    const r = CreateTaskInput.safeParse({
      title: "x",
      when_date: "2026-05-12",
      when_bucket: "later",
    });
    expect(r.success).toBe(false);
  });

  it("accepts parent_task_id for subtasks", () => {
    const r = CreateTaskInput.safeParse({
      title: "subtask",
      parent_task_id: "00000000-0000-0000-0000-000000000099",
    });
    expect(r.success).toBe(true);
  });
});

describe("UpdateTaskInput · when exclusivity", () => {
  it("allows clearing both (set to null)", () => {
    const r = UpdateTaskInput.safeParse({
      when_date: null,
      when_bucket: null,
    });
    expect(r.success).toBe(true);
  });

  it("allows switching when_date → when_bucket in one patch", () => {
    // The patch sets when_date to null and when_bucket to a value — both
    // present in the object but only one is non-null, so it must pass.
    const r = UpdateTaskInput.safeParse({
      when_date: null,
      when_bucket: "next_week",
    });
    expect(r.success).toBe(true);
  });

  it("rejects setting both to non-null values", () => {
    const r = UpdateTaskInput.safeParse({
      when_date: "2026-05-12",
      when_bucket: "next_week",
    });
    expect(r.success).toBe(false);
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
