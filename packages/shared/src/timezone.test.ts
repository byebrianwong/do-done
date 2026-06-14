import { describe, it, expect } from "vitest";
import { zonedClockToUtc } from "./timezone.js";

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
