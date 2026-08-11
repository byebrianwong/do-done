"use client";

import type {
  CreateProjectInput,
  CreateTaskInput,
  DisplayConfig,
  Project,
  Task,
  TaskFilterInput,
  TaskAttachment,
  TaskStatus,
  UpdateProjectInput,
  UpdateTaskInput,
} from "@do-done/shared";
import { todayLocalISO, addDaysLocalISO, summarizeTags } from "@do-done/shared";
import type {
  AttachmentsApi,
  BulkUpdateResult,
  ProjectsApi,
  TasksApi,
  UserPrefsApi,
} from "@do-done/api-client";
import { TASK_COMPLETE_EXIT_MS, TASK_DELETE_EXIT_MS } from "@do-done/shared";
import { DEMO_USER_ID } from "./mode";
import { getDemoState, holdDemoNotifications, setDemoState } from "./store";

/**
 * The sandbox's stand-ins for `TasksApi` / `ProjectsApi` / `UserPrefsApi`.
 *
 * They are structural doubles, not subclasses: the real classes hold a
 * `SupabaseClient` and every method is a PostgREST query, so faking the
 * database underneath them would mean reimplementing PostgREST — filter
 * grammar and all — to get back to the same array operations these do
 * directly. Callers get them through the same `getClientTasksApi()` seam and
 * can't tell the difference, which is the whole point: not one component knows
 * whether it's in the demo.
 *
 * Every method returns the `{ data, error }` shape the real ones do, so the
 * error branches on the calling side stay live code rather than becoming
 * unreachable in demo mode.
 */

const OPEN_STATUSES_EXCLUDED = new Set(["done", "cancelled", "archived"]);

function ok<T>(data: T): { data: T; error: null } {
  return { data, error: null };
}

function nowISO(): string {
  return new Date().toISOString();
}

/** uuid-shaped id for rows the visitor creates. `crypto.randomUUID` where it exists. */
function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `d0d0d0d0-0000-4000-8000-${Date.now().toString(16).padStart(12, "0")}`;
}

function isOpen(t: Task): boolean {
  return !OPEN_STATUSES_EXCLUDED.has(t.status);
}

/** Effective date used by the dated queries: do-date first, deadline second. */
function datesOf(t: Task): string[] {
  return [t.scheduled_date, t.deadline_date].filter((d): d is string => !!d);
}

const PRIORITY_RANK = { p1: 0, p2: 1, p3: 2, p4: 3 } as const;

function bySortOrder(a: Task, b: Task): number {
  return a.sort_order - b.sort_order;
}

function byPriorityThenSort(a: Task, b: Task): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || bySortOrder(a, b);
}

class DemoTasksApiImpl {
  /**
   * The live rows — which is every read in this class, because the sandbox
   * soft-deletes exactly as the real API does.
   *
   * That is not fidelity for its own sake: undo *restores* now, so a sandbox
   * that still filtered deleted rows out of the array would be demonstrating a
   * different feature from the one that ships. It is also the one getter every
   * method here already goes through, which makes the filter a single line
   * rather than fifteen — the same argument as `TasksApi.read()`.
   */
  private get tasks(): Task[] {
    return getDemoState().tasks.filter((t) => !t.deleted_at);
  }

  /** Including the deleted ones. Only delete, restore and purge may look. */
  private get allTasks(): Task[] {
    return getDemoState().tasks;
  }

  private write(tasks: Task[]) {
    setDemoState({ tasks });
  }

  /**
   * A write the row plays an animation on top of.
   *
   * Crossing into or out of `done` starts the hold-then-collapse timeline in
   * `useRowExit`, and the list must not re-render underneath it — see
   * `holdDemoNotifications`. The window is the animation's own envelope, and
   * since the write lands a tick after the click that started it, the list
   * always updates just *after* the row has finished leaving rather than during.
   *
   * Deleting needs the same quiet for the same reason, and it is the *only*
   * thing standing between the sandbox and an instant disappearance: in the
   * real app the deleter holds `router.refresh()` for the envelope, but here
   * the write is the refresh and fires synchronously.
   */
  private writeAnimated(tasks: Task[], envelopeMs: number) {
    holdDemoNotifications(envelopeMs);
    this.write(tasks);
  }

