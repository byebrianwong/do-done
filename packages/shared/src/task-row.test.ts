import { describe, expect, it } from "vitest";
import type { Task } from "./schemas.js";
import {
  recurrenceShortLabel,
  rowEstimate,
  rowGutter,
  rowSubline,
  shortDayLabel,
} from "./task-row.js";

// A fixed "now" so every relative label in here is deterministic.
const NOW = new Date(2026, 7, 12, 9, 41); // Wed 12 Aug 2026, local

function task(over: Partial<Task> = {}): Task {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    user_id: "00000000-0000-0000-0000-000000000002",
    title: "Reply to Sam about the Q3 handoff",
    description: null,
    status: "not_started",
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
    focus_override: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    completed_at: null,
    ...over,
  };
}

describe("rowGutter", () => {
  it("draws nothing for the tasks nobody triaged", () => {
    expect(rowGutter(task({ priority: "p4" }), NOW)).toBeNull();
    expect(rowGutter(task({ priority: "p3" }), NOW)).toBeNull();
  });

  it("marks P1 and P2", () => {
    expect(rowGutter(task({ priority: "p1" }), NOW)).toBe("p1");
    expect(rowGutter(task({ priority: "p2" }), NOW)).toBe("p2");
  });

  // The gutter is one slot, and being late is the more actionable fact: a P1
  // that is merely urgent still has time, an overdue one does not.
  it("lets overdue outrank priority", () => {
    const late = task({ priority: "p1", scheduled_date: "2026-08-09" });
    expect(rowGutter(late, NOW)).toBe("overdue");
  });

  it("goes quiet once a task is finished or dropped", () => {
    const done = task({
      priority: "p1",
      scheduled_date: "2026-08-09",
      status: "done",
    });
    expect(rowGutter(done, NOW)).toBeNull();
    expect(rowGutter({ ...done, status: "cancelled" }, NOW)).toBeNull();
  });
});

describe("shortDayLabel", () => {
  it("names the days worth naming", () => {
    expect(shortDayLabel("2026-08-12", NOW)).toBe("Today");
    expect(shortDayLabel("2026-08-13", NOW)).toBe("Tomorrow");
    expect(shortDayLabel("2026-08-11", NOW)).toBe("Yesterday");
  });

  it("uses a weekday inside the coming week and a date past it", () => {
    expect(shortDayLabel("2026-08-14", NOW)).toBe("Fri");
    expect(shortDayLabel("2026-08-27", NOW)).toBe("Aug 27");
  });

  it("gains a year once it leaves this one", () => {
    expect(shortDayLabel("2027-01-04", NOW)).toBe("Jan 4, 2027");
  });

  it("returns nothing for an unparseable date, so callers drop the part", () => {
    expect(shortDayLabel("not-a-date", NOW)).toBe("");
  });
});

describe("rowSubline", () => {
  // The whole discipline of the new row: absent fields take no space at all.
  it("says nothing about a task that has nothing to say", () => {
    expect(rowSubline(task(), { now: NOW })).toEqual([]);
  });

  // "Today" on every row of the Today screen is a label that has stopped
  // carrying information; the time is the part that still means something.
  it("drops the day for a task scheduled today, keeping the time", () => {
    expect(
      rowSubline(task({ scheduled_date: "2026-08-12" }), { now: NOW })
    ).toEqual([]);
    expect(
      rowSubline(
        task({ scheduled_date: "2026-08-12", scheduled_time: "09:00" }),
        { now: NOW }
      )
    ).toEqual(["9:00 AM"]);
  });

  it("keeps the day for any other day", () => {
    expect(
      rowSubline(
        task({ scheduled_date: "2026-08-14", scheduled_time: "11:00" }),
        { now: NOW }
      )
    ).toEqual(["Fri 11:00 AM"]);
  });

  it("prints an overdue task's age rather than its date", () => {
    expect(
      rowSubline(task({ scheduled_date: "2026-08-09" }), { now: NOW })
    ).toEqual(["3 days ago"]);
  });

  it("names a deadline as a deadline", () => {
    expect(
      rowSubline(task({ deadline_date: "2026-08-14" }), { now: NOW })
    ).toEqual(["Deadline Fri"]);
  });

  it("reads recurrence and project as prose", () => {
    expect(
      rowSubline(
        task({
          scheduled_date: "2026-08-12",
          recurrence_rule: "FREQ=DAILY",
        }),
        { now: NOW, projectName: "Home" }
      )
    ).toEqual(["Repeats daily", "Home"]);
  });

  // A finished task's scheduled date is no longer actionable, and printing it
  // would label most of a Completed list "3 days ago".
  it("says only when a finished task was finished", () => {
    const done = task({
      status: "done",
      scheduled_date: "2026-08-09",
      completed_at: new Date(2026, 7, 12, 9, 12).toISOString(),
    });
    expect(rowSubline(done, { now: NOW, projectName: "Work" })).toEqual([
      "Done today",
      "Work",
    ]);
  });

  it("keeps quiet about the statuses that are defaults", () => {
    expect(rowSubline(task({ status: "not_started" }), { now: NOW })).toEqual([]);
    expect(rowSubline(task({ status: "inbox" }), { now: NOW })).toEqual([]);
    expect(rowSubline(task({ status: "in_progress" }), { now: NOW })).toEqual([
      "In progress",
    ]);
  });

  it("leaves the project out when the caller withholds it", () => {
    const t = task({ scheduled_date: "2026-08-14" });
    expect(rowSubline(t, { now: NOW })).toEqual(["Fri"]);
    expect(rowSubline(t, { now: NOW, projectName: null })).toEqual(["Fri"]);
  });
});

describe("rowEstimate", () => {
  it("is empty unless an estimate was set", () => {
    expect(rowEstimate(task())).toBe("");
    expect(rowEstimate(task({ duration_minutes: 45 }))).toBe("45m");
    expect(rowEstimate(task({ duration_minutes: 120 }))).toBe("2h");
  });
});

describe("recurrenceShortLabel", () => {
  it("matches the presets the picker writes", () => {
    expect(recurrenceShortLabel(null)).toBe("None");
    expect(recurrenceShortLabel("FREQ=DAILY")).toBe("Daily");
    expect(recurrenceShortLabel("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")).toBe(
      "Weekdays"
    );
  });

  it("calls anything hand-written Custom", () => {
    expect(recurrenceShortLabel("FREQ=YEARLY;INTERVAL=2")).toBe("Custom");
  });
});
