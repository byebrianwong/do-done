import { describe, it, expect } from "vitest";
import { parseTaskInput } from "@do-done/task-engine";
import { todayLocalISO } from "@do-done/shared";
import {
  applyOverride,
  buildCreateInput,
  contextFacets,
  seedFromDrop,
  seedFromPathname,
  seedFromUpcomingDate,
  type QuickAddSeed,
} from "./quick-add";

// Fixed reference so chrono-derived deadlines are deterministic.
const REF = new Date("2026-06-16T12:00:00");

describe("buildCreateInput — merge precedence", () => {
  it("takes the title from the parsed input", () => {
    expect(buildCreateInput("call mom", {}, REF).title).toBe("call mom");
  });

  it("lets a typed priority win over the section's priority", () => {
    const out = buildCreateInput("call mom p1", { priority: "p3", status: "next" }, REF);
    expect(out.priority).toBe("p1");
    expect(out.status).toBe("next"); // seed axis still applies
    expect(out.title).toBe("call mom");
  });

  it("inherits the section's priority when none is typed", () => {
    expect(buildCreateInput("call mom", { priority: "p2" }, REF).priority).toBe("p2");
  });

  it("applies a seeded status and project_id", () => {
    const out = buildCreateInput("ship it", { status: "in_progress", project_id: "proj-uuid" }, REF);
    expect(out.status).toBe("in_progress");
    expect(out.project_id).toBe("proj-uuid");
  });

  it("inherits the section's scheduled_date when none is typed", () => {
    const out = buildCreateInput("ship it", { scheduled_date: "2026-06-20" }, REF);
    expect(out.scheduled_date).toBe("2026-06-20");
  });

  it("lets a seeded scheduled_date coexist with a parsed deadline_date", () => {
    const out = buildCreateInput("submit report due friday", { scheduled_date: "2026-06-20" }, REF);
    expect(out.scheduled_date).toBe("2026-06-20");
    expect(typeof out.deadline_date).toBe("string"); // "due friday" → a deadline
  });

  it("lets a typed date win over the section's (a bare date schedules)", () => {
    const out = buildCreateInput("submit report friday", { scheduled_date: "2026-06-20" }, REF);
    expect(out.scheduled_date).toBe("2026-06-19"); // the Friday after REF
    expect(out.deadline_date).toBeUndefined();
  });

  it("passes parsed tags and estimate through untouched", () => {
    const out = buildCreateInput("buy milk #groceries #m", {}, REF);
    expect(out.tags).toEqual(["groceries"]);
    expect(out.duration_minutes).toBe(120);
  });

  it("drops a parsed project name that matches no real project", () => {
    expect(buildCreateInput("ship it /groceries", {}, REF).project_id).toBeUndefined();
  });
});

describe("buildCreateInput — #project matching", () => {
  const PROJECTS = [
    { id: "proj-groceries", name: "Groceries" },
    { id: "proj-work", name: "Work" },
  ];

  it("files a typed #project instead of tagging it", () => {
    const out = buildCreateInput("buy milk #groceries", {}, REF, PROJECTS);
    expect(out.project_id).toBe("proj-groceries");
    expect(out.tags).toBeUndefined();
    expect(out.title).toBe("buy milk");
  });

  it("beats the section's project — naming one is deliberate", () => {
    const out = buildCreateInput(
      "buy milk #groceries",
      { project_id: "proj-work" },
      REF,
      PROJECTS
    );
    expect(out.project_id).toBe("proj-groceries");
  });

  it("falls back to the section's project when nothing was typed", () => {
    const out = buildCreateInput("buy milk", { project_id: "proj-work" }, REF, PROJECTS);
    expect(out.project_id).toBe("proj-work");
  });

  it("leaves an unmatched #token as a tag", () => {
    const out = buildCreateInput("buy milk #errands", {}, REF, PROJECTS);
    expect(out.project_id).toBeUndefined();
    expect(out.tags).toEqual(["errands"]);
  });

  it("still loses to an explicit chip override", () => {
    const built = buildCreateInput("buy milk #groceries", {}, REF, PROJECTS);
    expect(applyOverride(built, { project_id: "proj-work" }).project_id).toBe(
      "proj-work"
    );
  });
});

describe("seedFromDrop", () => {
  it("seeds nothing for null or value:null groups", () => {
    expect(seedFromDrop(null)).toEqual({});
    expect(seedFromDrop({ field: "project_id", value: null })).toEqual({});
    expect(seedFromDrop({ field: "scheduled_date", value: null })).toEqual({});
  });

  it("maps each axis to its field", () => {
    expect(seedFromDrop({ field: "status", value: "next" })).toEqual({ status: "next" });
    expect(seedFromDrop({ field: "priority", value: "p1" })).toEqual({ priority: "p1" });
    expect(seedFromDrop({ field: "project_id", value: "proj-uuid" })).toEqual({ project_id: "proj-uuid" });
    expect(seedFromDrop({ field: "scheduled_date", value: "2026-06-20" })).toEqual({ scheduled_date: "2026-06-20" });
  });
});