  private writeCompletion(tasks: Task[]) {
    this.writeAnimated(tasks, TASK_COMPLETE_EXIT_MS);
  }

  async list(filters?: TaskFilterInput) {
    let rows = [...this.tasks];
    if (filters?.status) rows = rows.filter((t) => t.status === filters.status);
    if (filters?.project_id)
      rows = rows.filter((t) => t.project_id === filters.project_id);
    if (filters?.priority)
      rows = rows.filter((t) => t.priority === filters.priority);
    if (filters?.scheduled_before)
      rows = rows.filter(
        (t) => !!t.scheduled_date && t.scheduled_date <= filters.scheduled_before!
      );
    if (filters?.scheduled_after)
      rows = rows.filter(
        (t) => !!t.scheduled_date && t.scheduled_date >= filters.scheduled_after!
      );
    if (filters?.deadline_before)
      rows = rows.filter(
        (t) => !!t.deadline_date && t.deadline_date <= filters.deadline_before!
      );
    if (filters?.deadline_after)
      rows = rows.filter(
        (t) => !!t.deadline_date && t.deadline_date >= filters.deadline_after!
      );
    if (filters?.tags?.length)
      rows = rows.filter((t) => t.tags.some((tag) => filters.tags!.includes(tag)));
    if (filters?.search_query) {
      const q = filters.search_query.toLowerCase();
      rows = rows.filter((t) => t.title.toLowerCase().includes(q));
    }
    rows.sort(bySortOrder);
    const offset = filters?.offset ?? 0;
    return ok(rows.slice(offset, offset + (filters?.limit ?? 50)));
  }

  async listTags() {
    return ok(summarizeTags(this.tasks));
  }

  /**
   * The sandbox's seed is a couple of dozen tasks written to look like a real
   * week, not a habit built up over months, so this is honestly answerable and
   * honestly thin: `suggestFacets` will find almost nothing above its evidence
   * thresholds and the chips will simply stay empty. That is the correct demo
   * of the feature — a first-week user sees the same thing.
   */
  async suggestionHistory(opts?: { limit?: number }) {
    return ok(
      this.tasks
        .slice(0, opts?.limit ?? 800)
        .map((t) => ({
          title: t.title,
          project_id: t.project_id,
          duration_minutes: t.duration_minutes,
        }))
    );
  }

  async listByTag(tag: string, opts?: { limit?: number }) {
    return this.list({ tags: [tag], limit: opts?.limit ?? 500, offset: 0 });
  }

  async getById(id: string) {
    return ok(this.tasks.find((t) => t.id === id) ?? null);
  }

  async create(input: CreateTaskInput) {
    const parent = input.parent_task_id
      ? this.tasks.find((t) => t.id === input.parent_task_id)
      : undefined;
    const task: Task = {
      id: newId(),
      user_id: DEMO_USER_ID,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? "inbox",
      priority: input.priority ?? "p4",
      // Subtasks inherit their parent's project unless the caller chose one,
      // matching TasksApi.create.
      project_id:
        input.project_id !== undefined
          ? input.project_id ?? null
          : parent?.project_id ?? null,
      scheduled_date: input.scheduled_date ?? null,
      scheduled_time: input.scheduled_time ?? null,
      deadline_date: input.deadline_date ?? null,
      deadline_time: input.deadline_time ?? null,
      duration_minutes: input.duration_minutes ?? null,
      recurrence_rule: input.recurrence_rule ?? null,
      calendar_event_id: null,
      tags: input.tags ?? [],
      parent_task_id: input.parent_task_id ?? null,
      depth: parent ? ((parent.depth + 1) as Task["depth"]) : 0,
      // New tasks land at the top of their list, where the user can see the
      // thing they just typed.
      sort_order: Math.min(0, ...this.tasks.map((t) => t.sort_order)) - 100,
      focus_override: null,
      created_at: nowISO(),
      updated_at: nowISO(),
      completed_at: null,
    };
    this.write([...this.tasks, task]);
    return ok(task);
  }

