import { describe, it, expect } from "vitest";
import {
  addDaysLocalISO,
  calendarEventsOnDay,
  formatFullDate,
  formatRelativeDay,
  formatScheduleHint,
  formatWhenTime,
  linkifyText,
  nextWeekdayLocalISO,
  groupCalendarEventsByDay,
  resolveQuickSchedule,
  todayLocalISO,
} from "./utils.js";
import type { CalendarEvent } from "./schemas.js";

describe("formatFullDate", () => {
  const now = new Date("2026-07-03T10:00:00");

  it("spells out weekday, month, and ordinal day", () => {
    expect(formatFullDate("2026-07-03", now)).toBe("Friday, July 3rd");
    expect(formatFullDate("2026-07-01", now)).toBe("Wednesday, July 1st");
    expect(formatFullDate("2026-07-22", now)).toBe("Wednesday, July 22nd");
    expect(formatFullDate("2026-07-04", now)).toBe("Saturday, July 4th");
  });

  it("uses 'th' for the teens", () => {
    expect(formatFullDate("2026-07-11", now)).toBe("Saturday, July 11th");
    expect(formatFullDate("2026-07-13", now)).toBe("Monday, July 13th");
  });

  it("appends the year only when it differs from now", () => {
    expect(formatFullDate("2026-12-31", now)).toBe("Thursday, December 31st");
    expect(formatFullDate("2027-01-01", now)).toBe("Friday, January 1st, 2027");
  });

  it("returns the input unchanged when unparseable", () => {
    expect(formatFullDate("not a date", now)).toBe("not a date");
  });
});

describe("formatRelativeDay", () => {
  const now = new Date("2026-07-03T10:00:00");

  it("labels nearby days", () => {
    expect(formatRelativeDay("2026-07-03", now)).toBe("today");
    expect(formatRelativeDay("2026-07-04", now)).toBe("tomorrow");
    expect(formatRelativeDay("2026-07-02", now)).toBe("yesterday");
    expect(formatRelativeDay("2026-07-06", now)).toBe("in 3 days");
    expect(formatRelativeDay("2026-06-30", now)).toBe("3 days ago");
  });

  it("rolls up to weeks and months", () => {
    expect(formatRelativeDay("2026-07-10", now)).toBe("in 1 week");
    expect(formatRelativeDay("2026-07-17", now)).toBe("in 2 weeks");
    expect(formatRelativeDay("2026-08-05", now)).toBe("in 1 month");
    expect(formatRelativeDay("2026-06-19", now)).toBe("2 weeks ago");
  });

  it("returns empty string when unparseable", () => {
    expect(formatRelativeDay("not a date", now)).toBe("");
  });
});

describe("formatWhenTime", () => {
  it("formats afternoon times as 12-hour PM", () => {
    expect(formatWhenTime("15:00")).toBe("3:00 PM");
    expect(formatWhenTime("13:45")).toBe("1:45 PM");
  });

  it("formats morning times as 12-hour AM", () => {
    expect(formatWhenTime("09:30")).toBe("9:30 AM");
    expect(formatWhenTime("11:05")).toBe("11:05 AM");
  });

  it("maps midnight and noon to 12", () => {
    expect(formatWhenTime("00:05")).toBe("12:05 AM");
    expect(formatWhenTime("12:00")).toBe("12:00 PM");
  });

  it("returns the input unchanged when it isn't a parseable HH:MM", () => {
    expect(formatWhenTime("not a time")).toBe("not a time");
    expect(formatWhenTime("25:00")).toBe("25:00");
    expect(formatWhenTime("")).toBe("");
  });
});

describe("nextWeekdayLocalISO", () => {
  // 2026-06-17 is a Wednesday (dow 3).
  const wed = new Date(2026, 5, 17);

  it("returns the next occurrence of the weekday strictly ahead", () => {
    expect(nextWeekdayLocalISO(5, wed)).toBe("2026-06-19"); // Friday
    expect(nextWeekdayLocalISO(0, wed)).toBe("2026-06-21"); // Sunday
  });

  it("returns the same day when from already is that weekday", () => {
    expect(nextWeekdayLocalISO(3, wed)).toBe("2026-06-17"); // Wednesday
  });

  it("wraps to next week for weekdays earlier in the week", () => {
    expect(nextWeekdayLocalISO(1, wed)).toBe("2026-06-22"); // Monday
  });
});

