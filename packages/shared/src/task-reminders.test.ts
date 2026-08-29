import { describe, expect, it } from "vitest";
import type { NotificationSettings, Task } from "./schemas.js";
import { NotificationSettingsSchema } from "./schemas.js";
import {
  applyLead,
  describeNotificationSchedule,
  buildDayStartRoundup,
  buildTaskReminder,
  describeLead,
  isRemindable,
  isUntimed,
  parseTaskClock,
  reminderAnchor,
  timedReminderClock,
} from "./task-reminders.js";

let seq = 0;
function task(over: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
    user_id: "00000000-0000-0000-0000-000000000002",
    title: `Task ${seq}`,
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

const settings = (over: Partial<NotificationSettings> = {}) =>
  NotificationSettingsSchema.parse(over);

describe("parseTaskClock", () => {
  it("reads the HH:MM the column is meant to hold", () => {
    expect(parseTaskClock("09:30")).toEqual({ hour: 9, minute: 30 });
    expect(parseTaskClock("00:00")).toEqual({ hour: 0, minute: 0 });
    expect(parseTaskClock("23:59")).toEqual({ hour: 23, minute: 59 });
  });

  it("tolerates the seconds the calendar pull can leave behind", () => {
    // scheduled_time is a free `text` column and Google's pull writes into it.
    // A reminder silently not arming over a trailing ":00" is the kind of
    // failure nobody reproduces.
    expect(parseTaskClock("09:30:00")).toEqual({ hour: 9, minute: 30 });
    expect(parseTaskClock(" 9:05 ")).toEqual({ hour: 9, minute: 5 });
  });

  it("is null for a missing or unreadable time", () => {
    for (const bad of [null, undefined, "", "noon", "24:00", "12:60"]) {
      expect(parseTaskClock(bad)).toBeNull();
    }
  });
});

describe("reminderAnchor", () => {
  it("prefers the scheduled pair over the deadline", () => {
    const t = task({
      scheduled_date: "2026-08-24",
      scheduled_time: "09:00",
      deadline_date: "2026-08-26",
      deadline_time: "17:00",
    });
    expect(reminderAnchor(t)).toEqual({
      dateISO: "2026-08-24",
      time: "09:00",
      from: "scheduled",
    });
  });

  it("falls through to a deadline when nothing is scheduled", () => {
    const t = task({ deadline_date: "2026-08-26", deadline_time: "17:00" });
    expect(reminderAnchor(t)?.from).toBe("deadline");
  });

  it("is null for an undated task", () => {
    expect(reminderAnchor(task())).toBeNull();
  });
});

describe("isRemindable", () => {
  it("takes an open, dated, non-list task", () => {
    expect(isRemindable(task({ scheduled_date: "2026-08-24" }))).toBe(true);
  });

  it("never announces a shopping-list item", () => {
    // The loudest surface in the app is the last place a tin of tomatoes
    // should turn up. CLAUDE.md → Shopping lists.
    const item = task({ scheduled_date: "2026-08-24", is_list_item: true });
    expect(isRemindable(item)).toBe(false);
  });

  it("skips closed work", () => {
    for (const status of ["done", "cancelled", "archived"] as const) {
      expect(isRemindable(task({ scheduled_date: "2026-08-24", status }))).toBe(
        false
      );
    }
  });

  it("skips an undated task", () => {
    expect(isRemindable(task())).toBe(false);
  });
});

describe("applyLead", () => {
  it("subtracts within the day", () => {
    expect(applyLead("2026-08-24", 9, 0, 15)).toEqual({
      dateISO: "2026-08-24",
      hour: 8,
      minute: 45,
    });
  });

  it("rolls into the previous day rather than clamping at midnight", () => {
    expect(applyLead("2026-08-24", 0, 15, 30)).toEqual({
      dateISO: "2026-08-23",
      hour: 23,
      minute: 45,
    });
  });

  it("crosses a month boundary correctly", () => {
    expect(applyLead("2026-09-01", 0, 10, 60)).toEqual({
      dateISO: "2026-08-31",
      hour: 23,
      minute: 10,
    });
  });

  it("is the identity at zero lead", () => {
    expect(applyLead("2026-08-24", 9, 0, 0)).toEqual({
      dateISO: "2026-08-24",
      hour: 9,
      minute: 0,
    });
  });
});

describe("timedReminderClock", () => {
  it("is null for a task with a day but no time — the roundup's job", () => {
    const t = task({ scheduled_date: "2026-08-24" });
    expect(timedReminderClock(t, settings())).toBeNull();
    expect(isUntimed(t)).toBe(true);
  });

  it("applies the user's lead", () => {
    const t = task({ scheduled_date: "2026-08-24", scheduled_time: "14:00" });
    expect(
      timedReminderClock(t, settings({ notify_task_reminder_lead_minutes: 30 }))
    ).toEqual({ dateISO: "2026-08-24", hour: 13, minute: 30 });
  });

  it("uses a deadline time when there is no scheduled one", () => {
    const t = task({ deadline_date: "2026-08-26", deadline_time: "17:00" });
    expect(timedReminderClock(t, settings())).toEqual({
      dateISO: "2026-08-26",
      hour: 17,
      minute: 0,
    });
  });
});

describe("describeLead", () => {
  it("says nothing at zero — a bare time reads as the task itself", () => {
    expect(describeLead(0)).toBeNull();
  });

  it("words minutes and whole hours", () => {
    expect(describeLead(10)).toBe("in 10 min");
    expect(describeLead(60)).toBe("in 1 hr");
    expect(describeLead(120)).toBe("in 2 hrs");
    expect(describeLead(90)).toBe("in 90 min");
  });
});

describe("buildTaskReminder", () => {
  it("puts the task title in the title, unprefixed", () => {
    // The OS already shows the app name. The line is worth the task, not "DoDone".
    const t = task({
      title: "Standup",
      scheduled_date: "2026-08-24",
      scheduled_time: "09:00",
    });
    const c = buildTaskReminder(t, { leadMinutes: 0 });
    expect(c.title).toBe("Standup");
    expect(c.body).toBe("9:00 AM");
  });

  it("distinguishes now from soon", () => {
    const t = task({ scheduled_date: "2026-08-24", scheduled_time: "09:00" });
    expect(buildTaskReminder(t, { leadMinutes: 10 }).body).toBe(
      "9:00 AM — in 10 min"
    );
  });

  it("says when the moment is a deadline rather than a plan", () => {
    const t = task({ deadline_date: "2026-08-26", deadline_time: "17:00" });
    const c = buildTaskReminder(t, { leadMinutes: 0, projectName: "Work" });
    expect(c.body).toBe("5:00 PM · Deadline · Work");
  });
});

describe("buildDayStartRoundup", () => {
  const day = "2026-08-24";

  it("names only the untimed tasks of that day", () => {
    const c = buildDayStartRoundup(
      [
        task({ title: "Buy milk", scheduled_date: day }),
        task({ title: "Call bank", scheduled_date: day }),
        // Timed — announced at its own time, so it must not be named here too.
        task({ title: "Standup", scheduled_date: day, scheduled_time: "09:00" }),
        // Another day.
        task({ title: "Later", scheduled_date: "2026-08-25" }),
      ],
      day
    );
    expect(c?.title).toBe("Today · 2 tasks");
    expect(c?.body).toContain("Buy milk");
    expect(c?.body).toContain("Call bank");
    expect(c?.body).not.toContain("Standup");
    expect(c?.body).not.toContain("Later");
  });

  it("leaves overdue work to the digest, so it cannot grow without bound", () => {
    const c = buildDayStartRoundup(
      [task({ title: "Slipped", scheduled_date: "2026-08-01" })],
      day
    );
    expect(c).toBeNull();
  });

  it("collapses past three titles", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      task({ title: `T${i}`, scheduled_date: day, sort_order: i })
    );
    const c = buildDayStartRoundup(many, day);
    expect(c?.title).toBe("Today · 6 tasks");
    expect(c?.body).toContain("+3 more");
  });

  it("leads with the ranks someone deliberately chose", () => {
    const c = buildDayStartRoundup(
      [
        task({ title: "Low", scheduled_date: day, sort_order: 0 }),
        task({ title: "Urgent", scheduled_date: day, priority: "p1", sort_order: 9 }),
      ],
      day
    );
    expect(c?.body.indexOf("Urgent")).toBeLessThan(c!.body.indexOf("Low"));
    expect(c?.body).toContain("1 high priority");
  });

  it("is null for a day with nothing untimed on it", () => {
    expect(buildDayStartRoundup([], day)).toBeNull();
    expect(
      buildDayStartRoundup(
        [task({ scheduled_date: day, scheduled_time: "09:00" })],
        day
      )
    ).toBeNull();
  });

  it("never names a shopping-list item", () => {
    expect(
      buildDayStartRoundup(
        [task({ title: "Bananas", scheduled_date: day, is_list_item: true })],
        day
      )
    ).toBeNull();
  });
});

describe("describeNotificationSchedule", () => {
  it("is Off when nothing is switched on", () => {
    expect(describeNotificationSchedule(settings())).toBe("Off");
  });

  it("names task reminders on their own", () => {
    // The Settings row is labelled "Digests and reminders"; before this it
    // read "Off" to someone who had just turned reminders on.
    expect(
      describeNotificationSchedule(settings({ notify_task_reminders: true }))
    ).toBe("Task reminders");
  });

  it("joins reminders and a digest", () => {
    expect(
      describeNotificationSchedule(
        settings({ notify_task_reminders: true, notify_daily_digest: true })
      )
    ).toBe("Task reminders · Daily at 8:00 AM");
  });

  it("still describes digests alone", () => {
    expect(
      describeNotificationSchedule(settings({ notify_daily_digest: true }))
    ).toBe("Daily at 8:00 AM");
  });
});