  async update(id: string, input: UpdateTaskInput) {
    const prior = this.tasks.find((t) => t.id === id);
    if (!prior) return { data: null, error: new Error("Task not found") };
    const becomingDone = input.status === "done" && prior.status !== "done";
    const leavingDone =
      input.status !== undefined &&
      input.status !== "done" &&
      prior.status === "done";
    // Re-parenting inherits the new parent's project, and a project change
    // carries the subtree with it — both mirroring TasksApi.update.
    const reparent =
      input.parent_task_id && input.parent_task_id !== prior.parent_task_id
        ? this.tasks.find((t) => t.id === input.parent_task_id)
        : undefined;
    const inherited =
      reparent && input.project_id === undefined && reparent.project_id
        ? { project_id: reparent.project_id }
        : {};
    const updated: Task = {
      ...prior,
      ...input,
      ...inherited,
      updated_at: nowISO(),
      ...(becomingDone ? { completed_at: nowISO() } : {}),
      ...(leavingDone ? { completed_at: null } : {}),
    };
    const moved = new Set<string>();
    if (updated.project_id !== prior.project_id) {
      let grew = true;
      moved.add(id);
      while (grew) {
        grew = false;
        for (const t of this.tasks) {
          if (t.parent_task_id && moved.has(t.parent_task_id) && !moved.has(t.id)) {
            moved.add(t.id);
            grew = true;
          }
        }
      }
      moved.delete(id);
    }
    const next = this.tasks.map((t) =>
      t.id === id
        ? updated
        : moved.has(t.id)
          ? { ...t, project_id: updated.project_id, updated_at: nowISO() }
          : t
    );
    if (becomingDone || leavingDone) this.writeCompletion(next);
    else this.write(next);
    return ok(updated);
  }

  async complete(id: string) {
    return this.update(id, { status: "done" });
  }

  async reopen(id: string, restoreStatus?: TaskStatus) {
    const prior = this.tasks.find((t) => t.id === id);
    if (!prior) return { data: null, error: new Error("Task not found") };
    const updated: Task = {
      ...prior,
      status:
        restoreStatus && restoreStatus !== "done" ? restoreStatus : "not_started",
      completed_at: null,
      updated_at: nowISO(),
    };
    // Reopening leaves a Completed list the same way completing leaves an open
    // one, so it gets the same quiet.
    this.writeCompletion(this.tasks.map((t) => (t.id === id ? updated : t)));
    return ok(updated);
  }

