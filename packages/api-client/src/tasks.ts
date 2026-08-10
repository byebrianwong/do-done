import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilterInput,
  PetEventActor,
  StatusSyncSettings,
  TagSummary,
  TaskStatus,
  TrackedField,
} from "@do-done/shared";
import {
  summarizeTags,
  TRACKED_FIELDS,
  todayLocalISO,
  addDaysLocalISO,
  todayISOInZone,
  isStatusSyncActive,
  parseStatusSyncSettings,
  resolveStatusSyncHorizon,
  statusSyncPatch,
  statusesBelow,
  TASK_TRASH_RETENTION_MS,
} from "@do-done/shared";
import { AttachmentsApi } from "./attachments.js";

/**
 * Map legacy DB status values to the new enum so old rows render correctly
 * the moment the new code deploys, even if the SQL migration hasn't run yet.
 * `todo` → `not_started`, `archived` → `cancelled`. Once the migration
 * runs, no row matches the legacy strings and these helpers are no-ops.
 *
 * Note: WRITES of `not_started`, `next`, or `cancelled` will fail the
 * unmigrated CHECK constraint. Apply migration `20260515000001` first.
 */
function normalizeTask<T extends { status: string } | null>(row: T): T {
  if (!row) return row;
  let s = row.status as string;
  if (s === "todo") s = "not_started";
  else if (s === "archived") s = "cancelled";
  return { ...row, status: s } as T;
}
function normalizeTasks<T extends { status: string }>(rows: T[]): T[] {
  return rows.map((r) => normalizeTask(r) as T);
}

/**
 * Outcome of a bulk write. `data` holds the tasks that were written and
 * `failedIds` names the ones that weren't, so a caller can roll back (or report)
 * exactly the rows that didn't land instead of writing off the whole batch.
 * `error` is the first failure, kept for callers that only need to know whether
 * anything broke.
 */
export interface BulkUpdateResult {
  data: Task[];
  error: Error | null;
  failedIds: string[];
}

// Every update() is a read-then-write pair, so an unbounded fan-out over a large
// selection opens 2N sockets at once. Browsers cap concurrent requests per host;
// React Native does not, which is why a big multi-select bulk action was the
// thing that fell over. Cap the fan-out instead of relying on the platform.
const BULK_CONCURRENCY = 8;

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

/**
 * How long a loaded copy of the status-sync settings is reused. The settings
 * change about once ever; the horizon they resolve to changes at midnight. A
 * minute is short enough that toggling the switch in Settings takes effect
 * before you can navigate back to your list, and long enough that a burst of
 * autosave writes costs one preferences read rather than one each.
 */
const STATUS_SYNC_TTL_MS = 60_000;

/** Resolved sync context for one moment in time. */
interface StatusSyncContext {
  settings: StatusSyncSettings;
  horizonISO: string;
}

export class TasksApi {
  constructor(
    private supabase: SupabaseClient,
    private userId?: string
  ) {}

  /**
   * Where every read of `tasks` starts.
   *
   * Deleting a task no longer destroys the row — it stamps `deleted_at` and the
   * row goes on existing so Undo can hand back *the same task* (see `delete`
   * below). The price of that is a rule every single read has to obey, and
   * there are fifteen of them: a query that forgets it doesn't fail, it shows
   * the user a task they deleted.
   *
   * So the filter isn't repeated fifteen times, it's the only way in. The RLS
   * policy carries the same condition as a backstop — but only as a backstop,
   * because the MCP server holds a service-role client and RLS does not apply
   * to it at all.
   */
  private read<Q extends string = "*">(columns: Q = "*" as Q) {
    return this.supabase.from("tasks").select(columns).is("deleted_at", null);
  }

  // ── Status ↔ schedule auto-sync ──────────────────────
  //
  // Both halves of the rule are applied here rather than in the apps, because
  // this is the one door every surface writes through — web, mobile, and MCP.
  // See packages/shared/src/status-sync.ts for what the rules are.

