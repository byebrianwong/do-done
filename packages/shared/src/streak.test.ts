import { describe, it, expect } from "vitest";
import { completionDays, isStreakDay, streakLength } from "./streak.js";

/** A local timestamp for a given local day, so tests don't depend on the zone. */
function at(day: string, hour = 12): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, hour).toISOString();
}

describe("completionDays", () => {
  it("buckets timestamps into distinct local days, newest first", () => {
    expect(
      completionDays([at("2026-08-09"), at("2026-08-07"), at("2026-08-09", 20)])
    ).toEqual(["2026-08-09", "2026-08-07"]);
  });

  it("uses the reader's local day, not the UTC one", () => {
    // 11pm local on the 9th is the 10th in UTC for anywhere east of Greenwich.
    // The task belongs to the day the user was living in when they finished it.
    const late = at("2026-08-09", 23);
    expect(completionDays([late])).toEqual(["2026-08-09"]);
  });

  it("drops nulls and junk rather than throwing", () => {
    // This feeds an animation. A malformed row should cost a burst, not a page.
    expect(completionDays([null, undefined, "", "not-a-date", at("2026-08-09")]))
      .toEqual(["2026-08-09"]);
  });

  it("has no days at all for someone who has completed nothing", () => {
    expect(completionDays([])).toEqual([]);
  });
});

describe("streakLength", () => {
  it("counts a run ending today", () => {
    const days = ["2026-08-09", "2026-08-08", "2026-08-07"];
    expect(streakLength(days, "2026-08-09")).toBe(3);
  });

  it("counts a run ending yesterday, so mornings don't read as a broken streak", () => {
    // At 9am, before you have done anything, the streak is still three days —
    // it just hasn't been extended yet.
    const days = ["2026-08-08", "2026-08-07", "2026-08-06"];
    expect(streakLength(days, "2026-08-09")).toBe(3);
  });

  it("is zero once a day has been missed", () => {
    const days = ["2026-08-07", "2026-08-06"];
    expect(streakLength(days, "2026-08-09")).toBe(0);
  });

  it("stops at the gap rather than counting every day present", () => {
    const days = ["2026-08-09", "2026-08-08", "2026-08-05", "2026-08-04"];
    expect(streakLength(days, "2026-08-09")).toBe(2);
  });

  it("is zero for someone with no history", () => {
    expect(streakLength([], "2026-08-09")).toBe(0);
  });

  it("crosses a month boundary", () => {
    const days = ["2026-08-01", "2026-07-31", "2026-07-30"];
    expect(streakLength(days, "2026-08-01")).toBe(3);
  });
});

describe("isStreakDay — the completion that keeps the run alive", () => {
  it("fires on the first completion of a day whose predecessor had one", () => {
    expect(isStreakDay(["2026-08-08", "2026-08-07"], "2026-08-09")).toBe(true);
  });

  it("does not fire again later the same day", () => {
    // "Any completion on a day in a streak" describes nearly every completion
    // a user makes, and a rule that fires nearly always is not a gate.
    expect(
      isStreakDay(["2026-08-09", "2026-08-08"], "2026-08-09")
    ).toBe(false);
  });

  it("does not fire when today merely starts a run", () => {
    // A streak of one is just a Tuesday.
    expect(isStreakDay(["2026-08-05"], "2026-08-09")).toBe(false);
    expect(isStreakDay([], "2026-08-09")).toBe(false);
  });

  it("needs yesterday specifically, not merely something recent", () => {
    expect(isStreakDay(["2026-08-07", "2026-08-06"], "2026-08-09")).toBe(false);
  });

  it("crosses a month boundary", () => {
    expect(isStreakDay(["2026-07-31", "2026-07-30"], "2026-08-01")).toBe(true);
  });
});
