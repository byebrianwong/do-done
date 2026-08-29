"use client";

import type {
  CreateLocationInput,
  CreateProjectInput,
  CreateTaskInput,
  DisplayConfig,
  Location,
  PantryEntry,
  Project,
  Task,
  TaskFilterInput,
  TaskAttachment,
  TaskLocationLink,
  TaskLocationLinkRow,
  TaskStatus,
  TriggerType,
  UpdateProjectInput,
  UpdateTaskInput,
} from "@do-done/shared";
import {
  todayLocalISO,
  addDaysLocalISO,
  summarizeTags,
  isListProject,
  learnableTerm,
  splitProjects,
  daysSince,
  storeHint,
} from "@do-done/shared";
import type { Aisle, AisleMemory } from "@do-done/shared";
import type {
  AisleTermsApi,
  AttachmentsApi,
  BulkUpdateResult,
  LocationsApi,
  LocationWithPending,
  PantryApi,
  ProjectsApi,
  TasksApi,
  UserPrefsApi,
} from "@do-done/api-client";
import { TASK_COMPLETE_EXIT_MS, TASK_DELETE_EXIT_MS } from "@do-done/shared";
import { DEMO_USER_ID } from "./mode";
import { demoPantryFor } from "./seed";
import { getDemoState, holdDemoNotifications, setDemoState } from "./store";

