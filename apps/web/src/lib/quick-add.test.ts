import { describe, it, expect } from "vitest";
import {
  applyOverride,
  buildCreateInput,
  seedFromDrop,
  seedFromUpcomingDate,
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

  it("lets a seeded scheduled_date win over a typed date (the column is the date)", () => {
    const out = buildCreateInput("ship it /today", { scheduled_date: "2026-06-20" }, REF);
    expect(out.scheduled_date).toBe("2026-06-20");
  });

  it("lets a seeded scheduled_date coexist with a parsed deadline_date", () => {
    const out = buildCreateInput("submit report friday", { scheduled_date: "2026-06-20" }, REF);
    expect(out.scheduled_date).toBe("2026-06-20");
    expect(typeof out.deadline_date).toBe("string"); // "friday" → a deadline
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
});
