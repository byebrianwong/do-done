import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateFocusList,
  partitionToday,
  todayUniverse,
} from "./focus.js";
import type { Task } from "@do-done/shared";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    user_id: "00000000-0000-0000-0000-000000000001",
    title: "Test task",
    description: null,
    status: "not_started",
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
    focus_override: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    completed_at: null,
    ...overrides,
  };
}

// Fix "today" to 2026-04-12 for deterministic overdue/due-today checks.
const TODAY = "2026-04-12";

describe("generateFocusList", () => {
  beforeEach(() => {
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
      makeTask({ title: "active", status: "not_started" }),
      makeTask({ title: "completed", status: "done" }),
    ];
    const result = generateFocusList(tasks);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("active");
  });

  it("excludes cancelled tasks", () => {
    const tasks = [
      makeTask({ title: "active", status: "in_progress" }),
      makeTask({ title: "cancelled", status: "cancelled" }),
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

  // ── Manual overrides ────────────────────────────────────

  it("pins a task in additively, without pushing an auto pick out", () => {
    const tasks = [
      makeTask({ title: "p1", priority: "p1" }),
      makeTask({ title: "p2", priority: "p2" }),
      makeTask({ title: "pinned p4", priority: "p4", focus_override: "include" }),
    ];
    // 2 auto slots fill with p1 + p2; the pin layers on top — nothing evicted.
    const result = generateFocusList(tasks, 2);
    const titles = result.map((t) => t.title);
    expect(titles).toContain("p1");
    expect(titles).toContain("p2");
    expect(titles).toContain("pinned p4");
    expect(result).toHaveLength(3);
  });

  it("does not double-count a pin that already ranks in the auto picks", () => {
    const tasks = [
      makeTask({ title: "pinned p1", priority: "p1", focus_override: "include" }),
      makeTask({ title: "p2", priority: "p2" }),
      makeTask({ title: "p3", priority: "p3" }),
    ];
    // The pin is already the top auto pick, so it appears exactly once.
    const result = generateFocusList(tasks, 2);
    const titles = result.map((t) => t.title);
    expect(titles).toEqual(["pinned p1", "p2"]);
  });

  it("boosts quick wins above longer same-priority tasks", () => {
    const tasks = [
      makeTask({ title: "long p3", priority: "p3", duration_minutes: 120 }),
      makeTask({ title: "quick p3", priority: "p3", duration_minutes: 10 }),
    ];
    const result = generateFocusList(tasks);
    expect(result[0].title).toBe("quick p3");
  });

  it("lifts a quick low-priority task above a longer higher-priority one", () => {
    const tasks = [
      // p2 (30) with no quick bonus.
      makeTask({ title: "long p2", priority: "p2", duration_minutes: 90 }),
      // p4 (10) + quick-win bonus (25) = 35, edging out the long p2.
      makeTask({ title: "quick p4", priority: "p4", duration_minutes: 10 }),
    ];
    const result = generateFocusList(tasks);
    expect(result[0].title).toBe("quick p4");
  });

  it("drops an exclude task even when it would otherwise rank highest", () => {
    const tasks = [
      makeTask({
        title: "overdue but excluded",
        priority: "p1",
        due_date: "2026-04-10",
        focus_override: "exclude",
      }),
      makeTask({ title: "p3", priority: "p3" }),
    ];
    const result = generateFocusList(tasks);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("p3");
  });

  it("shows all pins even when they exceed maxItems", () => {
    const tasks = [
      makeTask({ title: "a", focus_override: "include" }),
      makeTask({ title: "b", focus_override: "include" }),
      makeTask({ title: "c", focus_override: "include" }),
    ];
    const result = generateFocusList(tasks, 1);
    expect(result).toHaveLength(3);
  });

  it("honors manual sort_order ahead of score", () => {
    const tasks = [
      makeTask({ title: "second", priority: "p1", sort_order: 2000 }),
      makeTask({ title: "first", priority: "p4", sort_order: 1000 }),
    ];
    const result = generateFocusList(tasks);
    expect(result.map((t) => t.title)).toEqual(["first", "second"]);
  });
});

describe("partitionToday", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("keeps overdue tasks in Overdue even when pinned to focus (overdue wins)", () => {
    const tasks = [
      makeTask({
        title: "overdue + pinned",
        due_date: "2026-04-10",
        focus_override: "include",
      }),
      makeTask({ title: "today", due_date: "2026-04-12" }),
    ];
    const { overdue, focus } = partitionToday(tasks);
    expect(overdue.map((t) => t.title)).toEqual(["overdue + pinned"]);
    expect(focus.map((t) => t.title)).not.toContain("overdue + pinned");
  });

  it("splits non-overdue tasks into focus and other by focusMax", () => {
    const tasks = [
      makeTask({ title: "due today", priority: "p1", due_date: "2026-04-12" }),
      makeTask({ title: "someday", priority: "p4" }),
    ];
    const { focus, other } = partitionToday(tasks, 1);
    expect(focus.map((t) => t.title)).toEqual(["due today"]);
    expect(other.map((t) => t.title)).toEqual(["someday"]);
  });

  it("pulls a pinned 'other' task into focus without evicting the auto pick", () => {
    const tasks = [
      makeTask({ title: "due today", priority: "p1", due_date: "2026-04-12" }),
      makeTask({ title: "pinned someday", priority: "p4", focus_override: "include" }),
    ];
    const { focus, other } = partitionToday(tasks, 1);
    const titles = focus.map((t) => t.title);
    expect(titles).toContain("due today");
    expect(titles).toContain("pinned someday");
    expect(other).toHaveLength(0);
  });

  it("sends an excluded task to other instead of focus", () => {
    const tasks = [
      makeTask({ title: "excluded p1", priority: "p1", focus_override: "exclude" }),
      makeTask({ title: "p3", priority: "p3" }),
    ];
    const { focus, other } = partitionToday(tasks);
    expect(focus.map((t) => t.title)).toEqual(["p3"]);
    expect(other.map((t) => t.title)).toEqual(["excluded p1"]);
  });
});

describe("todayUniverse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("includes overdue, today-scheduled and pinned-undated; excludes a future excluded task", () => {
    const overdue = makeTask({ title: "overdue", due_date: "2026-04-10" });
    const today = makeTask({ title: "today", when_date: "2026-04-12" });
    const pinnedUndated = makeTask({
      title: "pinned undated",
      focus_override: "include",
    });
    const futureExcluded = makeTask({
      title: "future excluded",
      when_date: "2026-04-20",
      focus_override: "exclude",
    });
    const universe = todayUniverse(
      [overdue, today, pinnedUndated, futureExcluded],
      TODAY
    );
    const titles = universe.map((t) => t.title);
    expect(titles).toContain("overdue");
    expect(titles).toContain("today");
    expect(titles).toContain("pinned undated");
    expect(titles).not.toContain("future excluded");
  });
});
