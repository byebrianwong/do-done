import { describe, it, expect } from "vitest";
import { zonedClockToUtc, wallClockInZone, todayISOInZone } from "./timezone.js";

describe("zonedClockToUtc", () => {
  it("converts a New York summer wall time (EDT, UTC−4) to the right instant", () => {
    // 2026-06-15 is during daylight saving — EDT is UTC−4, so 9:00 → 13:00Z.
    const d = zonedClockToUtc(2026, 6, 15, 9, 0, "America/New_York");
    expect(d.toISOString()).toBe("2026-06-15T13:00:00.000Z");
  });

  it("converts a New York winter wall time (EST, UTC−5) to the right instant", () => {
    // 2026-01-15 is standard time — EST is UTC−5, so 9:00 → 14:00Z.
    const d = zonedClockToUtc(2026, 1, 15, 9, 0, "America/New_York");
    expect(d.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("handles a positive-offset zone (Tokyo, UTC+9)", () => {
    // 17:00 in Tokyo → 08:00Z same day.
    const d = zonedClockToUtc(2026, 6, 15, 17, 0, "Asia/Tokyo");
    expect(d.toISOString()).toBe("2026-06-15T08:00:00.000Z");
  });

  it("is exact on the day after a spring-forward DST transition", () => {
    // US DST began 2026-03-08. The next day is unambiguous EDT (UTC−4).
    const d = zonedClockToUtc(2026, 3, 9, 9, 0, "America/New_York");
    expect(d.toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });

  it("treats UTC as identity", () => {
    const d = zonedClockToUtc(2026, 6, 15, 9, 0, "UTC");
    expect(d.toISOString()).toBe("2026-06-15T09:00:00.000Z");
  });

  it("falls back to UTC for an invalid timezone string", () => {
    const d = zonedClockToUtc(2026, 6, 15, 9, 0, "Not/AZone");
    expect(d.toISOString()).toBe("2026-06-15T09:00:00.000Z");
  });
});

describe("wallClockInZone", () => {
  it("reads an instant as the user's local day/time (UTC−7, crosses midnight)", () => {
    // 06:00Z on the 16th is 23:00 on the 15th in Los Angeles (PDT).
    expect(
      wallClockInZone(new Date("2026-06-16T06:00:00.000Z"), "America/Los_Angeles")
    ).toEqual({ date: "2026-06-15", time: "23:00" });
  });

  it("reads an instant as the user's local day/time (UTC+9)", () => {
    // 00:00Z on the 15th is 09:00 on the 15th in Tokyo.
    expect(
      wallClockInZone(new Date("2026-06-15T00:00:00.000Z"), "Asia/Tokyo")
    ).toEqual({ date: "2026-06-15", time: "09:00" });
  });

  it("round-trips with zonedClockToUtc", () => {
    const tz = "America/Los_Angeles";
    const instant = zonedClockToUtc(2026, 6, 15, 13, 30, tz);
    expect(wallClockInZone(instant, tz)).toEqual({
      date: "2026-06-15",
      time: "13:30",
    });
  });
});

describe("todayISOInZone", () => {
  it("derives the zone-local calendar day from a fixed instant", () => {
    // 03:00Z on the 16th: still the 15th in LA, already the 16th in Tokyo.
    const now = new Date("2026-06-16T03:00:00.000Z");
    expect(todayISOInZone("America/Los_Angeles", now)).toBe("2026-06-15");
    expect(todayISOInZone("Asia/Tokyo", now)).toBe("2026-06-16");
  });
});
