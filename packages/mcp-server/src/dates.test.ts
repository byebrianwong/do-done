import { describe, it, expect } from "vitest";
import type { Task } from "@do-done/shared";
import {
  addDaysISO,
  buildAgenda,
  daysBetweenISO,
  describeTask,
  isOverdueOn,
  relativeDayLabel,
  renderAgenda,
  summarizeTaskDates,
  weekdayName,
  withResolvedDates,
} from "./dates.js";

const TODAY = "2026-08-03"; // a Monday

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-0000000000ff",
    title: "Clean up room",
    description: null,
    status: "not_started",
    priority: "p2",
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
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    completed_at: null,
    ...overrides,
  } as Task;
}

describe("daysBetweenISO", () => {
  it("counts whole calendar days, signed", () => {
    expect(daysBetweenISO(TODAY, TODAY)).toBe(0);
    expect(daysBetweenISO(TODAY, "2026-08-10")).toBe(7);
    expect(daysBetweenISO(TODAY, "2026-07-31")).toBe(-3);
  });

  it("crosses month and year boundaries", () => {
    expect(daysBetweenISO("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetweenISO("2026-02-28", "2026-03-01")).toBe(1); // 2026 isn't a leap year
    expect(daysBetweenISO("2024-02-28", "2024-03-01")).toBe(2); // 2024 is
  });

  it("is unaffected by a DST transition inside the span", () => {
    // US DST ends 2026-11-01. A local-midnight implementation would return 6.
    expect(daysBetweenISO("2026-10-29", "2026-11-05")).toBe(7);
  });

  it("returns null for garbage", () => {
    expect(daysBetweenISO(TODAY, "not-a-date")).toBeNull();
    expect(daysBetweenISO(TODAY, "2026-02-31")).toBeNull();
    expect(daysBetweenISO(TODAY, "2026-8-3")).toBeNull();
  });
});

describe("relativeDayLabel", () => {
  it("names the days around today", () => {
    expect(relativeDayLabel(TODAY, TODAY)).toBe("today");
    expect(relativeDayLabel("2026-08-04", TODAY)).toBe("tomorrow");
    expect(relativeDayLabel("2026-08-02", TODAY)).toBe("yesterday");
  });

  it("counts further out in both directions", () => {
    expect(relativeDayLabel("2026-08-07", TODAY)).toBe("in 4 days");
    expect(relativeDayLabel("2026-07-29", TODAY)).toBe("5 days ago");
  });
});

describe("weekdayName", () => {
  it("resolves the weekday from the calendar date alone", () => {
    expect(weekdayName("2026-08-03")).toBe("Monday");
    expect(weekdayName("2026-08-08")).toBe("Saturday");
    expect(weekdayName("nope")).toBeNull();
  });
});

describe("addDaysISO", () => {
  it("walks forward and back across month ends", () => {
    expect(addDaysISO("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDaysISO("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysISO(TODAY, 0)).toBe(TODAY);
  });
});

describe("isOverdueOn", () => {
  it("counts a past when_date, not just a past deadline", () => {
    expect(isOverdueOn(task({ when_date: "2026-08-01" }), TODAY)).toBe(true);
    expect(isOverdueOn(task({ due_date: "2026-08-01" }), TODAY)).toBe(true);
  });

  it("does not count today or the future", () => {
    expect(isOverdueOn(task({ when_date: TODAY }), TODAY)).toBe(false);
    expect(isOverdueOn(task({ when_date: "2026-08-04" }), TODAY)).toBe(false);
    expect(isOverdueOn(task(), TODAY)).toBe(false);
  });

  it("ignores closed tasks", () => {
    const past = { when_date: "2026-07-01" };
    expect(isOverdueOn(task({ ...past, status: "done" }), TODAY)).toBe(false);
    expect(isOverdueOn(task({ ...past, status: "cancelled" }), TODAY)).toBe(
      false
    );
  });
});

describe("summarizeTaskDates", () => {
  it("reports a when_date as scheduled, never as undated", () => {
    const dates = summarizeTaskDates(task({ when_date: TODAY }), TODAY);
    expect(dates.when_relative).toBe("today");
    expect(dates.due_relative).toBeNull();
    expect(dates.overdue).toBe(false);
    expect(dates.summary).toBe("scheduled for 2026-08-03 (Monday, today)");
  });

  it("keeps the two fields distinct when both are set", () => {
    const dates = summarizeTaskDates(
      task({ when_date: TODAY, when_time: "09:30", due_date: "2026-08-07" }),
      TODAY
    );
    expect(dates.summary).toBe(
      "scheduled for 2026-08-03 (Monday, today) at 09:30 · due 2026-08-07 (Friday, in 4 days)"
    );
  });

  it("flags overdue explicitly", () => {
    const dates = summarizeTaskDates(task({ when_date: "2026-07-30" }), TODAY);
    expect(dates.overdue).toBe(true);
    expect(dates.summary).toContain("OVERDUE");
  });

  it("says so plainly when there is genuinely no date", () => {
    expect(summarizeTaskDates(task(), TODAY).summary).toBe("no date set");
  });
});

describe("withResolvedDates", () => {
  it("adds a derived block without disturbing the row", () => {
    const row = task({ when_date: "2026-08-04" });
    const resolved = withResolvedDates(row, TODAY);
    expect(resolved.id).toBe(row.id);
    expect(resolved.when_date).toBe("2026-08-04");
    expect(resolved.dates).toEqual({
      when_relative: "tomorrow",
      due_relative: null,
      overdue: false,
      summary: "scheduled for 2026-08-04 (Tuesday, tomorrow)",
    });
  });
});

describe("buildAgenda", () => {
  const base = { todayISO: TODAY, timezone: "America/Los_Angeles" };

  it("buckets a task on the day its when_date falls", () => {
    const agenda = buildAgenda([task({ when_date: "2026-08-04" })], {
      ...base,
      startISO: TODAY,
      days: 3,
    });
    expect(agenda.days.map((d) => d.date)).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
    ]);
    expect(agenda.days[0]!.entries).toHaveLength(0);
    expect(agenda.days[1]!.entries[0]!.reason).toBe("when");
  });

  it("lists a task on both its scheduled day and its deadline", () => {
    const agenda = buildAgenda(
      [task({ when_date: "2026-08-03", due_date: "2026-08-05" })],
      { ...base, startISO: TODAY, days: 3 }
    );
    expect(agenda.days[0]!.entries[0]!.reason).toBe("when");
    expect(agenda.days[2]!.entries[0]!.reason).toBe("due");
    expect(agenda.days[1]!.entries).toHaveLength(0);
  });

  it("marks a same-day schedule and deadline as when+due", () => {
    const agenda = buildAgenda(
      [task({ when_date: TODAY, due_date: TODAY })],
      { ...base, startISO: TODAY, days: 1 }
    );
    expect(agenda.days[0]!.entries[0]!.reason).toBe("when+due");
  });

  it("pulls overdue tasks out instead of dropping them off the window", () => {
    const agenda = buildAgenda(
      [task({ id: "late", when_date: "2026-07-20" }), task({ when_date: TODAY })],
      { ...base, startISO: TODAY, days: 1 }
    );
    expect(agenda.overdue.map((t) => t.id)).toEqual(["late"]);
    expect(agenda.days[0]!.entries).toHaveLength(1);
  });

  it("never double-counts an overdue task into a day bucket", () => {
    // Window reaching into the past: the overdue task's date IS in range.
    const agenda = buildAgenda([task({ id: "late", when_date: "2026-08-01" })], {
      ...base,
      startISO: "2026-08-01",
      days: 5,
    });
    expect(agenda.overdue).toHaveLength(1);
    expect(agenda.days.flatMap((d) => d.entries)).toHaveLength(0);
  });

  it("leaves overdue tasks in their day bucket when overdue is suppressed", () => {
    const agenda = buildAgenda([task({ when_date: "2026-08-01" })], {
      ...base,
      startISO: "2026-08-01",
      days: 5,
      includeOverdue: false,
    });
    expect(agenda.overdue).toHaveLength(0);
    expect(agenda.days[0]!.entries).toHaveLength(1);
  });

  it("omits closed and undated tasks", () => {
    const agenda = buildAgenda(
      [
        task({ id: "done", when_date: TODAY, status: "done" }),
        task({ id: "undated" }),
      ],
      { ...base, startISO: TODAY, days: 1 }
    );
    expect(agenda.overdue).toHaveLength(0);
    expect(agenda.days[0]!.entries).toHaveLength(0);
  });
});

describe("renderAgenda", () => {
  it("states the day and timezone before anything else", () => {
    const text = renderAgenda(
      buildAgenda([], {
        todayISO: TODAY,
        timezone: "America/Los_Angeles",
        startISO: TODAY,
        days: 1,
      })
    );
    expect(text.split("\n")[0]).toBe(
      "Today is 2026-08-03 (Monday, today) in America/Los_Angeles."
    );
  });

  it("says an empty day is empty, and why undated work is missing", () => {
    const text = renderAgenda(
      buildAgenda([task()], {
        todayISO: TODAY,
        timezone: "UTC",
        startISO: TODAY,
        days: 1,
      })
    );
    expect(text).toContain("Nothing scheduled or due.");
    expect(text).toContain("list_tasks");
  });

  it("shows overdue work above the day sections", () => {
    const text = renderAgenda(
      buildAgenda(
        [
          task({ id: "late", title: "Renew insurance", when_date: "2026-07-28" }),
          task({ title: "Clean up desk", when_date: TODAY }),
        ],
        {
          todayISO: TODAY,
          timezone: "UTC",
          startISO: TODAY,
          days: 1,
        }
      )
    );
    expect(text.indexOf("## Overdue (1)")).toBeLessThan(
      text.indexOf("## 2026-08-03")
    );
    expect(text).toContain("Renew insurance");
    expect(text).toContain("6 days ago");
  });
});

describe("describeTask", () => {
  it("puts priority, dates and id on one line", () => {
    expect(describeTask(task({ id: "abc", when_date: TODAY }), TODAY)).toBe(
      "[p2] Clean up room — scheduled for 2026-08-03 (Monday, today) (id: abc)"
    );
  });
});
