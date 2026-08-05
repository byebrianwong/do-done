import { z } from "zod";
import type { Project, Task, TaskPriority, TaskStatus } from "./schemas.js";
import {
  PRIORITY_CONFIG,
  STATUS_CONFIG,
  STATUS_ORDER,
  TERMINAL_STATUSES,
} from "./constants.js";
import { isOverdue, todayLocalISO, addDaysLocalISO } from "./utils.js";

/**
 * Display engine: one pure function (`applyDisplay`) that turns a flat task
 * list + a user's `DisplayConfig` into ordered, labelled groups. Web and
 * mobile both call this so "sort / group / filter" behaves identically.
 *
 * The config is intentionally shaped for growth: `sort` and `filters` are
 * arrays even though the v1 UI only drives a single sort key and AND-combined
 * filters. A future "compound" UI (multi-level sort, OR rule groups) can light
 * up without changing this engine's call sites.
 */

// ── Config enums ───────────────────────────────────────

export const ViewMode = z.enum(["list", "board"]);
export type ViewMode = z.infer<typeof ViewMode>;

export const GroupKey = z.enum([
  "none",
  "status",
  "priority",
  "project",
  "date", // relative buckets off the effective do-date (scheduled_date ?? deadline_date)
  "tag",
]);
export type GroupKey = z.infer<typeof GroupKey>;

export const SortField = z.enum([
  "manual", // sort_order — the only field that permits drag-to-reorder
  "status", // lifecycle order (STATUS_ORDER), the same axis group:status lays out
  "priority",
  "deadline_date",
  "scheduled_date",
  "created_at",
  "completed_at",
  "title",
  "duration",
]);
export type SortField = z.infer<typeof SortField>;

export const SortDir = z.enum(["asc", "desc"]);
export type SortDir = z.infer<typeof SortDir>;

export const SortRuleSchema = z.object({
  field: SortField,
  dir: SortDir.default("asc"),
});
export type SortRule = z.infer<typeof SortRuleSchema>;

// Filter is a single clause; the engine AND-combines `filters`. `values` is
// always an array so "is any of" works — single-select filters use `[x]`.
export const FilterField = z.enum([
  "status",
  "priority",
  "project",
  "tag",
  "deadline",
  "overdue",
]);
export type FilterField = z.infer<typeof FilterField>;

export const FilterOp = z.enum([
  "is",
  "is_not",
  "is_set",
  "is_empty",
  "before",
  "after",
]);
export type FilterOp = z.infer<typeof FilterOp>;

export const FilterRuleSchema = z.object({
  field: FilterField,
  op: FilterOp,
  values: z.array(z.string()).default([]),
});
export type FilterRule = z.infer<typeof FilterRuleSchema>;

export const DisplayConfigSchema = z.object({
  view: ViewMode.default("list"),
  group: GroupKey.default("none"),
  // Direction the groups themselves are laid out in. "asc" is each axis's
  // natural order (status lifecycle, p1→p4, overdue→later); "desc" reverses
  // them so active work floats to the top. Catch-all buckets ("No project"
  // etc.) stay pinned to the bottom either way — see applyDisplay.
  groupDir: SortDir.default("asc"),
  sort: z.array(SortRuleSchema).default([{ field: "manual", dir: "asc" }]),
  filters: z.array(FilterRuleSchema).default([]),
  showCompleted: z.boolean().default(false),
  // Group keys (e.g. "status:next") the user has collapsed in this view. Purely
  // a render concern — applyDisplay ignores it. Excluded from "is this the
  // default view?" checks (see isDisplayDefault) so collapsing doesn't read as
  // a customization.
  collapsed: z.array(z.string()).default([]),
});
export type DisplayConfig = z.infer<typeof DisplayConfigSchema>;

// ── Defaults ───────────────────────────────────────────

export const DEFAULT_DISPLAY: DisplayConfig = {
  view: "list",
  group: "none",
  groupDir: "asc",
  sort: [{ field: "manual", dir: "asc" }],
  filters: [],
  showCompleted: false,
  collapsed: [],
};