describe("resolveQuickSchedule", () => {
  // 2026-06-17 is a Wednesday.
  const wed = new Date(2026, 5, 17);

  it("maps each friendly label to a concrete date", () => {
    expect(resolveQuickSchedule("today", wed)).toBe("2026-06-17");
    expect(resolveQuickSchedule("tomorrow", wed)).toBe("2026-06-18");
    expect(resolveQuickSchedule("this_week", wed)).toBe("2026-06-19"); // Friday
    expect(resolveQuickSchedule("this_weekend", wed)).toBe("2026-06-21"); // Sunday
    expect(resolveQuickSchedule("next_week", wed)).toBe("2026-06-24"); // +7
  });

  it("next_week is always exactly 7 days out", () => {
    expect(resolveQuickSchedule("next_week", wed)).toBe(addDaysLocalISO(7, wed));
  });

  it("defaults the reference date to today", () => {
    expect(resolveQuickSchedule("today")).toBe(todayLocalISO());
  });
});

describe("formatScheduleHint", () => {
  // 2026-06-17 is a Wednesday. Assertions recompute the expected label with the
  // same locale APIs so the test stays correct regardless of the CI locale —
  // what's under test is the today/tomorrow vs. full-date branching.
  const wed = new Date(2026, 5, 17);
  const weekday = (iso: string) =>
    new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "short",
    });
  const full = (iso: string) =>
    `${weekday(iso)} ${new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })}`;

  it("shows the weekday alone for today and tomorrow", () => {
    expect(formatScheduleHint("2026-06-17", wed)).toBe(weekday("2026-06-17"));
    expect(formatScheduleHint("2026-06-18", wed)).toBe(weekday("2026-06-18"));
  });

  it("adds month + day for dates beyond tomorrow", () => {
    expect(formatScheduleHint("2026-06-19", wed)).toBe(full("2026-06-19")); // Fri
    expect(formatScheduleHint("2026-06-24", wed)).toBe(full("2026-06-24")); // +7
  });

  it("returns the input unchanged when it isn't a parseable date", () => {
    expect(formatScheduleHint("not a date", wed)).toBe("not a date");
  });
});

describe("calendarEventsOnDay / groupCalendarEventsByDay", () => {
  const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
    id: "e1",
    calendar_id: "primary",
    calendar_name: null,
    color: null,
    title: "Event",
    all_day: false,
    start_date: null,
    end_date: null,
    start: null,
    end: null,
    location: null,
    html_link: null,
    ...over,
  });

  const timed = event({
    id: "timed",
    start: "2026-07-03T10:00:00-07:00",
    end: "2026-07-03T11:00:00-07:00",
  });
  const earlier = event({
    id: "earlier",
    start: "2026-07-03T08:00:00-07:00",
    end: "2026-07-03T08:30:00-07:00",
  });
  const allDay = event({
    id: "allday",
    all_day: true,
    start_date: "2026-07-03",
    end_date: "2026-07-04", // exclusive → July 3rd only
  });
  const multiDay = event({
    id: "multi",
    all_day: true,
    start_date: "2026-07-02",
    end_date: "2026-07-05", // exclusive → 2nd, 3rd, 4th
  });

  it("buckets timed events on their start's date portion", () => {
    expect(calendarEventsOnDay([timed], "2026-07-03").map((e) => e.id)).toEqual(
      ["timed"]
    );
    expect(calendarEventsOnDay([timed], "2026-07-04")).toEqual([]);
  });

  it("spans all-day events across [start_date, end_date) and sorts all-day first, then by start", () => {
    const events = [timed, earlier, allDay, multiDay];
    expect(calendarEventsOnDay(events, "2026-07-03").map((e) => e.id)).toEqual([
      "allday",
      "multi",
      "earlier",
      "timed",
    ]);
    expect(calendarEventsOnDay(events, "2026-07-04").map((e) => e.id)).toEqual([
      "multi",
    ]);
    expect(calendarEventsOnDay(events, "2026-07-05")).toEqual([]);
  });

  it("groupCalendarEventsByDay agrees with the per-day filter", () => {
    const events = [timed, earlier, allDay, multiDay];
    const grouped = groupCalendarEventsByDay(events);
    for (const day of ["2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"]) {
      expect((grouped.get(day) ?? []).map((e) => e.id)).toEqual(
        calendarEventsOnDay(events, day).map((e) => e.id)
      );
    }
    expect(grouped.has("2026-07-05")).toBe(false);
  });

  it("handles month boundaries when expanding multi-day events", () => {
    const spanning = event({
      id: "span",
      all_day: true,
      start_date: "2026-07-31",
      end_date: "2026-08-02",
    });
    const grouped = groupCalendarEventsByDay([spanning]);
    expect([...grouped.keys()].sort()).toEqual(["2026-07-31", "2026-08-01"]);
  });
});