  async delete(id: string) {
    // Children go with the parent, as the FK cascade does — but nothing is
    // destroyed, exactly as in the real API: the rows are stamped and hidden so
    // undo can hand back the same tasks rather than copies of them.
    const doomed = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of this.tasks) {
        if (t.parent_task_id && doomed.has(t.parent_task_id) && !doomed.has(t.id)) {
          doomed.add(t.id);
          grew = true;
        }
      }
    }
    const deletedAt = nowISO();
    this.writeAnimated(
      this.allTasks.map((t) =>
        doomed.has(t.id) ? { ...t, deleted_at: deletedAt } : t
      ),
      TASK_DELETE_EXIT_MS
    );
    return { ids: [...doomed], error: null };
  }

  async restore(ids: string[]) {
    const back = new Set(ids);
    this.write(
      this.allTasks.map((t) =>
        back.has(t.id) ? { ...t, deleted_at: null } : t
      )
    );
    return { error: null };
  }

  /**
   * The sandbox never purges.
   *
   * Its store is a per-tab array that dies with the tab, so there is nothing to
   * reclaim and no bucket paying rent — but the method has to exist, because
   * `api.test.ts` sweeps both prototypes and the sweeps that call this run on
   * the demo routes too.
   */
  async purgeDeleted() {
    return { purged: 0, error: null };
  }

  async bulkUpdate(
    updates: Array<{ id: string; input: UpdateTaskInput }>
  ): Promise<BulkUpdateResult> {
    const data: Task[] = [];
    const failedIds: string[] = [];
    for (const { id, input } of updates) {
      const { data: row } = await this.update(id, input);
      if (row) data.push(row);
      else failedIds.push(id);
    }
    return { data, error: null, failedIds };
  }

  async listCompleted(opts?: { limit?: number; before?: string }) {
    const rows = this.tasks
      .filter((t) => t.status === "done" && !!t.completed_at)
      .filter((t) => (opts?.before ? t.completed_at! < opts.before : true))
      .sort((a, b) => b.completed_at!.localeCompare(a.completed_at!));
    return ok(rows.slice(0, opts?.limit ?? 200));
  }

  async listSubtasks(parentId: string) {
    return ok(
      this.tasks
        .filter((t) => t.parent_task_id === parentId)
        .sort((a, b) => bySortOrder(a, b) || a.created_at.localeCompare(b.created_at))
    );
  }

  async listUndated() {
    return ok(
      this.tasks
        .filter((t) => isOpen(t) && !t.scheduled_date && !t.deadline_date)
        .sort(bySortOrder)
    );
  }

  async listOverdue() {
    return this.getOverdue(todayLocalISO());
  }

  async getOverdue(todayISO: string) {
    return ok(
      this.tasks
        .filter((t) => isOpen(t) && datesOf(t).some((d) => d < todayISO))
        .sort(byPriorityThenSort)
    );
  }

  async search(query: string) {
    const q = query.toLowerCase();
    return ok(
      this.tasks
        .filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            (t.description ?? "").toLowerCase().includes(q)
        )
        .slice(0, 20)
    );
  }

  async getInbox() {
    return this.list({ status: "inbox" } as TaskFilterInput);
  }

  async getToday() {
    const today = todayLocalISO();
    return ok(
      this.tasks
        .filter((t) => isOpen(t) && datesOf(t).some((d) => d <= today))
        .sort(byPriorityThenSort)
    );
  }

  async getUpcoming(days = 30) {
    return this.getDatedBetween(addDaysLocalISO(-1), addDaysLocalISO(days));
  }

  /**
   * Status↔schedule auto-sync is a `user_preferences` feature, and the sandbox
   * has no preferences row — which is exactly the "both halves off" state the
   * real API defaults to, so these are the real no-op answers rather than
   * stubs. They exist at all because `api.test.ts` requires the double to
   * cover every method on `TasksApi`: `StatusSyncRunner` reaches for
   * `syncScheduledToStatus` through `getClientTasksApi()`, and the day
   * anything in the demo tree mounts it, a missing method here is a runtime
   * crash no type-checker would have caught.
   */
  invalidateStatusSyncCache(): void {}

  async syncScheduledToStatus() {
    return { updated: 0, error: null };
  }

  async getDatedBetween(startISO: string, endISO: string) {
    return ok(
      this.tasks
        .filter(
          (t) => isOpen(t) && datesOf(t).some((d) => d >= startISO && d <= endISO)
        )
        .sort(byPriorityThenSort)
    );
  }
}

class DemoProjectsApiImpl {
  private get projects(): Project[] {
    return getDemoState().projects;
  }

  async list() {
    return ok([...this.projects].sort((a, b) => a.sort_order - b.sort_order));
  }

  async getById(id: string) {
    return ok(this.projects.find((p) => p.id === id) ?? null);
  }

