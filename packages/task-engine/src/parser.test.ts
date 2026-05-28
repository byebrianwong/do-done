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

  describe("when-slash commands", () => {
    it("/today → when_date of today (no due_date)", () => {
      const result = parseTaskInput("/today ship widget", REF_DATE);
      expect(result.when_date).toBe("2026-04-12");
      expect(result.when_bucket).toBeUndefined();
      expect(result.due_date).toBeUndefined();
      expect(result.title).toBe("ship widget");
    });

    it("/tomorrow → when_date of tomorrow", () => {
      const result = parseTaskInput("/tomorrow review PR", REF_DATE);
      expect(result.when_date).toBe("2026-04-13");
      expect(result.title).toBe("review PR");
    });

    it("/week → when_bucket = this_week", () => {
      const result = parseTaskInput("/week clean inbox", REF_DATE);
      expect(result.when_bucket).toBe("this_week");
      expect(result.when_date).toBeUndefined();
      expect(result.title).toBe("clean inbox");
    });

    it("/this-week → when_bucket = this_week", () => {
      const result = parseTaskInput("/this-week clean inbox", REF_DATE);
      expect(result.when_bucket).toBe("this_week");
    });

    it("/next-week → when_bucket = next_week", () => {
      const result = parseTaskInput("/next-week plan offsite", REF_DATE);
      expect(result.when_bucket).toBe("next_week");
      expect(result.title).toBe("plan offsite");
    });

    it("/later → when_bucket = later", () => {
      const result = parseTaskInput("/later refactor parser", REF_DATE);
      expect(result.when_bucket).toBe("later");
    });

    it("/someday → when_bucket = someday", () => {
      const result = parseTaskInput("/someday learn Rust", REF_DATE);
      expect(result.when_bucket).toBe("someday");
    });

    it("when_date wins if both a /date and /bucket would match (mutually exclusive)", () => {
      const result = parseTaskInput("/today /week ship widget", REF_DATE);
      expect(result.when_date).toBe("2026-04-12");
      expect(result.when_bucket).toBeUndefined();
    });

    it("combines /today with p1 and #tag", () => {
      const result = parseTaskInput("/today p1 #urgent ship widget", REF_DATE);
      expect(result.when_date).toBe("2026-04-12");
      expect(result.priority).toBe("p1");
      expect(result.tags).toEqual(["urgent"]);
      expect(result.title).toBe("ship widget");
    });

    it('plain "tomorrow" still goes to due_date via chrono (no slash)', () => {
      const result = parseTaskInput("review PR tomorrow", REF_DATE);
      expect(result.due_date).toBe("2026-04-13");
      expect(result.when_date).toBeUndefined();
    });

    it('plain "tomorrow" and "/today" can coexist on different fields', () => {
      const result = parseTaskInput("/today ship widget by tomorrow", REF_DATE);
      expect(result.when_date).toBe("2026-04-12");
      expect(result.due_date).toBe("2026-04-13");
    });

    it("reserved slash tokens do NOT get treated as project names", () => {
      const result = parseTaskInput("/tomorrow ship", REF_DATE);
      expect(result.project).toBeUndefined();
      expect(result.when_date).toBe("2026-04-13");
      expect(result.title).toBe("ship");
    });

    it("a real project name still parses after when-slash extraction", () => {
      const result = parseTaskInput("/today review PR /engineering", REF_DATE);
      expect(result.when_date).toBe("2026-04-12");
      expect(result.project).toBe("engineering");
      expect(result.title).toBe("review PR");
    });
  });

  describe("~estimate prefix", () => {
    it("~2h → duration_minutes = 120", () => {
      const result = parseTaskInput("ship widget ~2h", REF_DATE);
      expect(result.duration_minutes).toBe(120);
      expect(result.title).toBe("ship widget");
    });

    it("~30m → duration_minutes = 30", () => {
      const result = parseTaskInput("quick fix ~30m", REF_DATE);
      expect(result.duration_minutes).toBe(30);
    });

    it("~ with space (~ 1.5h) still parses", () => {
      const result = parseTaskInput("design ~ 1.5h", REF_DATE);
      expect(result.duration_minutes).toBe(90);
    });

    it('plain "1h" without ~ still works (backward compat)', () => {
      const result = parseTaskInput("meeting 1h", REF_DATE);
      expect(result.duration_minutes).toBe(60);
    });
  });

  describe("t-shirt-size hashtag shortcuts", () => {
    it("#xs → 30 min", () => {
      const result = parseTaskInput("triage tickets #xs", REF_DATE);
      expect(result.duration_minutes).toBe(30);
      expect(result.title).toBe("triage tickets");
      expect(result.tags ?? []).not.toContain("xs");
    });

    it("#s → 60 min", () => {
      const result = parseTaskInput("review PR #s", REF_DATE);
      expect(result.duration_minutes).toBe(60);
    });

    it("#m → 120 min", () => {
      const result = parseTaskInput("draft proposal #m", REF_DATE);
      expect(result.duration_minutes).toBe(120);
    });

    it("#l → 240 min", () => {
      const result = parseTaskInput("write spec #l", REF_DATE);
      expect(result.duration_minutes).toBe(240);
    });

    it("#xl → 480 min", () => {
      const result = parseTaskInput("ship feature #xl", REF_DATE);
      expect(result.duration_minutes).toBe(480);
    });

    it("#xxl → 960 min", () => {
      const result = parseTaskInput("rewrite engine #xxl", REF_DATE);
      expect(result.duration_minutes).toBe(960);
    });

    it("size shortcut coexists with #p2 priority", () => {
      const result = parseTaskInput("ship feature #p2 #m", REF_DATE);
      expect(result.priority).toBe("p2");
      expect(result.duration_minutes).toBe(120);
      expect(result.title).toBe("ship feature");
    });

    it("explicit ~2h overrides #xl shortcut", () => {
      // ~ prefix wins; #xl is left as a tag because shortcut already
      // consumed it before tag extraction, so the title is clean.
      const result = parseTaskInput("big task ~2h #xl", REF_DATE);
      expect(result.duration_minutes).toBe(120);
    });

    it("bare 's' in a title is NOT a size shortcut (requires #)", () => {
      const result = parseTaskInput("read s notes", REF_DATE);
      expect(result.duration_minutes).toBeUndefined();
    });
  });
});