/**
 * Per-view starting configs. Each reproduces the view's current behaviour so
 * nothing regresses when the Display menu ships — the menu just lets the user
 * override from here. Keyed by a stable `viewKey` (see VIEW_KEYS).
 */
export const VIEW_DISPLAY_DEFAULTS: Record<string, DisplayConfig> = {
  all: { ...DEFAULT_DISPLAY, group: "status" },
  inbox: { ...DEFAULT_DISPLAY, group: "none" },
  today: { ...DEFAULT_DISPLAY, group: "none" },
  upcoming: { ...DEFAULT_DISPLAY, group: "date" },
  project: { ...DEFAULT_DISPLAY, group: "status" },
  completed: {
    ...DEFAULT_DISPLAY,
    group: "none",
    sort: [{ field: "completed_at", dir: "desc" }],
    showCompleted: true,
  },
};

export function defaultDisplayFor(viewKey: string): DisplayConfig {
  return VIEW_DISPLAY_DEFAULTS[viewKey] ?? DEFAULT_DISPLAY;
}

/**
 * Is `config` equivalent to `fallback` for the purposes of the "customized"
 * indicator? Ignores `collapsed`: collapsing a section is view state, not a
 * sort/group/filter customization, so it must not light the Display dot or the
 * Reset affordance.
 */
export function isDisplayDefault(
  config: DisplayConfig,
  fallback: DisplayConfig
): boolean {
  const strip = ({ collapsed: _c, ...rest }: DisplayConfig) => rest;
  return JSON.stringify(strip(config)) === JSON.stringify(strip(fallback));
}

/**
 * Field names as they were persisted before the scheduled/deadline rename.
 * Configs saved under the old names live in three places at once — the DB
 * column, localStorage and AsyncStorage — and only one of those is reachable
 * from a SQL migration, so the mapping is applied on read instead. Without it
 * a user who had sorted a view by date would silently get the default order
 * back, since an unknown enum member fails the parse for the whole config.
 */
const LEGACY_FIELD_NAMES: Record<string, string> = {
  when_date: "scheduled_date",
  due_date: "deadline_date",
  due: "deadline",
};

/** Rewrite legacy `sort[].field` / `filters[].field` values in place. */
function migrateLegacyFields(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const config = raw as Record<string, unknown>;
  const rename = (rules: unknown) =>
    Array.isArray(rules)
      ? rules.map((rule) => {
          if (typeof rule !== "object" || rule === null) return rule;
          const { field } = rule as { field?: unknown };
          if (typeof field !== "string") return rule;
          const renamed = LEGACY_FIELD_NAMES[field];
          return renamed ? { ...rule, field: renamed } : rule;
        })
      : rules;

  return { ...config, sort: rename(config.sort), filters: rename(config.filters) };
}

/**
 * Validate an untrusted config (e.g. from localStorage / a DB column) and fall
 * back to a known-good config rather than throwing. Stale persisted shapes are
 * expected as the feature evolves, so corrupt input must never break a view.
 */
export function parseDisplayConfig(
  raw: unknown,
  fallback: DisplayConfig = DEFAULT_DISPLAY
): DisplayConfig {
  const r = DisplayConfigSchema.safeParse(migrateLegacyFields(raw));
  return r.success ? r.data : fallback;
}

// ── Menu metadata (single source of truth for web + mobile menus) ──

export const GROUP_OPTIONS: { key: GroupKey; label: string }[] = [
  { key: "none", label: "None" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "project", label: "Project" },
  { key: "date", label: "Date" },
  { key: "tag", label: "Tag" },
];

export const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: "manual", label: "Manual (drag)" },
  { field: "status", label: "Status" },
  { field: "priority", label: "Priority" },
  { field: "deadline_date", label: "Deadline" },
  { field: "scheduled_date", label: "Scheduled" },
  { field: "created_at", label: "Date added" },
  { field: "completed_at", label: "Date completed" },
  { field: "title", label: "Alphabetical" },
  { field: "duration", label: "Estimate" },
];

// ── Config mutation helpers (shared by web + mobile menus) ──