  private syncCache: { at: number; ctx: StatusSyncContext | null } | null = null;
  private syncInFlight: Promise<StatusSyncContext | null> | null = null;

  /**
   * The user's sync settings and the horizon they currently resolve to, or
   * null when the feature is off (the default) or unreadable. Cached briefly;
   * concurrent callers share one read.
   *
   * "Today" is resolved through the preferences timezone, not the process
   * clock — a deployed web server runs in UTC, and a horizon computed there is
   * a day out either side of the user's midnight.
   */
  private async statusSyncContext(): Promise<StatusSyncContext | null> {
    const now = Date.now();
    if (this.syncCache && now - this.syncCache.at < STATUS_SYNC_TTL_MS) {
      return this.syncCache.ctx;
    }
    if (this.syncInFlight) return this.syncInFlight;

    this.syncInFlight = (async () => {
      try {
        // select("*"), not named columns: on a deploy that lands before its
        // migration, naming the sync columns would error the whole read.
        let query = this.supabase.from("user_preferences").select("*").limit(1);
        if (this.userId) query = query.eq("user_id", this.userId);
        const { data, error } = await query.maybeSingle();
        if (error) return null;
        const settings = parseStatusSyncSettings(data);
        if (!isStatusSyncActive(settings)) return null;
        const timezone =
          (data as { timezone?: string } | null)?.timezone ?? undefined;
        const todayISO = timezone
          ? todayISOInZone(timezone)
          : todayLocalISO();
        return { settings, horizonISO: resolveStatusSyncHorizon(settings, todayISO) };
      } catch {
        // A preferences read that fails must never fail the task write. The
        // rule simply doesn't apply on this pass.
        return null;
      }
    })();

    try {
      const ctx = await this.syncInFlight;
      this.syncCache = { at: Date.now(), ctx };
      return ctx;
    } finally {
      this.syncInFlight = null;
    }
  }

  /**
   * Drop the cached settings so the next write re-reads them. Call it after
   * saving the sync settings — on mobile this instance is a long-lived
   * singleton, and without this the switch you just flipped would sit inert
   * for up to a minute.
   */
  invalidateStatusSyncCache(): void {
    this.syncCache = null;
  }

  /**
   * Re-apply the date→status half across the user's whole list — the pass that
   * catches tasks whose scheduled date didn't move but whose *day* arrived.
   * Idempotent, and one round trip: a single filtered UPDATE, not a fan-out.
   *
   * Call it where the app can notice a new day: page load on web, foreground
   * on mobile. Returns the number of rows moved so the caller can decide
   * whether a refetch is worth it.
   */
  async syncScheduledToStatus(): Promise<{
    updated: number;
    error: Error | null;
  }> {
    const ctx = await this.statusSyncContext();
    if (!ctx || !ctx.settings.status_sync_promote) {
      return { updated: 0, error: null };
    }
    const target = ctx.settings.status_sync_status;
    const from = statusesBelow(target);
    if (from.length === 0) return { updated: 0, error: null };

    let query = this.supabase
      .from("tasks")
      .update({ status: target })
      .is("deleted_at", null)
      .lte("scheduled_date", ctx.horizonISO)
      .in("status", from);
    if (this.userId) query = query.eq("user_id", this.userId);
    // `scheduled_date <= horizon` is already false for NULL (SQL three-valued
    // logic), so undated tasks are excluded — stated explicitly because that
    // exclusion is load-bearing, not incidental.
    const { data, error } = await query
      .not("scheduled_date", "is", null)
      .select("id");
    return {
      updated: (data as { id: string }[] | null)?.length ?? 0,
      error: error as Error | null,
    };
  }

