import { describe, it, expect } from "vitest";
import { parseTaskInput } from "./parser.js";

const REF_DATE = new Date("2026-04-12T10:00:00");

describe("parseTaskInput", () => {
  it('extracts title, scheduled_date, and scheduled_time from "buy milk tomorrow at 3pm"', () => {
    const result = parseTaskInput("buy milk tomorrow at 3pm", REF_DATE);
    expect(result.title).toBe("buy milk");
    expect(result.scheduled_date).toBe("2026-04-13");
    expect(result.scheduled_time).toBe("15:00");
    expect(result.deadline_date).toBeUndefined();
    expect(result.deadline_time).toBeUndefined();
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
    expect(result.scheduled_date).toBeUndefined();
    expect(result.deadline_date).toBeUndefined();
    expect(result.deadline_time).toBeUndefined();
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

  // A typed date is the day the user plans to DO the task. Only the words
  // "due" and "deadline" produce a deadline_date — see the note on
  // DEADLINE_MARKER_PATTERN in parser.ts.
  describe("scheduled vs deadline", () => {
    it.each([
      ["ship widget friday", "2026-04-17"],
      ["ship widget on friday", "2026-04-17"],
      ["ship widget next monday", "2026-04-13"],
      ["ship widget apr 20", "2026-04-20"],
    ])("%s → scheduled_date", (input, date) => {
      const result = parseTaskInput(input, REF_DATE);
      expect(result.scheduled_date).toBe(date);
      expect(result.deadline_date).toBeUndefined();
      expect(result.title).toBe("ship widget");
    });

    it.each([
      "ship widget due friday",
      "ship widget due by friday",
      "ship widget due on friday",
      "ship widget deadline friday",
      "ship widget deadline: friday",
      "ship widget due date friday",
    ])('"%s" → deadline_date, and the marker leaves the title', (input) => {
      const result = parseTaskInput(input, REF_DATE);
      expect(result.deadline_date).toBe("2026-04-17");
      expect(result.scheduled_date).toBeUndefined();
      expect(result.title).toBe("ship widget");
    });

    it('"by friday" alone is a schedule, not a deadline', () => {
      const result = parseTaskInput("ship widget by friday", REF_DATE);
      expect(result.scheduled_date).toBe("2026-04-17");
      expect(result.deadline_date).toBeUndefined();
    });

    it("carries the time onto whichever field the date landed on", () => {
      const scheduled = parseTaskInput("standup friday 9am", REF_DATE);
      expect(scheduled.scheduled_time).toBe("09:00");
      expect(scheduled.deadline_time).toBeUndefined();

      const deadline = parseTaskInput("file taxes due friday 5pm", REF_DATE);
      expect(deadline.deadline_time).toBe("17:00");
      expect(deadline.scheduled_time).toBeUndefined();
    });

    it("reads a schedule and a deadline out of one sentence", () => {
      const result = parseTaskInput("draft memo tomorrow, due friday", REF_DATE);
      expect(result.scheduled_date).toBe("2026-04-13");
      expect(result.deadline_date).toBe("2026-04-17");
      expect(result.title).toBe("draft memo,");
    });

    it("a second date of the same kind stays in the title", () => {
      const result = parseTaskInput("compare tomorrow and friday", REF_DATE);
      expect(result.scheduled_date).toBe("2026-04-13");
      expect(result.title).toBe("compare and friday");
    });

    it('a bare "due"/"deadline" with no date is left alone', () => {
      const result = parseTaskInput("pay membership dues", REF_DATE);
      expect(result.deadline_date).toBeUndefined();
      expect(result.scheduled_date).toBeUndefined();
      expect(result.title).toBe("pay membership dues");
    });
  });

  describe("when-slash commands", () => {
    // REF_DATE (2026-04-12) is a Sunday.
    it("/today → scheduled_date of today (no deadline_date)", () => {
      const result = parseTaskInput("/today ship widget", REF_DATE);
      expect(result.scheduled_date).toBe("2026-04-12");
      expect(result.deadline_date).toBeUndefined();
      expect(result.title).toBe("ship widget");
    });

    it("/tomorrow → scheduled_date of tomorrow", () => {
      const result = parseTaskInput("/tomorrow review PR", REF_DATE);
      expect(result.scheduled_date).toBe("2026-04-13");
      expect(result.title).toBe("review PR");
    });

    it("/week → scheduled_date of this Friday", () => {
      const result = parseTaskInput("/week clean inbox", REF_DATE);
      expect(result.scheduled_date).toBe("2026-04-17");
      expect(result.title).toBe("clean inbox");
    });

    it("/this-week → scheduled_date of this Friday", () => {
      const result = parseTaskInput("/this-week clean inbox", REF_DATE);
      expect(result.scheduled_date).toBe("2026-04-17");
    });

    it("/next-week → scheduled_date exactly 7 days out", () => {
      const result = parseTaskInput("/next-week plan offsite", REF_DATE);
      expect(result.scheduled_date).toBe("2026-04-19");
      expect(result.title).toBe("plan offsite");
    });

    it("/weekend → scheduled_date of the upcoming Sunday", () => {
      const result = parseTaskInput("/weekend call mom", REF_DATE);
      expect(result.scheduled_date).toBe("2026-04-12");
      expect(result.title).toBe("call mom");
    });

    it("/later and /someday are no longer scheduling commands", () => {
      const result = parseTaskInput("/later refactor parser", REF_DATE);
      expect(result.scheduled_date).toBeUndefined();
      // Stays reserved so it isn't misparsed as a project named "later".
      expect(result.project).toBeUndefined();
    });

    it("the first matching /date command wins when several are present", () => {
      const result = parseTaskInput("/today /week ship widget", REF_DATE);
      expect(result.scheduled_date).toBe("2026-04-12");
    });

    it("combines /today with p1 and #tag", () => {
      const result = parseTaskInput("/today p1 #urgent ship widget", REF_DATE);
      expect(result.scheduled_date).toBe("2026-04-12");
      expect(result.priority).toBe("p1");
      expect(result.tags).toEqual(["urgent"]);
      expect(result.title).toBe("ship widget");
    });

    it('plain "tomorrow" goes to scheduled_date via chrono (no slash)', () => {
      const result = parseTaskInput("review PR tomorrow", REF_DATE);
      expect(result.scheduled_date).toBe("2026-04-13");
      expect(result.deadline_date).toBeUndefined();
    });

    it('"/today" and a "due" date coexist on different fields', () => {
      const result = parseTaskInput("/today ship widget due tomorrow", REF_DATE);
      expect(result.scheduled_date).toBe("2026-04-12");
      expect(result.deadline_date).toBe("2026-04-13");
      expect(result.title).toBe("ship widget");
    });

    it("a /slash command keeps the day, and a typed time still applies to it", () => {
      const result = parseTaskInput("/tomorrow call mum at 3pm", REF_DATE);
      expect(result.scheduled_date).toBe("2026-04-13");
      expect(result.scheduled_time).toBe("15:00");
      expect(result.deadline_date).toBeUndefined();
      expect(result.title).toBe("call mum");
    });

    it("reserved slash tokens do NOT get treated as project names", () => {
      const result = parseTaskInput("/tomorrow ship", REF_DATE);
      expect(result.project).toBeUndefined();
      expect(result.scheduled_date).toBe("2026-04-13");
      expect(result.title).toBe("ship");
    });

    it("a real project name still parses after when-slash extraction", () => {
      const result = parseTaskInput("/today review PR /engineering", REF_DATE);
      expect(result.scheduled_date).toBe("2026-04-12");
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

  describe("URLs in the title", () => {
    it("keeps a full https URL — the scheme's // is not a /project", () => {
      const result = parseTaskInput(
        "Buy dog food https://www.example.com/",
        REF_DATE
      );
      expect(result.title).toBe("Buy dog food https://www.example.com/");
      expect(result.project).toBeUndefined();
    });

    it("does not mistake a URL path for a project", () => {
      const result = parseTaskInput(
        "read docs https://example.com/guide/intro",
        REF_DATE
      );
      expect(result.title).toBe("read docs https://example.com/guide/intro");
      expect(result.project).toBeUndefined();
    });

    it("does not read a URL #fragment as a tag", () => {
      const result = parseTaskInput(
        "check https://example.com/page#section",
        REF_DATE
      );
      expect(result.title).toBe("check https://example.com/page#section");
      expect(result.tags).toBeUndefined();
    });

    it("preserves a http (non-secure) URL", () => {
      const result = parseTaskInput("ping http://localhost:3000/api", REF_DATE);
      expect(result.title).toBe("ping http://localhost:3000/api");
    });

    it("preserves a bare www. URL", () => {
      const result = parseTaskInput("visit www.example.com/x", REF_DATE);
      expect(result.title).toBe("visit www.example.com/x");
    });

    it("a URL-only input becomes the title", () => {
      const result = parseTaskInput("https://example.com/a/b", REF_DATE);
      expect(result.title).toBe("https://example.com/a/b");
    });

    it("keeps two URLs in order", () => {
      const result = parseTaskInput(
        "compare https://a.com/x and https://b.com/y",
        REF_DATE
      );
      expect(result.title).toBe("compare https://a.com/x and https://b.com/y");
    });

    it("still extracts a real /project typed alongside a URL", () => {
      const result = parseTaskInput(
        "read https://example.com/docs /engineering",
        REF_DATE
      );
      expect(result.project).toBe("engineering");
      expect(result.title).toBe("read https://example.com/docs");
    });

    it("still extracts priority and a date around a URL", () => {
      const result = parseTaskInput(
        "p1 order https://shop.example.com/item tomorrow",
        REF_DATE
      );
      expect(result.priority).toBe("p1");
      expect(result.scheduled_date).toBe("2026-04-13");
      expect(result.title).toBe("order https://shop.example.com/item");
    });
  });

  describe("#project matching", () => {
    const PROJECTS = [
      { id: "p-home", name: "Home" },
      { id: "p-side", name: "Side Project" },
      { id: "p-work", name: "work" },
    ];

    it("files a #token that names a project, instead of tagging it", () => {
      const result = parseTaskInput("fix the sink #home", REF_DATE, {
        projects: PROJECTS,
      });
      expect(result.project_id).toBe("p-home");
      expect(result.project).toBe("Home");
      expect(result.tags).toBeUndefined();
      expect(result.title).toBe("fix the sink");
    });

    it("leaves a #token matching no project as a tag", () => {
      const result = parseTaskInput("fix the sink #plumbing", REF_DATE, {
        projects: PROJECTS,
      });
      expect(result.project_id).toBeUndefined();
      expect(result.tags).toEqual(["plumbing"]);
    });

    it("is case- and punctuation-insensitive, so multi-word names are reachable", () => {
      expect(
        parseTaskInput("ship it #SideProject", REF_DATE, { projects: PROJECTS })
          .project_id
      ).toBe("p-side");
      expect(
        parseTaskInput("ship it #side_project", REF_DATE, { projects: PROJECTS })
          .project_id
      ).toBe("p-side");
    });

    it("keeps tags and a project apart in one string", () => {
      const result = parseTaskInput("call bob #work #urgent", REF_DATE, {
        projects: PROJECTS,
      });
      expect(result.project_id).toBe("p-work");
      expect(result.tags).toEqual(["urgent"]);
      expect(result.title).toBe("call bob");
    });

    it("takes the first project token and tags the rest", () => {
      const result = parseTaskInput("plan #home #work", REF_DATE, {
        projects: PROJECTS,
      });
      expect(result.project_id).toBe("p-home");
      expect(result.tags).toEqual(["work"]);
    });

    it("lets the size and priority codes keep their meaning", () => {
      const result = parseTaskInput("ship it #m #p1", REF_DATE, {
        projects: [{ id: "p-m", name: "M" }, ...PROJECTS],
      });
      expect(result.duration_minutes).toBe(120);
      expect(result.priority).toBe("p1");
      expect(result.project_id).toBeUndefined();
    });

    it("resolves a /name against the project list too", () => {
      const result = parseTaskInput("review PR #home", REF_DATE, {
        projects: PROJECTS,
      });
      expect(result.project_id).toBe("p-home");
      const slash = parseTaskInput("review PR /home", REF_DATE, {
        projects: PROJECTS,
      });
      expect(slash.project_id).toBe("p-home");
      expect(slash.project).toBe("Home");
    });

    it("keeps a /name that matches nothing as a bare name", () => {
      const result = parseTaskInput("review PR /engineering", REF_DATE, {
        projects: PROJECTS,
      });
      expect(result.project).toBe("engineering");
      expect(result.project_id).toBeUndefined();
    });

    it("tags everything when no project list is supplied", () => {
      const result = parseTaskInput("fix the sink #home", REF_DATE);
      expect(result.tags).toEqual(["home"]);
      expect(result.project_id).toBeUndefined();
    });

    it("does not read a #fragment inside a URL as a project", () => {
      const result = parseTaskInput(
        "read https://example.com/a#home today",
        REF_DATE,
        { projects: PROJECTS }
      );
      expect(result.project_id).toBeUndefined();
      expect(result.title).toBe("read https://example.com/a#home");
    });
  });
});