describe("seedFromUpcomingDate", () => {
  it("seeds scheduled_date for a real date and nothing for the sentinel", () => {
    expect(seedFromUpcomingDate("2026-06-20")).toEqual({ scheduled_date: "2026-06-20" });
    expect(seedFromUpcomingDate("unscheduled")).toEqual({});
  });
});

describe("applyOverride", () => {
  it("lets explicit fields win over the built input", () => {
    const built = buildCreateInput("call mom p1", {}, REF);
    const out = applyOverride(built, { priority: "p4", duration_minutes: 60 });
    expect(out.priority).toBe("p4");
    expect(out.duration_minutes).toBe(60);
    expect(out.title).toBe("call mom");
  });

  it("overrides scheduled_date with the explicit chip value", () => {
    const built = buildCreateInput("ship it /today", {}, REF);
    const out = applyOverride(built, { scheduled_date: "2026-06-20" });
    expect(out.scheduled_date).toBe("2026-06-20");
  });

  it("clears a seeded field on null — the only way to leave the page's project", () => {
    const built = buildCreateInput("buy milk", { project_id: "proj-work" }, REF);
    const out = applyOverride(built, { project_id: null });
    expect("project_id" in out).toBe(false);
  });

  it("clears a typed date on null", () => {
    const built = buildCreateInput("submit report friday", {}, REF);
    expect(built.scheduled_date).toBeTruthy();
    expect("scheduled_date" in applyOverride(built, { scheduled_date: null })).toBe(
      false
    );
  });
});

describe("contextFacets — the chips show what will be created", () => {
  const PROJECTS = [{ id: "proj-groceries", name: "Groceries" }];

  /** Every facet a chip shows has to match the field the create would carry. */
  function assertAgrees(raw: string, seed: QuickAddSeed) {
    const parsed = raw.trim() ? parseTaskInput(raw, REF, { projects: PROJECTS }) : null;
    const facets = contextFacets(seed, parsed);
    const built = buildCreateInput(raw || "placeholder", seed, REF, PROJECTS);
    expect(facets.priority).toBe(built.priority ?? null);
    expect(facets.project_id).toBe(built.project_id ?? null);
    expect(facets.scheduled_date).toBe(built.scheduled_date ?? null);
    expect(facets.duration_minutes).toBe(built.duration_minutes ?? null);
    return facets;
  }

  it("shows the seed on an empty composer", () => {
    const facets = assertAgrees("", { project_id: "proj-work", priority: "p2" });
    expect(facets.project_id).toBe("proj-work");
    expect(facets.priority).toBe("p2");
    expect(facets.scheduled_date).toBeNull();
  });

  it("shows a typed value in place of the seed it overrules", () => {
    const facets = assertAgrees("buy milk #groceries p1 friday", {
      project_id: "proj-work",
      priority: "p3",
      scheduled_date: "2026-06-20",
    });
    expect(facets.project_id).toBe("proj-groceries");
    expect(facets.priority).toBe("p1");
    expect(facets.scheduled_date).toBe("2026-06-19");
  });

  it("shows a parsed estimate, which no seed carries", () => {
    expect(assertAgrees("buy milk #m", {}).duration_minutes).toBe(120);
  });

  it("shows nothing on a bare composer with no context", () => {
    expect(contextFacets({}, null)).toEqual({
      priority: null,
      project_id: null,
      scheduled_date: null,
      duration_minutes: null,
    });
  });
});

describe("seedFromPathname", () => {
  it("files into the project whose page is open", () => {
    expect(seedFromPathname("/projects/proj-uuid")).toEqual({
      status: "not_started",
      project_id: "proj-uuid",
    });
  });

  it("schedules for today on Today", () => {
    expect(seedFromPathname("/today")).toEqual({
      scheduled_date: todayLocalISO(),
    });
  });

  it("seeds the inbox status on Inbox", () => {
    expect(seedFromPathname("/inbox")).toEqual({ status: "inbox" });
  });

  it("mirrors the demo routes", () => {
    expect(seedFromPathname("/demo/projects/proj-uuid").project_id).toBe("proj-uuid");
    expect(seedFromPathname("/demo/inbox")).toEqual({ status: "inbox" });
  });

  it("guesses nothing for a route that isn't about one facet", () => {
    expect(seedFromPathname("/upcoming")).toEqual({});
    expect(seedFromPathname("/all")).toEqual({});
    expect(seedFromPathname("/projects")).toEqual({});
    expect(seedFromPathname("/task/task-uuid")).toEqual({});
    expect(seedFromPathname(null)).toEqual({});
  });
});
