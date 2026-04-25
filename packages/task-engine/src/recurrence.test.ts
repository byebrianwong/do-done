import { describe, expect, it } from "vitest";
import { detectRecurrence, formatRrule } from "./recurrence.js";

describe("detectRecurrence", () => {
  it("detects daily", () => {
    expect(detectRecurrence("daily standup")?.rrule).toBe("FREQ=DAILY");
    expect(detectRecurrence("water plants every day")?.rrule).toBe(
      "FREQ=DAILY"
    );
  });

  it("detects weekly", () => {
    expect(detectRecurrence("weekly review")?.rrule).toBe("FREQ=WEEKLY");
    expect(detectRecurrence("groceries every week")?.rrule).toBe(
      "FREQ=WEEKLY"
    );
  });

  it("detects monthly and yearly", () => {
    expect(detectRecurrence("rent monthly")?.rrule).toBe("FREQ=MONTHLY");
    expect(detectRecurrence("birthday yearly")?.rrule).toBe("FREQ=YEARLY");
    expect(detectRecurrence("anniversary annually")?.rrule).toBe(
      "FREQ=YEARLY"
    );
  });

  it("detects specific days of the week", () => {
    expect(detectRecurrence("workout every monday")?.rrule).toBe(
      "FREQ=WEEKLY;BYDAY=MO"
    );
    expect(detectRecurrence("date night every friday")?.rrule).toBe(
      "FREQ=WEEKLY;BYDAY=FR"
    );
  });

  it("detects multiple days", () => {
    const result = detectRecurrence("yoga every monday and wednesday");
    expect(result?.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
  });

  it("detects weekdays and weekends", () => {
    expect(detectRecurrence("commute every weekday")?.rrule).toBe(
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
    );
    expect(detectRecurrence("hike every weekend")?.rrule).toBe(
      "FREQ=WEEKLY;BYDAY=SA,SU"
    );
  });

  it("detects intervals", () => {
    expect(detectRecurrence("payday every 2 weeks")?.rrule).toBe(
      "FREQ=WEEKLY;INTERVAL=2"
    );
    expect(detectRecurrence("biweekly retro")?.rrule).toBe(
      "FREQ=WEEKLY;INTERVAL=2"
    );
    expect(detectRecurrence("dentist every 6 months")?.rrule).toBe(
      "FREQ=MONTHLY;INTERVAL=6"
    );
  });

  it("returns null for non-recurring", () => {
    expect(detectRecurrence("buy milk tomorrow")).toBeNull();
    expect(detectRecurrence("call mom")).toBeNull();
  });

  it("returns the matched substring for stripping", () => {
    const result = detectRecurrence("yoga every monday at 7am");
    expect(result?.matched.toLowerCase()).toContain("every monday");
  });
});

describe("formatRrule", () => {
  it("formats common rules", () => {
    expect(formatRrule("FREQ=DAILY")).toBe("Daily");
    expect(formatRrule("FREQ=WEEKLY")).toBe("Weekly");
    expect(formatRrule("FREQ=MONTHLY")).toBe("Monthly");
    expect(formatRrule("FREQ=YEARLY")).toBe("Yearly");
  });

  it("formats day-specific weekly", () => {
    expect(formatRrule("FREQ=WEEKLY;BYDAY=MO")).toBe("Mon");
    expect(formatRrule("FREQ=WEEKLY;BYDAY=MO,WE,FR")).toBe("Mon, Wed, Fri");
  });

  it("formats weekdays and weekends", () => {
    expect(formatRrule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")).toBe("Weekdays");
    expect(formatRrule("FREQ=WEEKLY;BYDAY=SA,SU")).toBe("Weekends");
  });

  it("formats intervals", () => {
    expect(formatRrule("FREQ=DAILY;INTERVAL=2")).toBe("Every 2 days");
    expect(formatRrule("FREQ=WEEKLY;INTERVAL=2")).toBe("Every 2 weeks");
    expect(formatRrule("FREQ=MONTHLY;INTERVAL=6")).toBe("Every 6 months");
  });
});