export function withGroup(config: DisplayConfig, group: GroupKey): DisplayConfig {
  return { ...config, group };
}

/** Flip the group layout direction (natural order ⇄ reversed). */
export function toggleGroupDir(config: DisplayConfig): DisplayConfig {
  return { ...config, groupDir: config.groupDir === "asc" ? "desc" : "asc" };
}

/** Is the group with this key currently collapsed? */
export function isCollapsed(config: DisplayConfig, groupKey: string): boolean {
  return config.collapsed.includes(groupKey);
}

/** Collapse ⇄ expand a group section (by its DisplayGroup.key), immutably. */
export function toggleCollapsed(
  config: DisplayConfig,
  groupKey: string
): DisplayConfig {
  const collapsed = config.collapsed.includes(groupKey)
    ? config.collapsed.filter((k) => k !== groupKey)
    : [...config.collapsed, groupKey];
  return { ...config, collapsed };
}

/** Set the (single) active sort key, keeping direction unless overridden. */
export function withSort(
  config: DisplayConfig,
  field: SortField,
  dir?: SortDir
): DisplayConfig {
  const cur = config.sort[0];
  const nextDir = dir ?? (cur?.field === field ? cur.dir : "asc");
  return { ...config, sort: [{ field, dir: nextDir }] };
}

export function toggleSortDir(config: DisplayConfig): DisplayConfig {
  const cur = config.sort[0] ?? { field: "manual" as const, dir: "asc" as const };
  return { ...config, sort: [{ field: cur.field, dir: cur.dir === "asc" ? "desc" : "asc" }] };
}

/** Values selected for an `is` filter on `field` (multi-select chips). */
export function selectedFilterValues(
  config: DisplayConfig,
  field: FilterField
): string[] {
  return config.filters.find((x) => x.field === field && x.op === "is")?.values ?? [];
}

/** Replace the `is` filter for `field` with `values` (removed when empty). */
export function withFilterValues(
  config: DisplayConfig,
  field: FilterField,
  values: string[]
): DisplayConfig {
  const others = config.filters.filter((x) => !(x.field === field && x.op === "is"));
  return {
    ...config,
    filters: values.length ? [...others, { field, op: "is", values }] : others,
  };
}

export function toggleFilterValue(
  config: DisplayConfig,
  field: FilterField,
  value: string
): DisplayConfig {
  const cur = selectedFilterValues(config, field);
  const next = cur.includes(value)
    ? cur.filter((v) => v !== value)
    : [...cur, value];
  return withFilterValues(config, field, next);
}

/** Flag filters (e.g. overdue) — presence of an `is` clause means "on". */
export function hasFlagFilter(config: DisplayConfig, field: FilterField): boolean {
  return config.filters.some((x) => x.field === field && x.op === "is");
}

export function toggleFlagFilter(
  config: DisplayConfig,
  field: FilterField
): DisplayConfig {
  if (hasFlagFilter(config, field)) {
    return {
      ...config,
      filters: config.filters.filter((x) => !(x.field === field && x.op === "is")),
    };
  }
  return { ...config, filters: [...config.filters, { field, op: "is", values: [] }] };
}

/** Count of distinct active filter clauses — drives the Display button badge. */
export function activeFilterCount(config: DisplayConfig): number {
  return config.filters.length;
}

// ── Engine output ──────────────────────────────────────

/**
 * What dropping a task into a group means. `null` on groups whose axis isn't a
 * single mutable field (e.g. "no date", tag groups), which the UI reads to
 * disable cross-group drop for that group.
 */
export interface GroupDropTarget {
  field: "status" | "priority" | "project_id" | "scheduled_date";
  value: string | null;
}

export interface DisplayGroup {
  /** Stable key, e.g. "status:next" / "date:today" / "none". DnD droppable id. */
  key: string;
  label: string;
  /** Header accent (status/priority/project colours), when the axis has one. */
  color?: string;
  count: number;
  tasks: Task[];
  drop: GroupDropTarget | null;
  /** "No value" bucket (No project / No date / No label). Stays pinned to the
   *  bottom when `groupDir` reverses the rest of the groups. */
  catchAll?: boolean;
}