  async list(filters?: TaskFilterInput): Promise<{ data: Task[]; error: Error | null }> {
    let query = this.read();

    if (this.userId) query = query.eq("user_id", this.userId);
    if (filters?.status) query = query.eq("status", filters.status);
    if (filters?.project_id) query = query.eq("project_id", filters.project_id);
    if (filters?.priority) query = query.eq("priority", filters.priority);
    if (filters?.deadline_before) query = query.lte("deadline_date", filters.deadline_before);
    if (filters?.deadline_after) query = query.gte("deadline_date", filters.deadline_after);
    if (filters?.scheduled_before) query = query.lte("scheduled_date", filters.scheduled_before);
    if (filters?.scheduled_after) query = query.gte("scheduled_date", filters.scheduled_after);
    if (filters?.tags?.length) query = query.overlaps("tags", filters.tags);
    if (filters?.search_query) {
      query = query.textSearch("fts", filters.search_query);
    }

    query = query
      .order("sort_order", { ascending: true })
      .range(filters?.offset ?? 0, (filters?.offset ?? 0) + (filters?.limit ?? 50) - 1);

    const { data, error } = await query;
    return {
      data: normalizeTasks((data as Task[]) ?? []),
      error: error as Error | null,
    };
  }

  /**
   * Every tag the user has, with the work filed under each.
   *
   * There is no tag table to read — `tasks.tags` is a `text[]` — so the only
   * honest answer comes from sweeping the task rows. This is why it is a
   * dedicated method rather than something a view derives from the tasks it
   * happens to have loaded: a per-view `availableTags` can only ever show the
   * tags in that slice, which is fine for narrowing a list you are looking at
   * and useless as an index of what exists.
   *
   * Two narrow columns and no `.range()`, mirroring
   * `ProjectsApi.listWithCounts` — the same "count every row" shape, at the
   * same cost, for the same reason. The aggregation itself is
   * `summarizeTags` in `@do-done/shared`, so the demo sandbox, mobile and the
   * MCP tool all count tags the one way.
   */
  async listTags(): Promise<{ data: TagSummary[]; error: Error | null }> {
    let query = this.read("tags, status");
    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    if (error) return { data: [], error: error as Error };
    return {
      data: summarizeTags(
        (data as Array<{ tags: string[] | null; status: string }>) ?? []
      ),
      error: null,
    };
  }

  /**
   * Every task carrying `tag`, newest slice first.
   *
   * Goes through PostgREST's `overlaps`, which is what the `idx_tasks_tags`
   * GIN index is there for — the alternative (fetch a page of tasks and
   * filter in the client) silently misses anything past the page limit, which
   * on a tag view is the whole point of the page.
   */
  async listByTag(
    tag: string,
    opts?: { limit?: number }
  ): Promise<{ data: Task[]; error: Error | null }> {
    return this.list({ tags: [tag], limit: opts?.limit ?? 500, offset: 0 });
  }

  async getById(id: string): Promise<{ data: Task | null; error: Error | null }> {
    const { data, error } = await this.read()
      .eq("id", id)
      .single();
    return {
      data: normalizeTask(data as Task | null),
      error: error as Error | null,
    };
  }

