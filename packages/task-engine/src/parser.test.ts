import { describe, it, expect } from "vitest";
import { parseTaskInput } from "./parser.js";

const REF_DATE = new Date("2026-04-12T10:00:00");

describe("parseTaskInput", () => {
  it('extracts title, due_date, and due_time from "buy milk tomorrow at 3pm"', () => {
    const result = parseTaskInput("buy milk tomorrow at 3pm", REF_DATE);
    expect(result.title).toBe("buy milk");
    expect(result.due_date).toBe("2026-04-13");
    expect(result.due_time).toBe("15:00");
  });

  it('extracts priority, tag, and title from "deploy app p1 #work"', () => {
    const result = parseTaskInput("deploy app p1 #work", REF_DATE);
    expect(result.priority).toBe("p1");
    expect(result.tags).toContain("work");
    expect(result.title).toBe("deploy app");
  });

  it('extracts duration from "meeting 1.5h"', () => {
    const result = parseTaskInput("meeting 1.5h", REF_DATE);
    expect(result.duration_minutes).toBe(90);
    expect(result.title).toBe("meeting");
  });

  it('extracts project from "review PR /engineering"', () => {
    const result = parseTaskInput("review PR /engineering", REF_DATE);
    expect(result.project).toBe("engineering");
    expect(result.title).toBe("review PR");
  });

  it('returns just a title for plain text "hello world"', () => {
    const result = parseTaskInput("hello world", REF_DATE);
    expect(result.title).toBe("hello world");
    expect(result.due_date).toBeUndefined();
    expect(result.due_time).toBeUndefined();
    expect(result.priority).toBeUndefined();
    expect(result.project).toBeUndefined();
    expect(result.tags).toBeUndefined();
    expect(result.duration_minutes).toBeUndefined();
  });

  it("handles multiple tags", () => {
    const result = parseTaskInput("task #frontend #urgent", REF_DATE);
    expect(result.tags).toEqual(["frontend", "urgent"]);
    expect(result.title).toBe("task");
  });

  it("handles duration in minutes", () => {
    const result = parseTaskInput("standup 15min", REF_DATE);
    expect(result.duration_minutes).toBe(15);
  });
});