export interface DisplayProject {
  id: string;
  name: string;
  color: string;
}

export interface DisplayContext {
  projects?: Pick<Project, "id" | "name" | "color">[] | DisplayProject[];
  /** Override "today" (YYYY-MM-DD). Defaults to the local date. */
  today?: string;
}

const PRIORITY_RANK: Record<TaskPriority, number> = {
  p1: 0,
  p2: 1,
  p3: 2,
  p4: 3,
};
const PRIORITY_ORDER: readonly TaskPriority[] = ["p1", "p2", "p3", "p4"];

/** Lifecycle rank, so sorting by status matches the order group:status lays the
 *  columns out in (inbox → later → … → cancelled) rather than alphabetical. */
const STATUS_RANK = Object.fromEntries(
  STATUS_ORDER.map((s, i) => [s, i])
) as Record<TaskStatus, number>;

/** Effective do-date: scheduled_date wins over deadline_date (mirrors api-client taskDate). */
function effectiveDate(t: Task): string | null {
  return t.scheduled_date ?? t.deadline_date ?? null;
}

export function isManualSort(config: DisplayConfig): boolean {
  return (config.sort[0]?.field ?? "manual") === "manual";
}

// ── Filtering ──────────────────────────────────────────

function matchesFilter(task: Task, f: FilterRule, today: string): boolean {
  switch (f.field) {
    case "status":
      if (f.op === "is_not") return !f.values.includes(task.status);
      return f.values.includes(task.status);
    case "priority":
      if (f.op === "is_not") return !f.values.includes(task.priority);
      return f.values.includes(task.priority);
    case "project":
      if (f.op === "is_empty") return task.project_id === null;
      if (f.op === "is_set") return task.project_id !== null;
      if (f.op === "is_not")
        return !(task.project_id !== null && f.values.includes(task.project_id));
      return task.project_id !== null && f.values.includes(task.project_id);
    case "tag":
      if (f.op === "is_empty") return task.tags.length === 0;
      if (f.op === "is_set") return task.tags.length > 0;
      if (f.op === "is_not") return !task.tags.some((t) => f.values.includes(t));
      return task.tags.some((t) => f.values.includes(t));
    case "deadline":
      if (f.op === "is_empty") return task.deadline_date === null;
      if (f.op === "is_set") return task.deadline_date !== null;
      if (task.deadline_date === null) return false;
      if (f.op === "before") return task.deadline_date < (f.values[0] ?? today);
      if (f.op === "after") return task.deadline_date > (f.values[0] ?? today);
      return true;
    case "overdue":
      return f.op === "is_not" ? !isOverdue(task) : isOverdue(task);
    default:
      return true;
  }
}

function filterTasks(
  tasks: Task[],
  config: DisplayConfig,
  today: string
): Task[] {
  return tasks.filter((t) => {
    if (
      !config.showCompleted &&
      (TERMINAL_STATUSES as readonly TaskStatus[]).includes(t.status)
    ) {
      return false;
    }
    return config.filters.every((f) => matchesFilter(t, f, today));
  });
}

// ── Sorting ────────────────────────────────────────────

/** Compare two nullable strings, ISO/lexical order, with nulls always last. */
function cmpNullableStr(a: string | null, b: string | null, dir: SortDir): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const base = a < b ? -1 : 1;
  return dir === "desc" ? -base : base;
}

function cmpNullableNum(a: number | null, b: number | null, dir: SortDir): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const base = a - b;
  return dir === "desc" ? -base : base;
}

