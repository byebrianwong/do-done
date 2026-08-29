import { describe, expect, it } from "vitest";
import type { Task } from "./schemas.js";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  buildDailyDigest,
  buildWeeklyDigest,
  describeDigestSchedule,
  formatClockLabel,
  formatClockTime,
  isDigestEnabled,
  parseClockTime,
  parseNotificationSettings,
  shiftISO,
  weekdayOfISO,
} from "./notifications.js";

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

describe("clock times", () => {
  it("round-trips the storage form", () => {
    expect(parseClockTime("08:30")).toEqual({ hour: 8, minute: 30 });
    expect(formatClockTime(8, 30)).toBe("08:30");
    expect(formatClockTime(0, 0)).toBe("00:00");
  });

  it("rejects anything that isn't a 24-hour wall clock", () => {
    for (const bad of ["8:30", "24:00", "12:60", "", "08:30:00", "noon"]) {
      expect(parseClockTime(bad)).toBeNull();
    }
  });

  it("labels midnight and noon as 12, not 0", () => {
    expect(formatClockLabel("00:00")).toBe("12:00 AM");
    expect(formatClockLabel("12:00")).toBe("12:00 PM");
    expect(formatClockLabel("13:05")).toBe("1:05 PM");
  });
});

describe("date-only arithmetic", () => {
  // A date-only string names a calendar day with no instant attached. Reading
  // its weekday through local midnight puts every user west of Greenwich a day
  // out, which would name the wrong day in a whole week's digest.
  it("reads a weekday without going through local midnight", () => {
    expect(weekdayOfISO("2026-08-15")).toBe(6); // Saturday
    expect(weekdayOfISO("2026-08-17")).toBe(1); // Monday
  });

  it("shifts across a month boundary", () => {
    expect(shiftISO("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftISO("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("parseNotificationSettings", () => {
  it("defaults every digest off, so a deploy can't start notifying anyone", () => {
    expect(DEFAULT_NOTIFICATION_SETTINGS.notify_daily_digest).toBe(false);
    expect(DEFAULT_NOTIFICATION_SETTINGS.notify_weekly_digest).toBe(false);
    expect(isDigestEnabled(DEFAULT_NOTIFICATION_SETTINGS)).toBe(false);
  });

  it("reads a pre-migration row without switching anything on", () => {
    const settings = parseNotificationSettings({ timezone: "Europe/London" });
    expect(settings).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  // What the per-field .catch() is for: one unreadable field must not
  // silently switch off a digest the user turned on, because the only symptom
  // would be a notification that stops arriving.
  it("keeps the switches when one field is unreadable", () => {
    const settings = parseNotificationSettings({
      notify_daily_digest: true,
      notify_daily_digest_time: "8am",
    });
    expect(settings.notify_daily_digest).toBe(true);
    expect(settings.notify_daily_digest_time).toBe("08:00");
  });

  it("survives null", () => {
    expect(parseNotificationSettings(null)).toEqual(
      DEFAULT_NOTIFICATION_SETTINGS
    );
  });
});

describe("buildDailyDigest", () => {
  const TODAY = "2026-08-15";

  // Nothing to report means nothing is sent. A daily "you have no tasks" is
  // what teaches someone to swipe this app's notifications away unread — which
  // is also how they'd miss a location reminder.
  it("is silent on an empty day", () => {
    expect(buildDailyDigest([], TODAY)).toBeNull();
    expect(
      buildDailyDigest([task({ scheduled_date: "2026-08-20" })], TODAY)
    ).toBeNull();
  });

  it("ignores closed tasks and shopping-list items", () => {
    const tasks = [
      task({ scheduled_date: TODAY, status: "done" }),
      task({ scheduled_date: TODAY, status: "cancelled" }),
      task({ scheduled_date: TODAY, is_list_item: true }),
    ];
    expect(buildDailyDigest(tasks, TODAY)).toBeNull();
  });

  it("counts today's tasks and names them", () => {
    const digest = buildDailyDigest(
      [
        task({ title: "Ship the release", scheduled_date: TODAY }),
        task({ title: "Call the dentist", scheduled_date: TODAY }),
      ],
      TODAY
    );
    expect(digest?.title).toBe("Today · 2 tasks");
    expect(digest?.body).toBe("Ship the release · Call the dentist");
  });

  it("separates overdue from today in the title", () => {
    const digest = buildDailyDigest(
      [
        task({ scheduled_date: TODAY }),
        task({ scheduled_date: "2026-08-10" }),
        task({ scheduled_date: "2026-08-11" }),
      ],
      TODAY
    );
    expect(digest?.title).toBe("Today · 1 task, 2 overdue");
  });

  it("counts a deadline the same way a scheduled date counts", () => {
    const digest = buildDailyDigest(
      [task({ deadline_date: TODAY, title: "Submit the report" })],
      TODAY
    );
    expect(digest?.title).toBe("Today · 1 task");
    expect(digest?.body).toContain("Submit the report");
  });

  it("names overdue work before today's, and P1 before P4", () => {
    const digest = buildDailyDigest(
      [
        task({ title: "Low today", scheduled_date: TODAY, priority: "p4" }),
        task({ title: "Urgent today", scheduled_date: TODAY, priority: "p1" }),
        task({ title: "Late", scheduled_date: "2026-08-09", priority: "p3" }),
      ],
      TODAY
    );
    expect(digest?.body.startsWith("Late · Urgent today · Low today")).toBe(
      true
    );
  });

  it("collapses past three titles rather than listing a whole day", () => {
    const tasks = Array.from({ length: 6 }, (_, i) =>
      task({ title: `T${i}`, scheduled_date: TODAY })
    );
    const digest = buildDailyDigest(tasks, TODAY);
    expect(digest?.body).toContain("+3 more");
  });

  it("calls out high-priority work when there is any", () => {
    const digest = buildDailyDigest(
      [task({ scheduled_date: TODAY, priority: "p2" })],
      TODAY
    );
    expect(digest?.body).toContain("1 high priority");
  });
});

describe("buildWeeklyDigest", () => {
  const MON = "2026-08-17";
  const SUN = "2026-08-23";

  it("is silent on an empty week", () => {
    expect(buildWeeklyDigest([], MON, SUN)).toBeNull();
  });

  it("counts the week and shapes it by day", () => {
    const digest = buildWeeklyDigest(
      [
        task({ scheduled_date: MON }),
        task({ scheduled_date: MON }),
        task({ scheduled_date: "2026-08-19" }),
      ],
      MON,
      SUN
    );
    expect(digest?.title).toBe("This week · 3 tasks");
    expect(digest?.body).toBe("Mon 2 · Wed 1");
  });

  // Printing "Thu 0" spends the line on the days that need no attention.
  it("leaves out the days with nothing on them", () => {
    const digest = buildWeeklyDigest([task({ scheduled_date: SUN })], MON, SUN);
    expect(digest?.body).toBe("Sun 1");
  });

  it("reports overdue work carried into the week", () => {
    const digest = buildWeeklyDigest(
      [task({ scheduled_date: "2026-08-10" }), task({ scheduled_date: MON })],
      MON,
      SUN
    );
    expect(digest?.title).toBe("This week · 1 task, 1 overdue");
  });

  // A task outside the window still counts as overdue, so the digest is worth
  // sending even when the week itself is clear.
  it("sends for overdue work alone", () => {
    const digest = buildWeeklyDigest(
      [task({ scheduled_date: "2026-08-01" })],
      MON,
      SUN
    );
    expect(digest?.title).toBe("This week · 1 overdue");
    expect(digest?.body).toBe("Nothing scheduled — clear week");
  });

  it("buckets a task on the day it is scheduled, not its deadline", () => {
    const digest = buildWeeklyDigest(
      [task({ scheduled_date: MON, deadline_date: SUN })],
      MON,
      SUN
    );
    expect(digest?.body).toBe("Mon 1");
  });
});

describe("describeDigestSchedule", () => {
  it("says Off when neither is on", () => {
    expect(describeDigestSchedule(DEFAULT_NOTIFICATION_SETTINGS)).toBe("Off");
  });

  it("names both schedules", () => {
    expect(
      describeDigestSchedule({
        notify_daily_digest: true,
        notify_daily_digest_time: "07:30",
        notify_weekly_digest: true,
        notify_weekly_digest_weekday: 1,
        notify_weekly_digest_time: "18:00",
      })
    ).toBe("Daily at 7:30 AM · Mondays at 6:00 PM");
  });
});
