import { describe, it, expect } from "vitest";
import type { Task } from "./schemas.js";
import { addDaysLocalISO, todayLocalISO } from "./utils.js";
import {
  activeFilterCount,
  applyDisplay,
  DEFAULT_DISPLAY,
  defaultDisplayFor,
  filterByConfig,
  hasFlagFilter,
  isCollapsed,
  isDisplayDefault,
  isManualSort,
  parseDisplayConfig,
  selectedFilterValues,
  sortTasks,
  toggleCollapsed,
  toggleFilterValue,
  toggleFlagFilter,
  toggleGroupDir,
  toggleSortDir,
  withGroup,
  withSort,
  type DisplayConfig,
} from "./display.js";

// Fully-typed Task factory — overrides spread over sensible defaults.
let seq = 0;
function task(overrides: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
    user_id: "00000000-0000-0000-0000-000000000002",
    title: "Task",
    description: null,
    status: "inbox",
    priority: "p4",
    project_id: null,
    scheduled_date: null,
    deadline_date: null,
    deadline_time: null,
    duration_minutes: null,
    recurrence_rule: null,
    calendar_event_id: null,
    tags: [],
    parent_task_id: null,
    depth: 0,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

const TODAY = todayLocalISO();
const ctx = (over: Parameters<typeof applyDisplay>[2] = {}) => ({
  today: TODAY,
  ...over,
});

function flat(groups: ReturnType<typeof applyDisplay>): Task[] {
  return groups.flatMap((g) => g.tasks);
}

describe("parseDisplayConfig", () => {
  it("returns the parsed config for valid input", () => {
    const cfg: DisplayConfig = {
      view: "list",
      group: "priority",
      groupDir: "asc",
      sort: [{ field: "priority", dir: "asc" }],
      filters: [],
      showCompleted: false,
      collapsed: [],
    };
    expect(parseDisplayConfig(cfg).group).toBe("priority");
  });

  it("falls back on garbage rather than throwing", () => {
    expect(parseDisplayConfig({ group: "nonsense" })).toEqual(DEFAULT_DISPLAY);
    expect(parseDisplayConfig("not even an object")).toEqual(DEFAULT_DISPLAY);
    expect(parseDisplayConfig(null)).toEqual(DEFAULT_DISPLAY);
  });

  it("uses the supplied fallback", () => {
    const fb = defaultDisplayFor("all");
    expect(parseDisplayConfig(undefined, fb)).toEqual(fb);
  });

  // Configs persisted before the scheduled/deadline rename carry the old field
  // names. Without the remap the unknown enum member fails the parse for the
  // *whole* config, so a user who had sorted a view by date would silently get
  // the default order back — see LEGACY_FIELD_NAMES in display.ts.
  it("remaps sort and filter fields persisted under the pre-rename names", () => {
    const cfg = parseDisplayConfig({
      group: "status",
      sort: [{ field: "when_date", dir: "desc" }],
      filters: [{ field: "due", op: "is_set", values: [] }],
    });
    expect(cfg.sort[0]).toEqual({ field: "scheduled_date", dir: "desc" });
    expect(cfg.filters[0]!.field).toBe("deadline");
    expect(cfg.group).toBe("status");
  });

  it("remaps a legacy due_date sort without disturbing its direction", () => {
    const cfg = parseDisplayConfig({ sort: [{ field: "due_date", dir: "desc" }] });
    expect(cfg.sort[0]).toEqual({ field: "deadline_date", dir: "desc" });
  });

  it("leaves current field names untouched", () => {
    const cfg = parseDisplayConfig({
      sort: [{ field: "deadline_date", dir: "asc" }],
      filters: [{ field: "deadline", op: "is_set", values: [] }],
    });
    expect(cfg.sort[0]!.field).toBe("deadline_date");
    expect(cfg.filters[0]!.field).toBe("deadline");
  });

  it("backfills sort-rule defaults", () => {
    const cfg = parseDisplayConfig({ group: "status", sort: [{ field: "title" }] });
    expect(cfg.sort[0]).toEqual({ field: "title", dir: "asc" });
  });

  it("defaults groupDir to asc for pre-groupDir configs", () => {
    const cfg = parseDisplayConfig({ group: "status", sort: [{ field: "manual" }] });
    expect(cfg.groupDir).toBe("asc");
  });

  it("defaults collapsed to [] for pre-collapse configs", () => {
    const cfg = parseDisplayConfig({ group: "status", sort: [{ field: "manual" }] });
    expect(cfg.collapsed).toEqual([]);
  });
});

describe("defaultDisplayFor", () => {
  it("knows each view's starting grouping", () => {
    expect(defaultDisplayFor("all").group).toBe("status");
    expect(defaultDisplayFor("upcoming").group).toBe("date");
    expect(defaultDisplayFor("completed").showCompleted).toBe(true);
  });
  it("falls back to DEFAULT_DISPLAY for unknown views", () => {
    expect(defaultDisplayFor("mystery")).toEqual(DEFAULT_DISPLAY);
  });
});

describe("filtering", () => {
  it("hides terminal tasks unless showCompleted", () => {
    const tasks = [task({ status: "next" }), task({ status: "done" }), task({ status: "cancelled" })];
    const hidden = applyDisplay(tasks, DEFAULT_DISPLAY, ctx());
    expect(flat(hidden)).toHaveLength(1);
    const shown = applyDisplay(tasks, { ...DEFAULT_DISPLAY, showCompleted: true }, ctx());
    expect(flat(shown)).toHaveLength(3);
  });

  it("filters by priority (is / is_not)", () => {
    const tasks = [task({ priority: "p1" }), task({ priority: "p4" })];
    const isP1 = applyDisplay(tasks, {
      ...DEFAULT_DISPLAY,
      filters: [{ field: "priority", op: "is", values: ["p1"] }],
    }, ctx());
    expect(flat(isP1)).toHaveLength(1);
    expect(flat(isP1)[0].priority).toBe("p1");

    const notP1 = applyDisplay(tasks, {
      ...DEFAULT_DISPLAY,
      filters: [{ field: "priority", op: "is_not", values: ["p1"] }],
    }, ctx());
    expect(flat(notP1)[0].priority).toBe("p4");
  });

  it("filters by project (is / is_empty)", () => {
    const tasks = [task({ project_id: "p-1" as unknown as string }), task({ project_id: null })];
    const inProj = applyDisplay(tasks, {
      ...DEFAULT_DISPLAY,
      filters: [{ field: "project", op: "is", values: ["p-1"] }],
    }, ctx());
    expect(flat(inProj)).toHaveLength(1);
    const noProj = applyDisplay(tasks, {
      ...DEFAULT_DISPLAY,
      filters: [{ field: "project", op: "is_empty", values: [] }],
    }, ctx());
    expect(flat(noProj)).toHaveLength(1);
    expect(flat(noProj)[0].project_id).toBeNull();
  });

  it("filters by tag overlap", () => {
    const tasks = [task({ tags: ["work", "urgent"] }), task({ tags: ["home"] }), task({ tags: [] })];
    const work = applyDisplay(tasks, {
      ...DEFAULT_DISPLAY,
      filters: [{ field: "tag", op: "is", values: ["work"] }],
    }, ctx());
    expect(flat(work)).toHaveLength(1);
  });

  it("filters by overdue", () => {
    const tasks = [
      task({ status: "next", deadline_date: addDaysLocalISO(-2) }),
      task({ status: "next", deadline_date: addDaysLocalISO(5) }),
    ];
    const overdue = applyDisplay(tasks, {
      ...DEFAULT_DISPLAY,
      filters: [{ field: "overdue", op: "is", values: [] }],
    }, ctx());
    expect(flat(overdue)).toHaveLength(1);
    expect(flat(overdue)[0].deadline_date).toBe(addDaysLocalISO(-2));
  });

  it("AND-combines multiple filters", () => {
    const tasks = [
      task({ priority: "p1", tags: ["work"] }),
      task({ priority: "p1", tags: ["home"] }),
      task({ priority: "p4", tags: ["work"] }),
    ];
    const r = applyDisplay(tasks, {
      ...DEFAULT_DISPLAY,
      filters: [
        { field: "priority", op: "is", values: ["p1"] },
        { field: "tag", op: "is", values: ["work"] },
      ],
    }, ctx());
    expect(flat(r)).toHaveLength(1);
  });
});

describe("sorting", () => {
  it("sorts by priority p1→p4 then by sort_order tiebreak", () => {
    const tasks = [
      task({ priority: "p4", sort_order: 1 }),
      task({ priority: "p1", sort_order: 2 }),
      task({ priority: "p1", sort_order: 1 }),
    ];
    const sorted = sortTasks(tasks, [{ field: "priority", dir: "asc" }]);
    expect(sorted.map((t) => [t.priority, t.sort_order])).toEqual([
      ["p1", 1],
      ["p1", 2],
      ["p4", 1],
    ]);
  });

  it("pushes nulls last regardless of direction", () => {
    const tasks = [
      task({ deadline_date: null }),
      task({ deadline_date: "2026-03-01" }),
      task({ deadline_date: "2026-01-01" }),
    ];
    const asc = sortTasks(tasks, [{ field: "deadline_date", dir: "asc" }]);
    expect(asc.map((t) => t.deadline_date)).toEqual(["2026-01-01", "2026-03-01", null]);
    const desc = sortTasks(tasks, [{ field: "deadline_date", dir: "desc" }]);
    expect(desc.map((t) => t.deadline_date)).toEqual(["2026-03-01", "2026-01-01", null]);
  });

  it("sorts alphabetically case-insensitively", () => {
    const tasks = [task({ title: "banana" }), task({ title: "Apple" }), task({ title: "cherry" })];
    const sorted = sortTasks(tasks, [{ field: "title", dir: "asc" }]);
    expect(sorted.map((t) => t.title)).toEqual(["Apple", "banana", "cherry"]);
  });

  it("does not mutate the input array", () => {
    const tasks = [task({ sort_order: 2 }), task({ sort_order: 1 })];
    const copy = [...tasks];
    sortTasks(tasks, [{ field: "manual", dir: "asc" }]);
    expect(tasks).toEqual(copy);
  });
});

describe("grouping", () => {
  it("group:none yields a single group with everything", () => {
    const tasks = [task(), task(), task()];
    const g = applyDisplay(tasks, DEFAULT_DISPLAY, ctx());
    expect(g).toHaveLength(1);
    expect(g[0].key).toBe("none");
    expect(g[0].count).toBe(3);
    expect(g[0].drop).toBeNull();
  });

  it("group:status shows non-terminal columns as drop targets, even empty", () => {
    const tasks = [task({ status: "next" })];
    const g = applyDisplay(tasks, { ...DEFAULT_DISPLAY, group: "status" }, ctx());
    const keys = g.map((x) => x.key);
    expect(keys).toEqual(["status:inbox", "status:later", "status:not_started", "status:next", "status:in_progress"]);
    const next = g.find((x) => x.key === "status:next")!;
    expect(next.count).toBe(1);
    expect(next.drop).toEqual({ field: "status", value: "next" });
    // Empty inbox group is still present as a drop target.
    expect(g.find((x) => x.key === "status:inbox")!.count).toBe(0);
  });

  it("group:status includes done/cancelled only when showCompleted", () => {
    const tasks = [task({ status: "done" })];
    const withDone = applyDisplay(tasks, { ...DEFAULT_DISPLAY, group: "status", showCompleted: true }, ctx());
    expect(withDone.map((x) => x.key)).toContain("status:done");
  });

  it("group:priority always lists p1–p4 with colours and drop targets", () => {
    const tasks = [task({ priority: "p2" })];
    const g = applyDisplay(tasks, { ...DEFAULT_DISPLAY, group: "priority" }, ctx());
    expect(g.map((x) => x.key)).toEqual(["priority:p1", "priority:p2", "priority:p3", "priority:p4"]);
    expect(g[1].drop).toEqual({ field: "priority", value: "p2" });
    expect(g[1].color).toBeTruthy();
  });

  it("group:project seeds project order and appends No project last", () => {
    const tasks = [
      task({ project_id: "a" as unknown as string }),
      task({ project_id: null }),
    ];
    const g = applyDisplay(tasks, { ...DEFAULT_DISPLAY, group: "project" }, ctx({
      projects: [{ id: "a", name: "Alpha", color: "#111111" }],
    } as Parameters<typeof applyDisplay>[2]));
    expect(g[0].key).toBe("project:a");
    expect(g[0].drop).toEqual({ field: "project_id", value: "a" });
    const last = g[g.length - 1];
    expect(last.key).toBe("project:none");
    expect(last.drop).toEqual({ field: "project_id", value: null });
  });

  it("group:tag puts a task under each tag and No label last; read-only drop", () => {
    const tasks = [task({ tags: ["work", "urgent"] }), task({ tags: [] })];
    const g = applyDisplay(tasks, { ...DEFAULT_DISPLAY, group: "tag" }, ctx());
    const keys = g.map((x) => x.key);
    expect(keys).toEqual(["tag:urgent", "tag:work", "tag:none"]);
    expect(g.every((x) => x.drop === null)).toBe(true);
  });

  it("group:date buckets into relative windows with correct drop targets", () => {
    const tasks = [
      task({ status: "next", scheduled_date: addDaysLocalISO(-1) }), // overdue
      task({ scheduled_date: TODAY }), // today
      task({ scheduled_date: addDaysLocalISO(1) }), // tomorrow
      task({ scheduled_date: addDaysLocalISO(3) }), // this week
      task({}), // no date
    ];
    const g = applyDisplay(tasks, { ...DEFAULT_DISPLAY, group: "date" }, ctx());
    expect(g.map((x) => x.key)).toEqual([
      "date:overdue",
      "date:today",
      "date:tomorrow",
      "date:this_week",
      "date:none",
    ]);
    expect(g.find((x) => x.key === "date:today")!.drop).toEqual({ field: "scheduled_date", value: TODAY });
    // Overdue / this_week / no-date are read-only (ambiguous reschedule).
    expect(g.find((x) => x.key === "date:overdue")!.drop).toBeNull();
    expect(g.find((x) => x.key === "date:this_week")!.drop).toBeNull();
  });
});

describe("group direction (groupDir)", () => {
  const desc = (group: DisplayConfig["group"]): DisplayConfig => ({
    ...DEFAULT_DISPLAY,
    group,
    groupDir: "desc",
  });

  it("reverses status groups so active work is on top", () => {
    const tasks = [task({ status: "next" })];
    const g = applyDisplay(tasks, desc("status"), ctx());
    // asc is inbox → later → not_started → next → in_progress; desc flips it.
    expect(g.map((x) => x.key)).toEqual([
      "status:in_progress",
      "status:next",
      "status:not_started",
      "status:later",
      "status:inbox",
    ]);
  });

  it("reverses priority groups (p4 → p1)", () => {
    const g = applyDisplay([task({ priority: "p2" })], desc("priority"), ctx());
    expect(g.map((x) => x.key)).toEqual([
      "priority:p4",
      "priority:p3",
      "priority:p2",
      "priority:p1",
    ]);
  });

  it("reverses real projects but keeps No project pinned last", () => {
    const tasks = [
      task({ project_id: "a" as unknown as string }),
      task({ project_id: "b" as unknown as string }),
      task({ project_id: null }),
    ];
    const g = applyDisplay(tasks, desc("project"), ctx({
      projects: [
        { id: "a", name: "Alpha", color: "#111111" },
        { id: "b", name: "Beta", color: "#222222" },
      ],
    } as Parameters<typeof applyDisplay>[2]));
    expect(g.map((x) => x.key)).toEqual(["project:b", "project:a", "project:none"]);
    expect(g[g.length - 1].key).toBe("project:none");
  });

  it("reverses date buckets but keeps No date pinned last", () => {
    const tasks = [
      task({ status: "next", scheduled_date: addDaysLocalISO(-1) }), // overdue
      task({ scheduled_date: TODAY }), // today
      task({ scheduled_date: addDaysLocalISO(1) }), // tomorrow
      task({}), // no date
    ];
    const g = applyDisplay(tasks, desc("date"), ctx());
    expect(g.map((x) => x.key)).toEqual([
      "date:tomorrow",
      "date:today",
      "date:overdue",
      "date:none",
    ]);
  });

  it("is a no-op for group:none", () => {
    const tasks = [task(), task()];
    const g = applyDisplay(tasks, desc("none"), ctx());
    expect(g).toHaveLength(1);
    expect(g[0].key).toBe("none");
  });

  it("toggleGroupDir flips asc ⇄ desc immutably", () => {
    expect(DEFAULT_DISPLAY.groupDir).toBe("asc");
    const flipped = toggleGroupDir(DEFAULT_DISPLAY);
    expect(flipped.groupDir).toBe("desc");
    expect(DEFAULT_DISPLAY.groupDir).toBe("asc");
    expect(toggleGroupDir(flipped).groupDir).toBe("asc");
  });
});

describe("collapsed sections", () => {
  it("toggleCollapsed adds then removes a group key, immutably", () => {
    expect(isCollapsed(DEFAULT_DISPLAY, "status:next")).toBe(false);
    const collapsed = toggleCollapsed(DEFAULT_DISPLAY, "status:next");
    expect(isCollapsed(collapsed, "status:next")).toBe(true);
    expect(DEFAULT_DISPLAY.collapsed).toEqual([]); // original untouched
    const expanded = toggleCollapsed(collapsed, "status:next");
    expect(isCollapsed(expanded, "status:next")).toBe(false);
  });

  it("tracks multiple collapsed groups independently", () => {
    let cfg = toggleCollapsed(DEFAULT_DISPLAY, "status:next");
    cfg = toggleCollapsed(cfg, "status:inbox");
    expect(cfg.collapsed.sort()).toEqual(["status:inbox", "status:next"]);
    cfg = toggleCollapsed(cfg, "status:next");
    expect(cfg.collapsed).toEqual(["status:inbox"]);
  });

  it("does not affect applyDisplay output (collapse is render-only)", () => {
    const tasks = [task({ status: "next" }), task({ status: "inbox" })];
    const base = applyDisplay(tasks, { ...DEFAULT_DISPLAY, group: "status" }, ctx());
    const withCollapse = applyDisplay(
      tasks,
      { ...DEFAULT_DISPLAY, group: "status", collapsed: ["status:next"] },
      ctx()
    );
    expect(withCollapse.map((g) => [g.key, g.count])).toEqual(
      base.map((g) => [g.key, g.count])
    );
  });

  it("isDisplayDefault ignores collapsed but catches real changes", () => {
    const fb = defaultDisplayFor("all");
    expect(isDisplayDefault(fb, fb)).toBe(true);
    // Only collapse differs → still "default".
    expect(isDisplayDefault(toggleCollapsed(fb, "status:next"), fb)).toBe(true);
    // A real change (groupDir) → not default.
    expect(isDisplayDefault(toggleGroupDir(fb), fb)).toBe(false);
  });
});

describe("filterByConfig", () => {
  it("applies filters + showCompleted but not group/sort", () => {
    const tasks = [
      task({ priority: "p1", status: "next" }),
      task({ priority: "p4", status: "next" }),
      task({ priority: "p1", status: "done" }),
    ];
    const cfg: DisplayConfig = {
      ...DEFAULT_DISPLAY,
      group: "status",
      sort: [{ field: "priority", dir: "asc" }],
      filters: [{ field: "priority", op: "is", values: ["p1"] }],
    };
    // Returns a flat Task[] (no grouping), terminal hidden, only p1 kept.
    const out = filterByConfig(tasks, cfg, ctx());
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("next");
  });

  it("honours showCompleted", () => {
    const tasks = [task({ status: "done" }), task({ status: "next" })];
    expect(filterByConfig(tasks, DEFAULT_DISPLAY, ctx())).toHaveLength(1);
    expect(
      filterByConfig(tasks, { ...DEFAULT_DISPLAY, showCompleted: true }, ctx())
    ).toHaveLength(2);
  });
});

describe("isManualSort", () => {
  it("is true for manual and false for any sorted field", () => {
    expect(isManualSort(DEFAULT_DISPLAY)).toBe(true);
    expect(isManualSort({ ...DEFAULT_DISPLAY, sort: [{ field: "priority", dir: "asc" }] })).toBe(false);
  });
});

describe("config mutation helpers", () => {
  it("withGroup / withSort / toggleSortDir are immutable", () => {
    const a = withGroup(DEFAULT_DISPLAY, "priority");
    expect(a.group).toBe("priority");
    expect(DEFAULT_DISPLAY.group).toBe("none");

    const b = withSort(a, "deadline_date");
    expect(b.sort).toEqual([{ field: "deadline_date", dir: "asc" }]);
    const c = toggleSortDir(b);
    expect(c.sort).toEqual([{ field: "deadline_date", dir: "desc" }]);
    // Re-selecting the same field keeps direction; a new field resets to asc.
    expect(withSort(c, "deadline_date").sort[0].dir).toBe("desc");
    expect(withSort(c, "title").sort[0].dir).toBe("asc");
  });

  it("toggleFilterValue adds then removes multi-select chips", () => {
    let cfg = toggleFilterValue(DEFAULT_DISPLAY, "priority", "p1");
    expect(selectedFilterValues(cfg, "priority")).toEqual(["p1"]);
    cfg = toggleFilterValue(cfg, "priority", "p2");
    expect(selectedFilterValues(cfg, "priority").sort()).toEqual(["p1", "p2"]);
    cfg = toggleFilterValue(cfg, "priority", "p1");
    expect(selectedFilterValues(cfg, "priority")).toEqual(["p2"]);
    cfg = toggleFilterValue(cfg, "priority", "p2");
    // Emptying the chip set drops the whole clause.
    expect(cfg.filters).toHaveLength(0);
  });

  it("toggleFlagFilter flips overdue on and off", () => {
    expect(hasFlagFilter(DEFAULT_DISPLAY, "overdue")).toBe(false);
    const on = toggleFlagFilter(DEFAULT_DISPLAY, "overdue");
    expect(hasFlagFilter(on, "overdue")).toBe(true);
    expect(activeFilterCount(on)).toBe(1);
    const off = toggleFlagFilter(on, "overdue");
    expect(hasFlagFilter(off, "overdue")).toBe(false);
  });

  it("helpers compose into a working applyDisplay filter", () => {
    const tasks = [task({ priority: "p1" }), task({ priority: "p4" })];
    const cfg = toggleFilterValue(DEFAULT_DISPLAY, "priority", "p1");
    const groups = applyDisplay(tasks, cfg, ctx());
    expect(flat(groups)).toHaveLength(1);
    expect(flat(groups)[0].priority).toBe("p1");
  });
});