function cmpByRule(a: Task, b: Task, rule: SortRule): number {
  const { field, dir } = rule;
  switch (field) {
    case "manual": {
      const base = a.sort_order - b.sort_order;
      return dir === "desc" ? -base : base;
    }
    case "status": {
      const base = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      return dir === "desc" ? -base : base;
    }
    case "priority": {
      const base = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      return dir === "desc" ? -base : base;
    }
    case "deadline_date":
      return cmpNullableStr(a.deadline_date, b.deadline_date, dir);
    case "scheduled_date":
      return cmpNullableStr(a.scheduled_date, b.scheduled_date, dir);
    case "created_at":
      return cmpNullableStr(a.created_at, b.created_at, dir);
    case "completed_at":
      return cmpNullableStr(a.completed_at, b.completed_at, dir);
    case "title": {
      const base = a.title.localeCompare(b.title, undefined, {
        sensitivity: "base",
      });
      return dir === "desc" ? -base : base;
    }
    case "duration":
      return cmpNullableNum(a.duration_minutes, b.duration_minutes, dir);
    default:
      return 0;
  }
}

export function sortTasks(tasks: Task[], rules: SortRule[]): Task[] {
  const rs = rules.length ? rules : [{ field: "manual" as const, dir: "asc" as const }];
  return [...tasks].sort((a, b) => {
    for (const r of rs) {
      const c = cmpByRule(a, b, r);
      if (c !== 0) return c;
    }
    // Stable tiebreak so equal keys keep a deterministic order.
    return a.sort_order - b.sort_order;
  });
}

// ── Grouping ───────────────────────────────────────────

interface RelativeDateBucket {
  key: string;
  label: string;
  /** Direct drop reschedules to this exact YYYY-MM-DD; null = read-only group. */
  dropDate: string | null;
}

/** Bucket a task's effective date into Todoist-style relative windows. */
function dateBucketOf(task: Task, today: string): RelativeDateBucket {
  const eff = effectiveDate(task);
  if (eff === null)
    return { key: "date:none", label: "No date", dropDate: null };
  const tomorrow = addDaysLocalISO(1);
  if (eff < today) return { key: "date:overdue", label: "Overdue", dropDate: null };
  if (eff === today) return { key: "date:today", label: "Today", dropDate: today };
  if (eff === tomorrow)
    return { key: "date:tomorrow", label: "Tomorrow", dropDate: tomorrow };
  const weekEnd = addDaysLocalISO(6);
  if (eff <= weekEnd)
    return { key: "date:this_week", label: "This week", dropDate: null };
  const nextWeekEnd = addDaysLocalISO(13);
  if (eff <= nextWeekEnd)
    return { key: "date:next_week", label: "Next week", dropDate: null };
  return { key: "date:later", label: "Later", dropDate: null };
}

const DATE_BUCKET_ORDER = [
  "date:overdue",
  "date:today",
  "date:tomorrow",
  "date:this_week",
  "date:next_week",
  "date:later",
  "date:none",
];

