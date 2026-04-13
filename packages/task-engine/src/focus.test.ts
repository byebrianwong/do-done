import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateFocusList } from "./focus.js";
import type { Task } from "@do-done/shared";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    user_id: "00000000-0000-0000-0000-000000000001",
    title: "Test task",
    description: null,
    status: "todo",
    priority: "p4",
    project_id: null,
    due_date: null,
    due_time: null,
    duration_minutes: null,
    recurrence_rule: null,
    calendar_event_id: null,
    tags: [],
    sort_order: 0,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    completed_at: null,
    ...overrides,
  };
}

describe("generateFocusList", () => {
  beforeEach(() => {
    // Fix "today" to 2026-04-12 for deterministic overdue/due-today checks
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("higher priority tasks score higher", () => {
    const tasks = [
      makeTask({ title: "low", priority: "p4" }),
      makeTask({ title: "urgent", priority: "p1" }),
      makeTask({ title: "medium", priority: "p3" }),
    ];
    const result = generateFocusList(tasks);
    expect(result[0].title).toBe("urgent");
    expect(result[1].title).toBe("medium");
    expect(result[2].title).toBe("low");
  });

  it("overdue tasks rank highest", () => {
    const tasks = [
      makeTask({ title: "p1 no date", priority: "p1" }),
      makeTask({ title: "overdue p4", priority: "p4", due_date: "2026-04-10" }),
    ];
    const result = generateFocusList(tasks);
    expect(result[0].title).toBe("overdue p4");
  });

  it("excludes done tasks", () => {
    const tasks = [
      makeTask({ title: "active", status: "todo" }),
      makeTask({ title: "completed", status: "done" }),
    ];
    const result = generateFocusList(tasks);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("active");
  });

  it("excludes archived tasks", () => {
    const tasks = [
      makeTask({ title: "active", status: "in_progress" }),
      makeTask({ title: "archived", status: "archived" }),
    ];
    const result = generateFocusList(tasks);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("active");
  });

  it("returns max 7 items by default", () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      makeTask({ title: `task ${i}` })
    );
    const result = generateFocusList(tasks);
    expect(result).toHaveLength(7);
  });

  it("respects custom maxItems", () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      makeTask({ title: `task ${i}` })
    );
    const result = generateFocusList(tasks, 3);
    expect(result).toHaveLength(3);
  });

  it("due-today tasks rank above tasks with no date", () => {
    const tasks = [
      makeTask({ title: "no date", priority: "p3" }),
      makeTask({ title: "due today", priority: "p3", due_date: "2026-04-12" }),
    ];
    const result = generateFocusList(tasks);
    expect(result[0].title).toBe("due today");
  });
});
