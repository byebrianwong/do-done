import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  AisleTermsApi,
  AttachmentsApi,
  ProjectsApi,
  TasksApi,
} from "@do-done/api-client";
import { TASK_COMPLETE_EXIT_MS } from "@do-done/shared";
import {
  demoAisleTermsApi,
  demoAttachmentsApi,
  demoProjectsApi,
  demoTasksApi,
} from "./api";
import { buildDemoSeed } from "./seed";
import { resetDemoStore, getDemoState, subscribeDemoStore } from "./store";
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
const INTERNAL = new Set([
  "nextSortOrder",
  "statusSyncContext",
  // Where every read of `tasks` starts, so the deleted-row filter can't be
  // forgotten. The demo does the same job in its own `tasks` getter.
  "read",
  // The other two doors onto the same rows: `base` is live-of-both-kinds and
  // `readItems` is shopping-list items. The demo mirrors all three as getters
  // (`liveTasks` / `tasks` / `itemRows`) rather than methods, so they can't be
  // matched by name — `listItems`, `listCounts` and `clearGot`, which are the
  // public surface built on them, are checked like everything else.
  "base",
  "readItems",
  // Derives is_list_item from the project, standing in for the DB trigger.
  // Demo-side only; the real API lets Postgres do it.
  "derivedListFlag",
  // Walks a task's children — for a delete (so the whole subtree is hidden
  // together and comes back together) and for a project move. Only TasksApi's
  // own methods call it.
  "subtreeIds",
  // Moves a task's descendants into its new project; only TasksApi.update
  // calls it, and the demo folds the same walk into its own update().
  "cascadeProject",
  // Resolves the owning user id for the Storage key.
  "ownerId",
]);

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

  it("implements every AttachmentsApi method", () => {
    for (const name of methodsOf(AttachmentsApi.prototype)) {
      expect(
        typeof (demoAttachmentsApi as unknown as Record<string, unknown>)[name],
        `AttachmentsApi.${name} is missing from the demo`
      ).toBe("function");
    }
  });

  it("implements every AisleTermsApi method", () => {
    for (const name of methodsOf(AisleTermsApi.prototype)) {
      expect(
        typeof (demoAisleTermsApi as unknown as Record<string, unknown>)[name],
        `AisleTermsApi.${name} is missing from the demo`
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

  it("gives an undone task back the status it was completed from", async () => {
    const target = getDemoState().tasks.find((t) => t.status !== "done")!;
    await demoTasksApi.update(target.id, { status: "in_progress" });
    await demoTasksApi.complete(target.id);

    const { data } = await demoTasksApi.reopen(target.id, "in_progress");
    expect(data?.status).toBe("in_progress");
    expect(data?.completed_at).toBeNull();
  });

  it("hides a task's subtasks with it, as the FK cascade does", async () => {
    const parent = getDemoState().tasks.find((t) =>
      getDemoState().tasks.some((c) => c.parent_task_id === t.id)
    )!;
    await demoTasksApi.delete(parent.id);

    // Gone from every list...
    const { data: listed } = await demoTasksApi.list({ limit: 500, offset: 0 });
    expect(listed.find((t) => t.id === parent.id)).toBeUndefined();
    expect(listed.filter((t) => t.parent_task_id === parent.id)).toHaveLength(0);

    // ...but still *there*, which is the whole point: undo restores the same
    // tasks rather than recreating likenesses of them.
    const stored = getDemoState().tasks;
    expect(stored.find((t) => t.id === parent.id)?.deleted_at).toEqual(
      expect.any(String)
    );
  });

  it("gives back the same task, subtasks and all, on restore", async () => {
    const parent = getDemoState().tasks.find((t) =>
      getDemoState().tasks.some((c) => c.parent_task_id === t.id)
    )!;
    const childIds = getDemoState()
      .tasks.filter((t) => t.parent_task_id === parent.id)
      .map((t) => t.id);

    const { ids } = await demoTasksApi.delete(parent.id);
    await demoTasksApi.restore(ids);

    const { data: listed } = await demoTasksApi.list({ limit: 500, offset: 0 });
    // Same id — not a copy — and the subtasks came back attached to it.
    expect(listed.find((t) => t.id === parent.id)).toBeDefined();
    for (const childId of childIds) {
      expect(listed.find((t) => t.id === childId)?.parent_task_id).toBe(
        parent.id
      );
    }
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

/**
 * The sandbox is the one place where a write and a re-render are the same
 * event, and completing a task is the one gesture where that difference is
 * visible: the row plays a 680ms exit, and a list that re-renders during it
 * takes the row away mid-animation. The real app is safe by construction —
 * `task-item.tsx` holds `router.refresh()` until the row has gone — so these
 * assertions are about the *timing* of the notification, never the data.
 */
describe("a completion's write lands now and is announced later", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDemoStore();
  });
  afterEach(() => vi.useRealTimers());

  async function watch(run: () => Promise<unknown>) {
    let notified = 0;
    const stop = subscribeDemoStore(() => (notified += 1));
    await run();
    return { stop, at: () => notified };
  }

  it("keeps subscribers quiet for the row's whole exit envelope", async () => {
    const target = getDemoState().tasks.find((t) => t.status !== "done")!;
    const w = await watch(() => demoTasksApi.complete(target.id));

    // The data is current immediately: a reload mid-animation, or anything that
    // reads the store rather than subscribing to it, sees the truth.
    expect(getDemoState().tasks.find((t) => t.id === target.id)?.status).toBe(
      "done"
    );
    expect(w.at()).toBe(0);

    vi.advanceTimersByTime(TASK_COMPLETE_EXIT_MS - 1);
    expect(w.at()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(w.at()).toBe(1);
    w.stop();
  });

  it("extends the quiet for a second completion rather than cutting the first short", async () => {
    const [a, b] = getDemoState().tasks.filter((t) => t.status !== "done");
    const w = await watch(async () => {
      await demoTasksApi.complete(a!.id);
      vi.advanceTimersByTime(200);
      await demoTasksApi.complete(b!.id);
    });

    // The first hold expires here, but the second row is 200ms into its own
    // exit — releasing now would pull it out from under itself.
    vi.advanceTimersByTime(TASK_COMPLETE_EXIT_MS - 200);
    expect(w.at()).toBe(0);
    vi.advanceTimersByTime(200);
    expect(w.at()).toBe(1);
    w.stop();
  });

  it("announces an ordinary edit on the spot", async () => {
    const target = getDemoState().tasks.find((t) => t.status !== "done")!;
    const w = await watch(() =>
      demoTasksApi.update(target.id, { title: "Renamed" })
    );
    expect(w.at()).toBe(1);
    w.stop();
  });

  it("announces immediately under reduced motion, since there is no exit to protect", async () => {
    // `useRowExit` skips the whole timeline and drops the row on the
    // spot when motion is off. A list that then waited 680ms to agree would
    // put the row back on screen after it had already gone.
    const real = window.matchMedia;
    window.matchMedia = ((q: string) =>
      ({
        matches: q.includes("prefers-reduced-motion"),
        media: q,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      const target = getDemoState().tasks.find((t) => t.status !== "done")!;
      const w = await watch(() => demoTasksApi.complete(target.id));
      expect(w.at()).toBe(1);
      w.stop();
    } finally {
      window.matchMedia = real;
    }
  });

  it("does not let a held hold swallow a reset", async () => {
    const target = getDemoState().tasks.find((t) => t.status !== "done")!;
    const w = await watch(() => demoTasksApi.complete(target.id));
    expect(w.at()).toBe(0);
    resetDemoStore();
    expect(w.at()).toBe(1);
    w.stop();
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