function groupTasks(
  tasks: Task[],
  config: DisplayConfig,
  ctx: DisplayContext | undefined,
  today: string
): DisplayGroup[] {
  const blank = (
    key: string,
    label: string,
    drop: GroupDropTarget | null,
    color?: string
  ): DisplayGroup => ({ key, label, color, count: 0, tasks: [], drop });

  switch (config.group) {
    case "none":
      return [{ key: "none", label: "", count: tasks.length, tasks, drop: null }];

    case "status": {
      // Always show non-terminal status columns as drop targets (matches the
      // current All-tasks view); include done/cancelled only when requested.
      const statuses = STATUS_ORDER.filter(
        (s) =>
          config.showCompleted ||
          !(TERMINAL_STATUSES as readonly TaskStatus[]).includes(s)
      );
      const groups = new Map<string, DisplayGroup>();
      for (const s of statuses) {
        groups.set(
          `status:${s}`,
          blank(`status:${s}`, STATUS_CONFIG[s].label, { field: "status", value: s }, STATUS_CONFIG[s].color)
        );
      }
      for (const t of tasks) groups.get(`status:${t.status}`)?.tasks.push(t);
      return [...groups.values()];
    }

    case "priority": {
      const groups = new Map<string, DisplayGroup>();
      for (const p of PRIORITY_ORDER) {
        groups.set(
          `priority:${p}`,
          blank(`priority:${p}`, PRIORITY_CONFIG[p].label, { field: "priority", value: p }, PRIORITY_CONFIG[p].color)
        );
      }
      for (const t of tasks) groups.get(`priority:${t.priority}`)?.tasks.push(t);
      return [...groups.values()];
    }

    case "project": {
      const projects = ctx?.projects ?? [];
      const groups = new Map<string, DisplayGroup>();
      // Seed in project order so empty projects still render as drop targets.
      for (const p of projects) {
        groups.set(
          `project:${p.id}`,
          blank(`project:${p.id}`, p.name, { field: "project_id", value: p.id }, p.color)
        );
      }
      for (const t of tasks) {
        if (t.project_id === null) continue;
        const key = `project:${t.project_id}`;
        if (!groups.has(key))
          groups.set(key, blank(key, "Unknown project", { field: "project_id", value: t.project_id }));
        groups.get(key)!.tasks.push(t);
      }
      const noProject = blank("project:none", "No project", { field: "project_id", value: null });
      noProject.catchAll = true;
      for (const t of tasks) if (t.project_id === null) noProject.tasks.push(t);
      const ordered = [...groups.values()];
      if (noProject.tasks.length) ordered.push(noProject);
      // Drop empty real projects with no tasks to avoid clutter unless seeded.
      return ordered;
    }

    case "tag": {
      // A multi-tag task appears under each of its tags. Cross-group drag is
      // ambiguous for tags, so these groups are read-only (drop: null) in v1.
      const groups = new Map<string, DisplayGroup>();
      for (const t of tasks) {
        if (t.tags.length === 0) continue;
        for (const tag of t.tags) {
          const key = `tag:${tag}`;
          if (!groups.has(key)) groups.set(key, blank(key, tag, null));
          groups.get(key)!.tasks.push(t);
        }
      }
      const ordered = [...groups.values()].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
      );
      const noTag = blank("tag:none", "No label", null);
      noTag.catchAll = true;
      for (const t of tasks) if (t.tags.length === 0) noTag.tasks.push(t);
      if (noTag.tasks.length) ordered.push(noTag);
      return ordered;
    }

    case "date": {
      const groups = new Map<string, DisplayGroup>();
      for (const t of tasks) {
        const b = dateBucketOf(t, today);
        if (!groups.has(b.key)) {
          const g = blank(
            b.key,
            b.label,
            b.dropDate ? { field: "scheduled_date", value: b.dropDate } : null
          );
          if (b.key === "date:none") g.catchAll = true;
          groups.set(b.key, g);
        }
        groups.get(b.key)!.tasks.push(t);
      }
      return DATE_BUCKET_ORDER.filter((k) => groups.has(k)).map(
        (k) => groups.get(k)!
      );
    }

    default:
      return [{ key: "none", label: "", count: tasks.length, tasks, drop: null }];
  }
}

// ── Public entry point ─────────────────────────────────

/**
 * Apply a DisplayConfig to a task list: filter → group → sort-within-group.
 * Pure; the only ambient input is "today", overridable via `ctx.today`.
 */
export function applyDisplay(
  tasks: Task[],
  config: DisplayConfig,
  ctx?: DisplayContext
): DisplayGroup[] {
  const today = ctx?.today ?? todayLocalISO();
  const filtered = filterTasks(tasks, config, today);
  let groups = groupTasks(filtered, config, ctx, today);
  if (config.groupDir === "desc") {
    // Reverse the real groups but keep "No value" buckets pinned to the bottom.
    const real = groups.filter((g) => !g.catchAll).reverse();
    const tail = groups.filter((g) => g.catchAll);
    groups = [...real, ...tail];
  }
  for (const g of groups) {
    g.tasks = sortTasks(g.tasks, config.sort);
    g.count = g.tasks.length;
  }
  return groups;
}

/**
 * Apply ONLY a config's filters (+ showCompleted), skipping group/sort. Lets a
 * view keep its bespoke default layout (focus sections, per-day date columns)
 * while still honouring the Display menu's filters — the curated renderer
 * groups/sorts the result itself.
 */
export function filterByConfig(
  tasks: Task[],
  config: DisplayConfig,
  ctx?: DisplayContext
): Task[] {
  return filterTasks(tasks, config, ctx?.today ?? todayLocalISO());
}