  async create(input: CreateTaskInput): Promise<{ data: Task | null; error: Error | null }> {
    const row: Record<string, unknown> = {
      ...input,
      ...(this.userId ? { user_id: this.userId } : {}),
    };
    // Subtasks inherit their parent's project at creation time. Only when the
    // caller didn't pick a project explicitly — an explicit choice always wins,
    // and the inherited value is a normal field the user can change later. This
    // lives here (not in the UI) so every creation path — web, mobile, MCP —
    // gets it for free. Costs one extra read, but only for parented tasks.
    if (input.parent_task_id && input.project_id === undefined) {
      const { data: parent } = await this.getById(input.parent_task_id);
      if (parent?.project_id) row.project_id = parent.project_id;
    }
    // Keep status and schedule in step from the first write, so a task created
    // as "Next" arrives already dated rather than being fixed up a beat later.
    const syncCtx = await this.statusSyncContext();
    if (syncCtx) {
      Object.assign(
        row,
        statusSyncPatch({
          prior: null,
          patch: {
            status: input.status,
            scheduled_date: input.scheduled_date ?? undefined,
          },
          settings: syncCtx.settings,
          horizonISO: syncCtx.horizonISO,
        })
      );
    }
    const { data, error } = await this.supabase
      .from("tasks")
      .insert(row)
      .select()
      .single();
    if (error || !data) {
      return { data: null, error: error as Error | null };
    }
    const created = normalizeTask(data as Task);
    // Feed Pip an energy bump for the create. Best-effort — never block or
    // fail the task insert if pet plumbing has problems.
    void (async () => {
      try {
        const { PetsApi } = await import("./pets.js");
        const pets = new PetsApi(this.supabase, this.userId);
        await pets.feedFromTaskCreate({ task: created, actor: "user" });
      } catch {
        // swallow — pet plumbing must never break task writes
      }
    })();
    return { data: created, error: null };
  }

  async update(
    id: string,
    input: UpdateTaskInput,
    actor: PetEventActor = "user"
  ): Promise<{ data: Task | null; error: Error | null }> {
    // Read the prior row so we can (a) detect a status→done transition for
    // completion feeding, and (b) compute which tracked fields are about to
    // transition from unset → set for energy feeding. One extra SELECT per
    // update is the price of stateless dedupe — the autosave hook fires at
    // most ~4/sec, well within Supabase headroom.
    const prevRes = await this.read().eq("id", id).maybeSingle();
    const prior = (prevRes.data as Task | null) ?? null;
    const priorStatus = prior?.status ?? null;

    // Stamp completed_at on first transition to done.
    const patch: Record<string, unknown> = { ...input };
    const isCompletionTransition =
      input.status === "done" && priorStatus !== "done";
    if (isCompletionTransition) {
      patch.completed_at = new Date().toISOString();
    }
    // ...and clear it again on the way back out, in the same write that moves
    // the status. `reopen()` did this for its own path only, so a task taken
    // out of done any other way — the editor's checkbox, an autosave undo —
    // kept a completed_at, and every surface that reads completion off the
    // stamp rather than the status (the Completed list, the weekly summary)
    // went on counting it as finished.
    if (
      input.status !== undefined &&
      input.status !== "done" &&
      priorStatus === "done"
    ) {
      patch.completed_at = null;
    }

    // Status ↔ schedule auto-sync. Folded into the same UPDATE rather than
    // chased with a second write, so the row the caller gets back is already
    // the row the rule wants — no flicker, and no window where a concurrent
    // read sees the half-synced state.
    const syncCtx = await this.statusSyncContext();
    if (syncCtx && prior) {
      Object.assign(
        patch,
        statusSyncPatch({
          prior: { status: prior.status, scheduled_date: prior.scheduled_date },
          patch: {
            status: input.status,
            scheduled_date: input.scheduled_date,
          },
          settings: syncCtx.settings,
          horizonISO: syncCtx.horizonISO,
        })
      );
    }

    const { data, error } = await this.supabase
      .from("tasks")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error || !data) {
      return { data: null, error: error as Error | null };
    }
    const updated = normalizeTask(data as Task);

    // Pet feeding — completion + edit are independent and may both fire on
    // the same write (e.g. user saves the task with a new description AND
    // marks it done in one PATCH).
    const userId = this.userId;
    const supabase = this.supabase;
    if (isCompletionTransition || prior !== null) {
      void (async () => {
        try {
          const { PetsApi } = await import("./pets.js");
          const pets = new PetsApi(supabase, userId);
          if (isCompletionTransition) {
            await pets.feedFromTask({ task: updated, actor });
          }
          if (prior) {
            const before: Partial<Record<TrackedField, unknown>> = {};
            const after: Partial<Record<TrackedField, unknown>> = {};
            for (const f of TRACKED_FIELDS) {
              before[f] = (prior as unknown as Record<string, unknown>)[f];
              after[f] = (updated as unknown as Record<string, unknown>)[f];
            }
            await pets.feedFromTaskEdit({
              before,
              after,
              task_id: updated.id,
              actor,
            });
          }
        } catch {
          // swallow — pet plumbing must never break task writes
        }
      })();
    }

