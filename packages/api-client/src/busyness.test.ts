import { describe, it, expect } from "vitest";
import type { Task } from "@do-done/shared";
import { buildDaysInRange, groupTasksByDate } from "./busyness.js";

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    user_id: "00000000-0000-0000-0000-000000000099",
    title: "T",
    description: null,
    status: "not_started",
    priority: "p3",
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
    focus_override: null,
    created_at: "2026-05-11T00:00:00.000Z",
    updated_at: "2026-05-11T00:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

describe("groupTasksByDate", () => {
  it("groups tasks by scheduled_date", () => {
    const tasks = [
      makeTask({ id: "a", scheduled_date: "2026-05-12" }),
      makeTask({ id: "b", scheduled_date: "2026-05-12" }),
      makeTask({ id: "c", scheduled_date: "2026-05-13" }),
    ];
    const grouped = groupTasksByDate(tasks);
    expect(grouped.get("2026-05-12")?.map((t) => t.id)).toEqual(["a", "b"]);
    expect(grouped.get("2026-05-13")?.map((t) => t.id)).toEqual(["c"]);
  });

  it("skips tasks with no scheduled_date", () => {
    const tasks = [
      makeTask({ id: "a", scheduled_date: "2026-05-12" }),
      makeTask({ id: "b", scheduled_date: null }),
    ];
    const grouped = groupTasksByDate(tasks);
    expect(grouped.size).toBe(1);
    expect(grouped.get("2026-05-12")?.length).toBe(1);
  });

  it("defaults missing duration to 30 minutes", () => {
    const tasks = [makeTask({ scheduled_date: "2026-05-12", duration_minutes: null })];
    const grouped = groupTasksByDate(tasks);
    expect(grouped.get("2026-05-12")?.[0].duration_minutes).toBe(30);
  });

  it("preserves priority on the item", () => {
    const tasks = [makeTask({ scheduled_date: "2026-05-12", priority: "p1" })];
    const grouped = groupTasksByDate(tasks);
    expect(grouped.get("2026-05-12")?.[0].priority).toBe("p1");
  });
});

describe("buildDaysInRange", () => {
  it("includes every day in the range, even empty ones", () => {
    const result = buildDaysInRange("2026-05-10", "2026-05-16", new Map());
    expect(result.map((d) => d.date)).toEqual([
      "2026-05-10",
      "2026-05-11",
      "2026-05-12",
      "2026-05-13",
      "2026-05-14",
      "2026-05-15",
      "2026-05-16",
    ]);
    for (const d of result) {
      expect(d.items).toEqual([]);
      expect(d.total_minutes).toBe(0);
    }
  });

  it("populates items on matching dates", () => {
    const byDate = new Map([
      [
        "2026-05-12",
        [
          {
            type: "task" as const,
            id: "a",
            title: "T",
            duration_minutes: 60,
            priority: "p2" as const,
          },
        ],
      ],
    ]);
    const result = buildDaysInRange("2026-05-11", "2026-05-13", byDate);
    expect(result[0].items).toEqual([]);
    expect(result[1].date).toBe("2026-05-12");
    expect(result[1].items.length).toBe(1);
    expect(result[1].total_minutes).toBe(60);
    expect(result[2].items).toEqual([]);
  });

  it("sums durations into total_minutes per day", () => {
    const byDate = new Map([
      [
        "2026-05-12",
        [
          {
            type: "task" as const,
            id: "a",
            title: "A",
            duration_minutes: 30,
          },
          {
            type: "task" as const,
            id: "b",
            title: "B",
            duration_minutes: 120,
          },
          {
            type: "event" as const,
            id: "e1",
            title: "standup",
            duration_minutes: 15,
          },
        ],
      ],
    ]);
    const result = buildDaysInRange("2026-05-12", "2026-05-12", byDate);
    expect(result[0].total_minutes).toBe(165);
  });

  it("returns empty array if endDate < startDate", () => {
    const result = buildDaysInRange("2026-05-15", "2026-05-10", new Map());
    expect(result).toEqual([]);
  });
});
