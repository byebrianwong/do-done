import { describe, it, expect } from "vitest";
import { formatWhenTime } from "./utils.js";

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
