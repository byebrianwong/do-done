import { describe, it, expect } from "vitest";
import {
  addDaysLocalISO,
  formatWhenTime,
  nextWeekdayLocalISO,
  resolveQuickSchedule,
  todayLocalISO,
} from "./utils.js";

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
