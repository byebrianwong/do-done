import { describe, it, expect } from "vitest";
import {
  CreateTaskInput,
  TaskSchema,
  UpdateTaskInput,
  UpdateProjectInput,
} from "./schemas.js";
import { TASK_DESCRIPTION_MAX_LENGTH } from "./constants.js";

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
    scheduled_date: null,
    scheduled_time: null,
    deadline_date: null,
    deadline_time: null,
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

describe("TaskSchema · scheduled_date", () => {
  it("accepts a concrete scheduled_date", () => {
    const r = TaskSchema.safeParse(baseTask({ scheduled_date: "2026-05-12" }));
    expect(r.success).toBe(true);
  });

  it("accepts an unscheduled task (scheduled_date null)", () => {
    const r = TaskSchema.safeParse(baseTask());
    expect(r.success).toBe(true);
  });

  it("rejects a non-date scheduled_date string", () => {
    const r = TaskSchema.safeParse(baseTask({ scheduled_date: "someday" }));
    expect(r.success).toBe(false);
  });
});

describe("CreateTaskInput", () => {
  it("accepts scheduled_date", () => {
    const r = CreateTaskInput.safeParse({
      title: "x",
      scheduled_date: "2026-05-12",
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
  it("allows clearing scheduled_date (set to null)", () => {
    const r = UpdateTaskInput.safeParse({ scheduled_date: null });
    expect(r.success).toBe(true);
  });

  it("accepts a new scheduled_date", () => {
    const r = UpdateTaskInput.safeParse({ scheduled_date: "2026-05-12" });
    expect(r.success).toBe(true);
  });
});

// The notes limit has to be the same number in the Zod schemas, the
// `tasks_description_check` DB constraint and every notes input's `maxLength`.
// When it wasn't, exceeding it didn't just reject the notes: the autosave hook
// keeps diffing against the snapshot it mounted with, so the oversized
// description rode along in every later PATCH and the whole task — title,
// priority, dates — silently stopped saving.
describe("description length", () => {
  const atLimit = "x".repeat(TASK_DESCRIPTION_MAX_LENGTH);
  const overLimit = "x".repeat(TASK_DESCRIPTION_MAX_LENGTH + 1);

  it("accepts notes far longer than the old 5,000-char cap", () => {
    const r = UpdateTaskInput.safeParse({ description: "x".repeat(20_000) });
    expect(r.success).toBe(true);
  });

  it("accepts notes exactly at the limit on every write path", () => {
    expect(TaskSchema.safeParse(baseTask({ description: atLimit })).success).toBe(
      true
    );
    expect(
      CreateTaskInput.safeParse({ title: "t", description: atLimit }).success
    ).toBe(true);
    expect(UpdateTaskInput.safeParse({ description: atLimit }).success).toBe(true);
  });

  it("rejects one character past the limit, matching the DB constraint", () => {
    expect(
      TaskSchema.safeParse(baseTask({ description: overLimit })).success
    ).toBe(false);
    expect(
      CreateTaskInput.safeParse({ title: "t", description: overLimit }).success
    ).toBe(false);
    expect(UpdateTaskInput.safeParse({ description: overLimit }).success).toBe(
      false
    );
  });
});

describe("UpdateProjectInput", () => {
  it("accepts a lone sort_order (drag-to-reorder writes just this)", () => {
    const r = UpdateProjectInput.safeParse({ sort_order: 2000 });
    expect(r.success).toBe(true);
  });

  it("accepts an empty patch", () => {
    expect(UpdateProjectInput.safeParse({}).success).toBe(true);
  });

  it("rejects a non-integer sort_order", () => {
    expect(UpdateProjectInput.safeParse({ sort_order: 1.5 }).success).toBe(
      false
    );
  });

  it("allows clearing the icon (set to null)", () => {
    expect(UpdateProjectInput.safeParse({ icon: null }).success).toBe(true);
  });

  it("rejects an invalid color", () => {
    expect(UpdateProjectInput.safeParse({ color: "indigo" }).success).toBe(
      false
    );
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