    return { data: updated, error: null };
  }

  async complete(
    id: string,
    actor: PetEventActor = "user"
  ): Promise<{ data: Task | null; error: Error | null }> {
    return this.update(id, { status: "done" }, actor);
  }

  /**
   * Ids of a task and every descendant, using the depth-2 ceiling the DB
   * trigger enforces: a task's children and its grandchildren, and no deeper.
   * Bounded, so this is two queries rather than an open recursion.
   */
  private async subtreeIds(id: string): Promise<string[]> {
    const ids = [id];
    let frontier = [id];
    for (let level = 0; level < 2 && frontier.length > 0; level++) {
      let query = this.read("id").in("parent_task_id", frontier);
      if (this.userId) query = query.eq("user_id", this.userId);
      const { data } = await query;
      frontier = ((data as { id: string }[] | null) ?? []).map((r) => r.id);
      ids.push(...frontier);
    }
    return ids;
  }

  /**
   * Delete a task and everything under it — reversibly.
   *
   * **Nothing is destroyed here.** The rows are stamped with `deleted_at` and
   * disappear from every read; the subtasks stay subtasks, the attachment rows
   * stay attached, the bytes stay in the bucket, the location links stay
   * linked, and the id goes on being the id. `restore()` puts it all back by
   * clearing one column, which is what makes Undo give back *the same task*
   * rather than a copy wearing its title. `purgeDeleted()` is what eventually
   * does the real destroying.
   *
   * This used to be a hard delete, and the reversal was `create()` from a
   * client-side snapshot — a new row, a new id, no subtasks, no files, and
   * every link handed out before the delete still broken afterwards.
   *
   * Returns the ids it touched, because that list *is* the undo token: it was
   * computed against the live tree, so a subtask deleted separately five
   * minutes ago is not in it and a restore correctly leaves it deleted.
   */
  async delete(
    id: string
  ): Promise<{ ids: string[]; error: Error | null }> {
    const ids = await this.subtreeIds(id);
    // Stamped client-side rather than with `now()` so the caller could reason
    // about the batch if it ever needed to; the ids are what restore uses.
    const deletedAt = new Date().toISOString();

    let query = this.supabase
      .from("tasks")
      .update({ deleted_at: deletedAt })
      .in("id", ids);
    if (this.userId) query = query.eq("user_id", this.userId);
    const { error } = await query;
    return { ids, error: error as Error | null };
  }

  /**
   * Undelete rows by id — the exact ids `delete()` returned.
   *
   * One UPDATE, and it never needs to *see* the rows it is restoring, which
   * matters: the RLS select policy hides deleted rows, so a read-then-write
   * would find nothing to write. A policy's USING clause is checked per
   * command, so an UPDATE still reaches a row that SELECT cannot.
   *
   * Idempotent. Restoring a task that was already restored, or one the purge
   * has since destroyed, writes nothing and reports no error — an Undo tapped
   * twice must not turn into a failure the user has to think about.
   */
  async restore(ids: string[]): Promise<{ error: Error | null }> {
    if (ids.length === 0) return { error: null };
    let query = this.supabase
      .from("tasks")
      .update({ deleted_at: null })
      .in("id", ids);
    if (this.userId) query = query.eq("user_id", this.userId);
    const { error } = await query;
    return { error: error as Error | null };
  }

  /**
   * Really destroy anything deleted longer ago than the retention window.
   *
   * This is where the hard delete went, and it still owns the one piece of
   * cleanup no foreign key can do: the attachment **bytes**. A Storage object
   * has no FK to follow, so a cascade reaches the `task_attachments` rows and
   * leaves the files paying rent forever with nothing in the app pointing at
   * them. Bytes first, rows second — an attachment row pointing at absent
   * bytes renders as permanently broken, while bytes with no row are merely
   * invisible, so a failure between the two lands on the invisible side.
   *
   * Best-effort on the Storage half by design: a bucket hiccup must not leave
   * rows that can never be collected.
   *
   * Driven from the apps rather than a server timer (web's `StatusSyncRunner`,
   * mobile's sweeps) — the same shape as `syncScheduledToStatus`, and for the
   * same reason: it is one filtered read that returns nothing in the ordinary
   * case, and it needs no infrastructure that a preview deploy won't have.
   */
  async purgeDeleted(
    retentionMs: number = TASK_TRASH_RETENTION_MS
  ): Promise<{ purged: number; error: Error | null }> {
    const cutoff = new Date(Date.now() - retentionMs).toISOString();

    // Deliberately not `this.read()` — this is the one query in the class that
    // wants the deleted rows, and the only one that may say so.
    let find = this.supabase
      .from("tasks")
      .select("id")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff);
    if (this.userId) find = find.eq("user_id", this.userId);
    const { data, error: findError } = await find;
    if (findError) return { purged: 0, error: findError as Error };

    const ids = ((data as { id: string }[] | null) ?? []).map((r) => r.id);
    if (ids.length === 0) return { purged: 0, error: null };

    const attachments = new AttachmentsApi(this.supabase, this.userId);
    await attachments.removeForTasks(ids);

    let destroy = this.supabase.from("tasks").delete().in("id", ids);
    if (this.userId) destroy = destroy.eq("user_id", this.userId);
    const { error } = await destroy;
    return { purged: error ? 0 : ids.length, error: error as Error | null };
  }

  /**
   * Move a done task back to active and clear completed_at.
   *
   * `restoreStatus` is the status the task held *before* it was completed, and
   * it is what makes undo an undo: a task checked off from In progress came
   * back as Not started, which is a different task state than the one the user
   * asked to have back. Callers that know the prior status (a completion toast's
   * Undo, which captured the row as it was) pass it; a bare uncheck, which has
   * no prior state to speak of, doesn't, and gets the neutral `not_started`.
   *
   * `done` is refused, since restoring it would make the reopen a no-op and
   * leave the Undo button looking broken. `cancelled` is honoured — a cancelled
   * task that was then completed really was cancelled a moment ago.
   *
   * We don't route through update() because we want completed_at cleared
   * regardless of the input shape, which update()'s patch logic only handles
   * for an explicit status change.
   */
  async reopen(
    id: string,
    restoreStatus?: TaskStatus
  ): Promise<{ data: Task | null; error: Error | null }> {
    const status =
      restoreStatus && restoreStatus !== "done" ? restoreStatus : "not_started";
    const { data, error } = await this.supabase
      .from("tasks")
      .update({ status, completed_at: null })
      .eq("id", id)
      .select()
      .single();
    return {
      data: normalizeTask(data as Task | null),
      error: error as Error | null,
    };
  }

  async bulkUpdate(
    updates: Array<{ id: string; input: UpdateTaskInput }>
  ): Promise<BulkUpdateResult> {
    // Fan out to individual updates so each one stamps completed_at, fires pet
    // events, etc. Supabase has no native batch-update for distinct patches.
    // Runs concurrently (bounded) to amortize round-trip cost.
    const results = await mapWithLimit(
      updates,
      BULK_CONCURRENCY,
      async ({ id, input }) => {
        // A rejected fetch used to reject the whole Promise.all and lose every
        // other result with it; contain each write to its own row.
        const attempt = async () => {
          try {
            return await this.update(id, input);
          } catch (e) {
            return {
              data: null,
              error: e instanceof Error ? e : new Error(String(e)),
            };
          }
        };
        const first = await attempt();
        if (!first.error) return { id, ...first };
        // Field patches are idempotent, so replaying one is safe: the retry
        // either lands the write or confirms the failure is real. Worth doing —
        // fanning out is exactly what provokes transient failures.
        return { id, ...(await attempt()) };
      }
    );

    const data: Task[] = [];
    const failedIds: string[] = [];
    let error: Error | null = null;
    for (const r of results) {
      if (r.error) {
        failedIds.push(r.id);
        error ??= r.error;
      } else if (r.data) {
        data.push(r.data);
      }
    }
    return { data, error, failedIds };
  }

  async listCompleted(opts?: {
    limit?: number;
    before?: string;
  }): Promise<{ data: Task[]; error: Error | null }> {
    let query = this.read()
      .eq("status", "done")
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(opts?.limit ?? 200);
    if (opts?.before) query = query.lt("completed_at", opts.before);
    if (this.userId) query = query.eq("user_id", this.userId);
    const { data, error } = await query;
    return {
      data: normalizeTasks((data as Task[]) ?? []),
      error: error as Error | null,
    };
  }

  async listSubtasks(parentId: string): Promise<{ data: Task[]; error: Error | null }> {
    let query = this.read()
      .eq("parent_task_id", parentId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (this.userId) query = query.eq("user_id", this.userId);
    const { data, error } = await query;
    return {
      data: normalizeTasks((data as Task[]) ?? []),
      error: error as Error | null,
    };
  }

  async listUndated(): Promise<{ data: Task[]; error: Error | null }> {
    // Tasks with no scheduled_date AND no deadline_date that aren't in a terminal
    // state — unscheduled work. Used as a drag source in the Upcoming view
    // so the user can pull undated work onto a real day.
    let query = this.read()
      .is("scheduled_date", null)
      .is("deadline_date", null)
      .not("status", "in", "(done,cancelled,archived)")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (this.userId) query = query.eq("user_id", this.userId);
    const { data, error } = await query;
    return {
      data: normalizeTasks((data as Task[]) ?? []),
      error: error as Error | null,
    };
  }

  async listOverdue(): Promise<{ data: Task[]; error: Error | null }> {
    // Tasks whose scheduled_date OR deadline_date is strictly before today,
    // excluding done/cancelled. Mirrors isOverdue() in @do-done/shared.
    const today = todayLocalISO();
    let query = this.read()
      .not("status", "in", "(done,cancelled,archived)")
      .or(`scheduled_date.lt.${today},deadline_date.lt.${today}`)
      .order("priority")
      .order("sort_order");
    if (this.userId) query = query.eq("user_id", this.userId);
    const { data, error } = await query;
    return {
      data: normalizeTasks((data as Task[]) ?? []),
      error: error as Error | null,
    };
  }

  async search(query: string): Promise<{ data: Task[]; error: Error | null }> {
    const { data, error } = await this.read()
      .textSearch("fts", query)
      .limit(20);
    return {
      data: normalizeTasks((data as Task[]) ?? []),
      error: error as Error | null,
    };
  }

  async getInbox(): Promise<{ data: Task[]; error: Error | null }> {
    return this.list({ status: "inbox" } as TaskFilterInput);
  }

  async getToday(): Promise<{ data: Task[]; error: Error | null }> {
    // Today = anything scheduled to be DONE on or before today (scheduled_date),
    // OR whose deadline_date is on or before today.
    //
    // Status filter is "anything not closed" (not done, not cancelled).
    // Crucially, inbox tasks with a scheduled_date set DO show up here —
    // scheduling a task no longer requires moving it out of inbox.
    const today = todayLocalISO();
    let query = this.read()
      .not("status", "in", "(done,cancelled,archived)")
      .or(`scheduled_date.lte.${today},deadline_date.lte.${today}`)
      .order("priority")
      .order("sort_order");

    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    return {
      data: normalizeTasks((data as Task[]) ?? []),
      error: error as Error | null,
    };
  }

  async getUpcoming(days: number = 30): Promise<{ data: Task[]; error: Error | null }> {
    // Upcoming = scheduled (scheduled_date) OR deadlined (deadline_date) at some point
    // BETWEEN today and today+days. Past-dated tasks are not "upcoming"
    // — overdue tasks live in Today. Undated tasks have no place here.
    //
    // The lower bound is `today − 1`, NOT `today`. This query runs on the
    // server, so `todayLocalISO()` is the *server's* calendar day (UTC on a
    // deployed host). The Upcoming view buckets rows on the client using the
    // browser's local day. For a user behind UTC, the server rolls over to
    // "tomorrow" late in their evening, so a strict `scheduled_date >= server-today`
    // silently dropped every task they had scheduled for their local today.
    // The one-day buffer absorbs that ≤1-day skew (server is UTC; any client
    // is at most a calendar day off); the client — the authority on the user's
    // real day — discards anything genuinely before its local today.
    //
    // Status filter mirrors getToday — inbox tasks with a future date
    // are upcoming even if the user hasn't promoted them to todo yet.
    const start = addDaysLocalISO(-1);
    const endDate = addDaysLocalISO(days);

    let query = this.read()
      .not("status", "in", "(done,cancelled,archived)")
      .or(
        `and(scheduled_date.gte.${start},scheduled_date.lte.${endDate}),and(deadline_date.gte.${start},deadline_date.lte.${endDate})`
      )
      .order("scheduled_date", { nullsFirst: false })
      .order("deadline_date", { nullsFirst: false })
      .order("priority");

    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    return {
      data: normalizeTasks((data as Task[]) ?? []),
      error: error as Error | null,
    };
  }

  /**
   * Open tasks scheduled (scheduled_date) OR deadlined (deadline_date) inside an explicit,
   * inclusive `[startISO, endISO]` window of calendar dates.
   *
   * The caller supplies both bounds, so — unlike `getUpcoming` — there is no
   * skew buffer and no dependence on the server's own clock. That's what makes
   * it usable from a UTC host on behalf of a user in another timezone: resolve
   * the user's day first, then ask for exactly those dates.
   */
  async getDatedBetween(
    startISO: string,
    endISO: string
  ): Promise<{ data: Task[]; error: Error | null }> {
    let query = this.read()
      .not("status", "in", "(done,cancelled,archived)")
      .or(
        `and(scheduled_date.gte.${startISO},scheduled_date.lte.${endISO}),and(deadline_date.gte.${startISO},deadline_date.lte.${endISO})`
      )
      .order("scheduled_date", { nullsFirst: false })
      .order("deadline_date", { nullsFirst: false })
      .order("priority");

    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    return {
      data: normalizeTasks((data as Task[]) ?? []),
      error: error as Error | null,
    };
  }

  /**
   * Open tasks whose scheduled_date or deadline_date is strictly before `todayISO`.
   * `todayISO` is the caller's day — see `getDatedBetween` on why it's a
   * parameter and not `todayLocalISO()`.
   */
  async getOverdue(
    todayISO: string
  ): Promise<{ data: Task[]; error: Error | null }> {
    let query = this.read()
      .not("status", "in", "(done,cancelled,archived)")
      .or(`scheduled_date.lt.${todayISO},deadline_date.lt.${todayISO}`)
      .order("scheduled_date", { nullsFirst: false })
      .order("deadline_date", { nullsFirst: false })
      .order("priority");

    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    return {
      data: normalizeTasks((data as Task[]) ?? []),
      error: error as Error | null,
    };
  }
}

/**
 * Resolve the "effective date" of a task for list views.
 * Prefer scheduled_date (the explicit user "I'm doing this on …") over deadline_date
 * (the hard deadline). Returns YYYY-MM-DD or null.
 */
export function taskDate(task: Task): string | null {
  return task.scheduled_date ?? task.deadline_date ?? null;
}
