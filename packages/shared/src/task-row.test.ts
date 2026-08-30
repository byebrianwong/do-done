import { describe, expect, it } from "vitest";
import type { Task } from "./schemas.js";
import {
  recurrenceShortLabel,
  rowEstimate,
  rowGutter,
  rowSchedule,
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
  // P4 is the column default, so it is what an untriaged task carries — a
  // mark there would appear on nearly every row and say nothing.
  it("draws nothing for the tasks nobody triaged", () => {
    expect(rowGutter(task({ priority: "p4" }), NOW)).toBeNull();
  });

  it("marks every rank someone chose", () => {
    expect(rowGutter(task({ priority: "p1" }), NOW)).toBe("p1");
    expect(rowGutter(task({ priority: "p2" }), NOW)).toBe("p2");
    expect(rowGutter(task({ priority: "p3" }), NOW)).toBe("p3");
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

  // A bare "Fri" reads as a day of the week with no way to tell which one from
  // a list spanning several — the rule formatCompletedDate already follows.
  it("names the date as well as the weekday inside the coming week", () => {
    expect(shortDayLabel("2026-08-14", NOW)).toBe("Fri, Aug 14");
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

  // The regression this is here for: "Today" used to be swallowed wherever it
  // appeared, so on Inbox, All, a project or a search result a task scheduled
  // today rendered exactly like an undated one while tomorrow's said so.
  it("names today like any other day", () => {
    expect(
      rowSubline(task({ scheduled_date: "2026-08-12" }), { now: NOW })
    ).toEqual(["Today"]);
    expect(
      rowSubline(
        task({ scheduled_date: "2026-08-12", scheduled_time: "09:00" }),
        { now: NOW }
      )
    ).toEqual(["Today 9:00 AM"]);
  });

  // Hiding it is the surface's call, not the value's: a header reading
  // "Today", or the Today screen itself.
  it("drops the day only when the caller says it already named it", () => {
    expect(
      rowSubline(task({ scheduled_date: "2026-08-12" }), {
        now: NOW,
        hideScheduledDay: true,
      })
    ).toEqual([]);
    expect(
      rowSubline(
        task({ scheduled_date: "2026-08-13", scheduled_time: "09:00" }),
        { now: NOW, hideScheduledDay: true }
      )
    ).toEqual(["9:00 AM"]);
  });

  // "Overdue" names no day, so there is nothing for the row to be repeating —
  // and how late it is is the one thing those rows have to say.
  it("still prints an overdue task's age under a header that hides days", () => {
    expect(
      rowSubline(task({ scheduled_date: "2026-08-09" }), {
        now: NOW,
        hideScheduledDay: true,
      })
    ).toEqual(["3 days ago"]);
  });

  it("keeps the day for any other day", () => {
    expect(
      rowSubline(
        task({ scheduled_date: "2026-08-14", scheduled_time: "11:00" }),
        { now: NOW }
      )
    ).toEqual(["Fri, Aug 14 11:00 AM"]);
  });

  it("prints an overdue task's age rather than its date", () => {
    expect(
      rowSubline(task({ scheduled_date: "2026-08-09" }), { now: NOW })
    ).toEqual(["3 days ago"]);
  });

  it("names a deadline as a deadline", () => {
    expect(
      rowSubline(task({ deadline_date: "2026-08-14" }), { now: NOW })
    ).toEqual(["Deadline Fri, Aug 14"]);
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
    ).toEqual(["Today", "Repeats daily", "Home"]);
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

  // "Done today" is a sentence; "Done fri, aug 7" is a mangled date. Only the
  // relative words get lowercased, and a Completed list shows both at once.
  it("lowercases a relative completion label but not a real date", () => {
    const on = (d: Date) =>
      rowSubline(task({ status: "done", completed_at: d.toISOString() }), {
        now: NOW,
      })[0];

    expect(on(new Date(2026, 7, 12, 9, 12))).toBe("Done today");
    expect(on(new Date(2026, 7, 11, 9, 12))).toBe("Done yesterday");
    expect(on(new Date(2026, 7, 7, 9, 12))).toBe("Done Fri, Aug 7");
    expect(on(new Date(2026, 6, 30, 9, 12))).toBe("Done Jul 30");
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
    expect(rowSubline(t, { now: NOW })).toEqual(["Fri, Aug 14"]);
    expect(rowSubline(t, { now: NOW, projectName: null })).toEqual(["Fri, Aug 14"]);
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

describe("rowSchedule + hideSchedule", () => {
  // Why it is split out: what the line drops is exactly what
  // the column prints, so a caller that does both loses nothing and repeats
  // nothing. Asserted against the same task rather than two hand-written
  // strings, so the two can't drift apart in a future edit.
  it("prints exactly the part hideSchedule removes", () => {
    const t = task({
      scheduled_date: "2026-08-14",
      scheduled_time: "09:30",
      deadline_date: "2026-08-20",
      project_id: "p",
    });
    const full = rowSubline(t, { projectName: "Work", now: NOW });
    const without = rowSubline(t, {
      projectName: "Work",
      hideSchedule: true,
      now: NOW,
    });
    const column = rowSchedule(t, { now: NOW });

    expect(full[0]).toBe(column);
    expect(without).toEqual(full.slice(1));
  });

  it("keeps the deadline in the line — it is a different day", () => {
    const t = task({ scheduled_date: "2026-08-14", deadline_date: "2026-08-20" });
    expect(rowSubline(t, { hideSchedule: true, now: NOW })).toContain(
      "Deadline Aug 20"
    );
  });

  it("hands the column an overdue task's age, not its date", () => {
    const t = task({ scheduled_date: "2026-08-09" });
    expect(rowSchedule(t, { now: NOW })).toBe("3 days ago");
  });

  it("hands the column what a finished task says instead", () => {
    const t = task({
      status: "done",
      completed_at: new Date(2026, 7, 12, 8, 0).toISOString(),
    });
    expect(rowSchedule(t, { now: NOW })).toBe("Done today");
    // ...and the line then leads with the next fact rather than repeating it.
    expect(rowSubline(t, { hideSchedule: true, now: NOW })).not.toContain(
      "Done today"
    );
  });

  it("still drops the day when the surface already named it", () => {
    const t = task({ scheduled_date: "2026-08-12", scheduled_time: "15:00" });
    expect(rowSchedule(t, { hideScheduledDay: true, now: NOW })).toBe("3:00 PM");
  });

  it("returns an empty string for a task with no schedule at all", () => {
    expect(rowSchedule(task(), { now: NOW })).toBe("");
  });
});