describe("linkifyText", () => {
  it("splits a URL out of a title, keeping the surrounding text", () => {
    expect(linkifyText("Buy dog muzzle https://www.bigsnoofdoggear.com/")).toEqual([
      { type: "text", value: "Buy dog muzzle " },
      {
        type: "link",
        value: "https://www.bigsnoofdoggear.com/",
        href: "https://www.bigsnoofdoggear.com/",
      },
    ]);
  });

  it("returns a single text segment when there is no URL", () => {
    expect(linkifyText("Buy dog muzzle")).toEqual([
      { type: "text", value: "Buy dog muzzle" },
    ]);
  });

  it("returns nothing for an empty string", () => {
    expect(linkifyText("")).toEqual([]);
  });

  it("prepends https:// to a bare www. link for its href but not its label", () => {
    const [seg] = linkifyText("www.example.com");
    expect(seg).toEqual({
      type: "link",
      value: "www.example.com",
      href: "https://www.example.com",
    });
  });

  it("keeps an http:// scheme untouched", () => {
    const [seg] = linkifyText("ping http://localhost:3000/api");
    expect(seg).toEqual({ type: "text", value: "ping " });
    expect(linkifyText("ping http://localhost:3000/api")[1]).toEqual({
      type: "link",
      value: "http://localhost:3000/api",
      href: "http://localhost:3000/api",
    });
  });

  it("leaves trailing sentence punctuation as text, out of the link", () => {
    expect(linkifyText("see https://example.com.")).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "https://example.com", href: "https://example.com" },
      { type: "text", value: "." },
    ]);
  });

  it("trims an unbalanced closing paren but keeps balanced ones", () => {
    expect(linkifyText("(https://example.com)")).toEqual([
      { type: "text", value: "(" },
      { type: "link", value: "https://example.com", href: "https://example.com" },
      { type: "text", value: ")" },
    ]);
    const [seg] = linkifyText("https://en.wikipedia.org/wiki/Foo_(bar)");
    expect(seg).toEqual({
      type: "link",
      value: "https://en.wikipedia.org/wiki/Foo_(bar)",
      href: "https://en.wikipedia.org/wiki/Foo_(bar)",
    });
  });

  it("links every URL when several appear in one string", () => {
    expect(linkifyText("compare https://a.com/x and https://b.com/y")).toEqual([
      { type: "text", value: "compare " },
      { type: "link", value: "https://a.com/x", href: "https://a.com/x" },
      { type: "text", value: " and " },
      { type: "link", value: "https://b.com/y", href: "https://b.com/y" },
    ]);
  });

  it("preserves URL fragments and query strings inside the link", () => {
    const [seg] = linkifyText("https://example.com/page?q=1#section");
    expect(seg.href).toBe("https://example.com/page?q=1#section");
  });
});