  async create(input: CreateProjectInput) {
    const project: Project = {
      id: newId(),
      user_id: DEMO_USER_ID,
      name: input.name,
      color: input.color ?? "#6366f1",
      icon: input.icon ?? null,
      parent_project_id: input.parent_project_id ?? null,
      sort_order: Math.max(0, ...this.projects.map((p) => p.sort_order)) + 1000,
      created_at: nowISO(),
      updated_at: nowISO(),
    };
    setDemoState({ projects: [...this.projects, project] });
    return ok(project);
  }

  async update(id: string, input: UpdateProjectInput) {
    const prior = this.projects.find((p) => p.id === id);
    if (!prior) return { data: null, error: new Error("Project not found") };
    const updated: Project = { ...prior, ...input, updated_at: nowISO() };
    setDemoState({
      projects: this.projects.map((p) => (p.id === id ? updated : p)),
    });
    return ok(updated);
  }

  async reorder(orderedIds: string[]) {
    const rank = new Map(orderedIds.map((id, i) => [id, i * 1000]));
    setDemoState({
      projects: this.projects.map((p) =>
        rank.has(p.id) ? { ...p, sort_order: rank.get(p.id)! } : p
      ),
    });
    return { error: null };
  }

  async delete(id: string) {
    const state = getDemoState();
    setDemoState({
      projects: state.projects.filter((p) => p.id !== id),
      // The FK is ON DELETE SET NULL — the tasks survive, unfiled.
      tasks: state.tasks.map((t) =>
        t.project_id === id ? { ...t, project_id: null } : t
      ),
    });
    return { error: null };
  }

  async listWithCounts() {
    const { tasks } = getDemoState();
    const { data: projects } = await this.list();
    return ok(
      projects.map((p) => {
        const mine = tasks.filter((t) => t.project_id === p.id);
        return {
          ...p,
          task_count: mine.length,
          open_count: mine.filter(isOpen).length,
        };
      })
    );
  }
}

/**
 * Display preferences in the sandbox stay where `useDisplayConfig` already
 * caches them — localStorage. The DB tier just reports "nothing stored", which
 * is a state the real hook handles (an account that has never set a preference).
 */
class DemoUserPrefsApiImpl {
  async getDisplayPrefs() {
    return ok({} as Record<string, DisplayConfig>);
  }
  async setDisplayPref() {
    return { error: null };
  }
  async get() {
    return ok(null);
  }
}

/**
 * The sandbox has no Storage bucket and no session to sign a URL with, so it
 * reports an empty attachment set — a state the real section already renders
 * (a task nobody has attached anything to). Uploads are refused rather than
 * faked: a file that appeared and then vanished on reload would read as a bug.
 */
class DemoAttachmentsApiImpl {
  async list() {
    return ok([] as TaskAttachment[]);
  }
  async signedUrls() {
    return ok(new Map<string, string>());
  }
  async fetchText() {
    return ok(null);
  }
  async downloadUrl() {
    return ok(null);
  }
  async upload() {
    return {
      data: null,
      error: new Error("Attachments are read-only in the demo."),
    };
  }
  async remove() {
    return { error: null };
  }
  async removeForTasks() {
    return { error: null };
  }
}

const demoTasks = new DemoTasksApiImpl();
const demoAttachments = new DemoAttachmentsApiImpl();
const demoProjects = new DemoProjectsApiImpl();
const demoPrefs = new DemoUserPrefsApiImpl();

// Structural doubles, so the casts are the seam's one deliberate lie. They are
// asserted against the real classes in `api.test.ts`: every method a caller
// reaches for has to exist on both.
export const demoTasksApi = demoTasks as unknown as TasksApi;
export const demoAttachmentsApi = demoAttachments as unknown as AttachmentsApi;
export const demoProjectsApi = demoProjects as unknown as ProjectsApi;
export const demoUserPrefsApi = demoPrefs as unknown as UserPrefsApi;
