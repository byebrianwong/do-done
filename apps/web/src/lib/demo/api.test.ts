import { describe, it, expect, beforeEach } from "vitest";
import { ProjectsApi, TasksApi } from "@do-done/api-client";
import { demoProjectsApi, demoTasksApi } from "./api";
import { buildDemoSeed } from "./seed";
import { resetDemoStore, getDemoState } from "./store";
import { DEMO_BASE, isDemoPath } from "./mode";

/**
 * The demo APIs are structural doubles handed to callers through a cast, so
 * TypeScript checks nothing about them at the call sites. These tests are what
 * stands in for that: every method the real class exposes has to exist here
 * too, or a component that reaches for one gets `undefined is not a function`
 * at runtime, in the demo only, where no type error will ever have warned us.
 */
/**
 * `private` is a TypeScript fiction — private methods sit on the prototype
 * like any other — so internal helpers have to be named to be skipped. Only
 * add to this list something a caller genuinely cannot reach.
 */
const INTERNAL = new Set(["nextSortOrder"]);

function methodsOf(proto: object): string[] {
  return Object.getOwnPropertyNames(proto)
    .filter((n) => n !== "constructor" && !INTERNAL.has(n))
    .sort();
}

describe("demo api surface", () => {
  it("implements every TasksApi method", () => {
    for (const name of methodsOf(TasksApi.prototype)) {
      expect(
        typeof (demoTasksApi as unknown as Record<string, unknown>)[name],
        `TasksApi.${name} is missing from the demo`
      ).toBe("function");
    }
  });

  it("implements every ProjectsApi method", () => {
    for (const name of methodsOf(ProjectsApi.prototype)) {
      expect(
        typeof (demoProjectsApi as unknown as Record<string, unknown>)[name],
        `ProjectsApi.${name} is missing from the demo`
      ).toBe("function");
    }
  });
});

describe("demo store writes", () => {
  beforeEach(() => resetDemoStore());

  it("creates a task that the store then holds", async () => {
    const before = getDemoState().tasks.length;
    const { data, error } = await demoTasksApi.create({
      title: "Buy stamps",
      status: "inbox",
    });
    expect(error).toBeNull();
    expect(data?.title).toBe("Buy stamps");
    expect(getDemoState().tasks).toHaveLength(before + 1);
  });

  it("stamps completed_at on the transition to done, once", async () => {
    const target = getDemoState().tasks.find((t) => t.status !== "done")!;
    const { data } = await demoTasksApi.complete(target.id);
    expect(data?.status).toBe("done");
    expect(data?.completed_at).toBeTruthy();

    const { data: reopened } = await demoTasksApi.reopen(target.id);
    expect(reopened?.status).toBe("not_started");
    expect(reopened?.completed_at).toBeNull();
  });

  it("deletes a task's subtasks with it, as the FK cascade does", async () => {
    const parent = getDemoState().tasks.find((t) =>
      getDemoState().tasks.some((c) => c.parent_task_id === t.id)
    )!;
    await demoTasksApi.delete(parent.id);
    const left = getDemoState().tasks;
    expect(left.find((t) => t.id === parent.id)).toBeUndefined();
    expect(left.filter((t) => t.parent_task_id === parent.id)).toHaveLength(0);
  });

  it("unfiles tasks when their project goes, rather than deleting them", async () => {
    const project = getDemoState().projects[0]!;
    const owned = getDemoState().tasks.filter(
      (t) => t.project_id === project.id
    );
    expect(owned.length).toBeGreaterThan(0);

    await demoProjectsApi.delete(project.id);
    const after = getDemoState();
    expect(after.projects.find((p) => p.id === project.id)).toBeUndefined();
    for (const t of owned) {
      expect(after.tasks.find((x) => x.id === t.id)?.project_id).toBeNull();
    }
  });

  it("reset restores the seed", async () => {
    await demoTasksApi.create({ title: "Temporary", status: "inbox" });
    resetDemoStore();
    expect(getDemoState().tasks).toHaveLength(buildDemoSeed().tasks.length);
  });
});

describe("demo seed", () => {
  it("dates everything relative to the day it is built for", () => {
    const seed = buildDemoSeed("2026-03-10");
    const today = seed.tasks.filter((t) => t.scheduled_date === "2026-03-10");
    const overdue = seed.tasks.filter(
      (t) => !!t.scheduled_date && t.scheduled_date < "2026-03-10"
    );
    expect(today.length).toBeGreaterThan(0);
    // An empty-looking demo is the failure mode that matters most: the first
    // impression is a screen that says the day is clear.
    expect(overdue.length).toBeGreaterThan(0);
  });

  it("gives every row a uuid-shaped id, since the schemas validate the shape", () => {
    const seed = buildDemoSeed("2026-03-10");
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const row of [...seed.tasks, ...seed.projects]) {
      expect(row.id).toMatch(uuid);
    }
  });

  it("points every subtask at a task that exists", () => {
    const seed = buildDemoSeed("2026-03-10");
    const ids = new Set(seed.tasks.map((t) => t.id));
    for (const t of seed.tasks) {
      if (t.parent_task_id) expect(ids.has(t.parent_task_id)).toBe(true);
    }
  });

  it("points every task's project at a project that exists", () => {
    const seed = buildDemoSeed("2026-03-10");
    const ids = new Set(seed.projects.map((p) => p.id));
    for (const t of seed.tasks) {
      if (t.project_id) expect(ids.has(t.project_id)).toBe(true);
    }
  });
});

describe("isDemoPath", () => {
  it("matches the demo base and everything under it", () => {
    expect(isDemoPath(DEMO_BASE)).toBe(true);
    expect(isDemoPath("/demo/today")).toBe(true);
    expect(isDemoPath("/demo/task/abc")).toBe(true);
  });

  it("does not match the real app, including lookalike prefixes", () => {
    expect(isDemoPath("/today")).toBe(false);
    expect(isDemoPath("/")).toBe(false);
    // The one a `startsWith("/demo")` test alone would get wrong.
    expect(isDemoPath("/demolition")).toBe(false);
  });
});