/**
 * The sandbox's stand-ins for `TasksApi` / `ProjectsApi` / `UserPrefsApi`.
 *
 * They are structural doubles, not subclasses: the real classes hold a
 * `SupabaseClient` and every method is a PostgREST query, so faking the
 * database underneath them would mean reimplementing PostgREST — filter
 * grammar and all — to get back to the same array operations these do
 * directly. Callers get them through the same `getClientTasksApi()` seam and
 * cannot tell the difference, which is the goal: no component knows whether it
 * is in the demo.
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
    return this.liveTasks.filter((t) => t.is_list_item !== true);
  }

  /**
   * Live rows of both kinds. Mirrors `TasksApi.base()` — the two doors below
   * split it, and nothing else may use it.
   */
  private get liveTasks(): Task[] {
    return getDemoState().tasks.filter((t) => !t.deleted_at);
  }

  /**
   * Shopping-list items. The other door, and the mirror of
   * `TasksApi.readItems()`.
   *
   * The sandbox has to carry the isolation itself: `useDemoData` reads the
   * store directly rather than calling `list()`, so a rule enforced only in
   * the real API would show the demo's groceries in the demo's Today.
   */
  private get itemRows(): Task[] {
    return this.liveTasks.filter((t) => t.is_list_item === true);
  }

  /** Including the deleted ones. Only delete, restore and purge may look. */
  private get allTasks(): Task[] {
    return getDemoState().tasks;
  }

  private write(tasks: Task[]) {
    setDemoState({ tasks });
  }

  /**
   * The `task_sync_is_list_item` trigger, in TypeScript.
   *
   * A task is an item exactly when its project is a list. Derived on write
   * rather than read so the flag on the row is the truth, matching the real
   * schema — a demo that computed it at read time would disagree with the app
   * the first time something held a task across a project change.
   */
  private derivedListFlag(projectId: string | null): boolean {
    if (!projectId) return false;
    const project = getDemoState().projects.find((p) => p.id === projectId);
    return isListProject(project);
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
      is_list_item: false,
    };
    // Stands in for `task_sync_is_list_item`: the flag is derived from the
    // project, never passed in, on the way in and on every re-parent.
    task.is_list_item = this.derivedListFlag(task.project_id);
    // `allTasks`, not `tasks`: `write` replaces the whole array, so building
    // it from a *filtered* getter destroys everything the filter hid. That was
    // already quietly true of deleted rows — creating a task made the previous
    // delete un-undoable — and became true of every shopping-list item the
    // moment `tasks` learned to exclude them.
    this.write([...this.allTasks, task]);
    return ok(task);
  }

  async update(id: string, input: UpdateTaskInput) {
    // liveTasks, not tasks: a write by id reaches both kinds. Mirrors the real
    // API using base() rather than read() here — ticking milk off a list is an
    // update by id, and looking it up through the task-universe filter would
    // come back "Task not found".
    const prior = this.liveTasks.find((t) => t.id === id);
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
    // Re-derive on every write, as the BEFORE trigger does: moving a task into
    // a list makes it an item, and moving it out makes it a task again.
    updated.is_list_item = this.derivedListFlag(updated.project_id);
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
    // allTasks — see create: a write built from a filtered getter destroys
    // whatever the filter hid.
    const next = this.allTasks.map((t) =>
      t.id === id
        ? updated
        : moved.has(t.id)
          ? { ...t, project_id: updated.project_id, updated_at: nowISO() }
          : t
    );
    if (becomingDone || leavingDone) this.writeCompletion(next);
    else this.write(next);
    /*
      Records the buy, mirroring the same branch in `TasksApi.update`. The
      sandbox needs its own copy because its writes never reach the real API. A
      rule enforced only there would leave the demo drawer frozen at whatever
      the seed installed, on the one surface built for trying the feature out.
    */
    if (becomingDone && updated.is_list_item && updated.project_id) {
      void demoPantry.record(
        updated.project_id,
        updated.title,
        storeHint(updated)
      );
    }
    return ok(updated);
  }

  async complete(id: string) {
    return this.update(id, { status: "done" });
  }

  async reopen(id: string, restoreStatus?: TaskStatus) {
    // liveTasks — see update. Un-ticking an item is a write by id.
    const prior = this.liveTasks.find((t) => t.id === id);
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
    // allTasks — see create.
    this.writeCompletion(this.allTasks.map((t) => (t.id === id ? updated : t)));
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
      // liveTasks: a delete reaches the whole subtree whatever it is made of.
      for (const t of this.liveTasks) {
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
   * reclaim and no bucket to clean up — but the method has to exist, because
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

  // ── Shopping lists ─────────────────────────────────
  // The only reads here that look at `itemRows`.

  async listItems(listId: string) {
    return ok(
      this.itemRows
        .filter((t) => t.project_id === listId)
        .sort((a, b) => bySortOrder(a, b) || a.created_at.localeCompare(b.created_at))
    );
  }

  async listCounts() {
    const counts = new Map<string, { open: number; got: number }>();
    for (const t of this.itemRows) {
      if (!t.project_id) continue;
      const entry = counts.get(t.project_id) ?? { open: 0, got: 0 };
      if (isOpen(t)) entry.open += 1;
      else entry.got += 1;
      counts.set(t.project_id, entry);
    }
    return { data: counts, error: null };
  }

  async clearGot(listId: string) {
    const ids = this.itemRows
      .filter((t) => t.project_id === listId && !isOpen(t))
      .map((t) => t.id);
    if (ids.length === 0) return { data: [], error: null };
    const doomed = new Set(ids);
    const deletedAt = nowISO();
    this.writeAnimated(
      this.allTasks.map((t) =>
        doomed.has(t.id) ? { ...t, deleted_at: deletedAt } : t
      ),
      TASK_DELETE_EXIT_MS
    );
    return { data: ids, error: null };
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

  async listByKind() {
    const { data } = await this.list();
    return { ...splitProjects(data), error: null };
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
      kind: input.kind ?? "tasks",
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
    const kindChanged = isListProject(updated) !== isListProject(prior);
    setDemoState({
      projects: this.projects.map((p) => (p.id === id ? updated : p)),
      // `project_cascade_kind`: converting a project to a list re-flags
      // everything in it, and back again. Only written when the kind actually
      // moved, so an ordinary rename doesn't rewrite every task.
      ...(kindChanged
        ? {
            tasks: getDemoState().tasks.map((t) =>
              t.project_id === id
                ? { ...t, is_list_item: isListProject(updated) }
                : t
            ),
          }
        : {}),
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

/**
 * Locations, unlike attachments, are fully live in the sandbox.
 *
 * The reason is what each one needs from outside. An attachment is bytes in a
 * Storage bucket the demo has no session for, so the only accurate stand-in is
 * an empty set. A location is four numbers and a name — the sandbox can hold them
 * as easily as it holds a task — and place search talks to a keyless public
 * geocoder that doesn't know or care who is asking. So attaching a reminder to
 * "Sainsbury's" in the demo does the whole thing, and the only half that can't
 * follow is the one no browser has: the phone's geofence.
 */
class DemoLocationsApiImpl {
  private get locations(): Location[] {
    return getDemoState().locations;
  }

  private get links() {
    return getDemoState().taskLocations;
  }

  /** The place a link points at, or null if the row has gone. */
  private place(id: string): Location | null {
    return this.locations.find((l) => l.id === id) ?? null;
  }

  async list() {
    return ok(
      this.locations
        .filter((l) => l.is_saved)
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  }

  async listAll() {
    return ok(
      [...this.locations].sort((a, b) => a.name.localeCompare(b.name))
    );
  }

  async create(input: CreateLocationInput) {
    const now = nowISO();
    const location: Location = {
      id: newId(),
      user_id: DEMO_USER_ID,
      name: input.name,
      latitude: input.latitude,
      longitude: input.longitude,
      radius_meters: input.radius_meters ?? 100,
      address: input.address ?? null,
      is_saved: input.is_saved ?? true,
      created_at: now,
      updated_at: now,
    };
    setDemoState({ locations: [...this.locations, location] });
    return ok(location);
  }

  async update(id: string, patch: Partial<CreateLocationInput>) {
    const existing = this.place(id);
    if (!existing) return { data: null, error: new Error("No such place") };
    const next: Location = { ...existing, ...patch, updated_at: nowISO() };
    setDemoState({
      locations: this.locations.map((l) => (l.id === id ? next : l)),
    });
    return ok(next);
  }

  async remove(id: string) {
    // Stands in for the `task_locations` foreign key cascade — a place that is
    // gone takes its reminders with it, or the editor would list a link whose
    // place no longer resolves.
    setDemoState({
      locations: this.locations.filter((l) => l.id !== id),
      taskLocations: this.links.filter((l) => l.location_id !== id),
    });
    return { error: null };
  }

  async linkTask(taskId: string, locationId: string, triggerType: TriggerType) {
    const exists = this.links.some(
      (l) =>
        l.task_id === taskId &&
        l.location_id === locationId &&
        l.trigger_type === triggerType
    );
    // Idempotent, like the real one: the three columns are the primary key.
    if (exists) return { error: null };
    setDemoState({
      taskLocations: [
        ...this.links,
        { task_id: taskId, location_id: locationId, trigger_type: triggerType },
      ],
    });
    return { error: null };
  }

  async unlinkTask(
    taskId: string,
    locationId: string,
    triggerType: TriggerType
  ) {
    const remaining = this.links.filter(
      (l) =>
        !(
          l.task_id === taskId &&
          l.location_id === locationId &&
          l.trigger_type === triggerType
        )
    );
    // Stands in for `prune_one_off_location`: a place nobody saved exists only
    // to carry its reminders, so it goes when the last one does. Without this
    // the demo's Saved places screen would slowly fill with pins from tasks
    // the visitor already detached.
    const orphaned =
      !remaining.some((l) => l.location_id === locationId) &&
      this.place(locationId)?.is_saved === false;

    setDemoState({
      taskLocations: remaining,
      ...(orphaned
        ? { locations: this.locations.filter((l) => l.id !== locationId) }
        : {}),
    });
    return { error: null };
  }

  async getTaskLocations(taskId: string) {
    return ok(
      this.links.flatMap((l): TaskLocationLink[] => {
        if (l.task_id !== taskId) return [];
        const location = this.place(l.location_id);
        return location ? [{ location, trigger_type: l.trigger_type }] : [];
      })
    );
  }

  async listTaskLinks() {
    return ok(
      this.links.flatMap((l): TaskLocationLinkRow[] => {
        const location = this.place(l.location_id);
        return location
          ? [{ task_id: l.task_id, location, trigger_type: l.trigger_type }]
          : [];
      })
    );
  }

  async save(id: string, name?: string) {
    return this.update(id, { is_saved: true, ...(name ? { name } : {}) });
  }

  async listWithPendingTasks() {
    const openIds = new Set(
      getDemoState()
        .tasks.filter((t) => !t.deleted_at && isOpen(t))
        .map((t) => t.id)
    );

    const byLocation = new Map<
      string,
      { triggers: Set<TriggerType>; count: number }
    >();
    for (const link of this.links) {
      if (!openIds.has(link.task_id)) continue;
      const entry = byLocation.get(link.location_id) ?? {
        triggers: new Set<TriggerType>(),
        count: 0,
      };
      entry.triggers.add(link.trigger_type);
      entry.count += 1;
      byLocation.set(link.location_id, entry);
    }

    const result: LocationWithPending[] = [];
    for (const location of this.locations) {
      const entry = byLocation.get(location.id);
      if (!entry) continue;
      result.push({
        location,
        triggers: [...entry.triggers],
        pendingCount: entry.count,
      });
    }
    return ok(result);
  }
}

const demoTasks = new DemoTasksApiImpl();
const demoAttachments = new DemoAttachmentsApiImpl();
/**
 * The sandbox's aisle memory.
 *
 * A module-level Map rather than a slice of the demo store: it is per-tab
 * scratch, exactly like the store, but nothing renders *it* — the list reads
 * it through `groupByAisle` on every render anyway, so it needs no
 * subscription and gains nothing from being persisted.
 */
class DemoAisleTermsApiImpl {
  private terms = new Map<string, Aisle>();

  async load() {
    return { data: this.terms as AisleMemory, error: null };
  }

  async learn(title: string, aisle: Aisle) {
    const term = learnableTerm(title);
    if (term) this.terms.set(term, aisle);
    return { term, error: null };
  }

  async forget(title: string) {
    const term = learnableTerm(title);
    if (term) this.terms.delete(term);
    return { error: null };
  }
}

/**
 * The sandbox's pantry.
 *
 * Unlike the aisle memory beside it, this is seeded. An empty drawer shows
 * nothing useful: the feature is about what a list looks like after months of
 * shopping, and a first-time visitor has no history of their own.
 */
class DemoPantryApiImpl {
  private entries = new Map<string, Map<string, PantryEntry>>();

  private forList(listId: string): Map<string, PantryEntry> {
    let list = this.entries.get(listId);
    if (!list) {
      list = new Map();
      // Filled from the seed on first access rather than at module load. List
      // ids are only known once the seed has assigned them, and a visitor who
      // never opens Amazon should not pay for building its history.
      for (const entry of demoPantryFor(listId)) list.set(entry.term, entry);
      this.entries.set(listId, list);
    }
    return list;
  }

  /** Installs a starting history, as the seed does on first render. */
  preload(listId: string, entries: PantryEntry[]) {
    const list = this.forList(listId);
    for (const entry of entries) if (!list.has(entry.term)) list.set(entry.term, entry);
  }

  async load(listId: string) {
    return {
      data: [...this.forList(listId).values()].sort((a, b) =>
        b.last_bought_at.localeCompare(a.last_bought_at)
      ),
      error: null,
    };
  }

  async record(listId: string, title: string, store: string | null = null) {
    const term = learnableTerm(title);
    if (!term) return { term: null, error: null };
    const list = this.forList(listId);
    const prev = list.get(term);
    const now = nowISO();
    if (!prev) {
      list.set(term, {
        term,
        title,
        last_bought_at: now,
        buy_count: 1,
        gaps: [],
        store,
      });
      return { term, error: null };
    }
    // The same-day rule from `record_pantry_buy`: two ticks in one day count as
    // one shop. This is also what makes tick / untick / tick harmless.
    const gap = daysSince(prev.last_bought_at, new Date(now));
    list.set(term, {
      ...prev,
      title,
      store: store ?? prev.store,
      ...(gap === 0
        ? {}
        : {
            last_bought_at: now,
            buy_count: prev.buy_count + 1,
            gaps: [...prev.gaps, gap].slice(-10),
          }),
    });
    return { term, error: null };
  }

  async forget(listId: string, term: string) {
    this.forList(listId).delete(term);
    return { error: null };
  }
}

const demoLocations = new DemoLocationsApiImpl();
const demoProjects = new DemoProjectsApiImpl();
const demoAisleTerms = new DemoAisleTermsApiImpl();
const demoPantry = new DemoPantryApiImpl();
const demoPrefs = new DemoUserPrefsApiImpl();

// Structural doubles, so the casts are the seam's one deliberate lie. They are
// asserted against the real classes in `api.test.ts`: every method a caller
// reaches for has to exist on both.
export const demoTasksApi = demoTasks as unknown as TasksApi;
export const demoAttachmentsApi = demoAttachments as unknown as AttachmentsApi;
export const demoLocationsApi = demoLocations as unknown as LocationsApi;
export const demoProjectsApi = demoProjects as unknown as ProjectsApi;
export const demoUserPrefsApi = demoPrefs as unknown as UserPrefsApi;
export const demoAisleTermsApi = demoAisleTerms as unknown as AisleTermsApi;
export const demoPantryApi = demoPantry as unknown as PantryApi;
/** Lets the seed install a history, so a visitor arrives with one. */
export const preloadDemoPantry = (listId: string, entries: PantryEntry[]) =>
  demoPantry.preload(listId, entries);
