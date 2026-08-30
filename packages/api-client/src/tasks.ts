import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilterInput,
  PetEventActor,
  StatusSyncSettings,
  SuggestionRow,
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
  describeStatusSyncNotice,
  describeStatusSyncSweep,
  statusSyncPatch,
  statusesBelow,
  sweepPromoteRange,
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

/**
 * How far back `suggestionHistory` looks.
 *
 * Three text-and-integer columns, so this is a small payload even at the top
 * of the range, and it is fetched once per session rather than per keystroke.
 * Large enough that a habit is visible; small enough that a user who has been
 * here for years isn't having last year's project layout counted as evidence.
 */
const SUGGESTION_HISTORY_LIMIT = 800;

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

/**
 * What the status ↔ schedule rule changed on a write the caller didn't ask
 * for, so the caller can say so. Absent when the rule did nothing, which is
 * the common case and the case where the UI must stay silent.
 *
 * Returned rather than inferred by the caller comparing what it sent against
 * what came back: the interesting write is the one that sent *only* a date and
 * got a status change too, and a caller reconstructing that has to hold the
 * prior row to notice.
 */
export interface StatusSyncApplied {
  /** Promoted to this status, because the task's new date is near. */
  status?: TaskStatus;
  /** Given this scheduled date, because the task's new status implies one. */
  scheduled_date?: string;
  /**
   * One line for the user. Composed here, where the settings that word it are
   * already loaded, rather than in each app — the phone and the laptop must
   * not describe the same rule differently.
   */
  notice: string;
}

/** Resolved sync context for one moment in time. */
interface StatusSyncContext {
  settings: StatusSyncSettings;
  horizonISO: string;
  /**
   * The horizon the promote sweep last ran through, or null if it never has.
   * Read here rather than in the sweep so both halves see one consistent
   * snapshot of the preferences row.
   */
  sweptThrough: string | null;
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
    return this.base(columns).eq("is_list_item", false);
  }

  /**
   * Live rows, list items and tasks alike. Not for general use — the two
   * doors below are, and they are the only callers.
   */
  private base<Q extends string = "*">(columns: Q = "*" as Q) {
    return this.supabase.from("tasks").select(columns).is("deleted_at", null);
  }

  /**
   * The other door: rows that *are* shopping-list items.
   *
   * The task universe and the shopping lists are disjoint, and `read()` above
   * carries the `is_list_item = false` half of that on every one of the fifteen
   * reads without any of them having to know. This is the deliberate opt-in for
   * the handful of surfaces that want the other half — the list page, its
   * counts, and the widget tile.
   *
   * Same shape as the `deleted_at` rule it sits beside, and for the same
   * reason: a read that forgets the condition doesn't fail, it shows someone
   * their groceries in Today.
   */
  private readItems<Q extends string = "*">(columns: Q = "*" as Q) {
    return this.base(columns).eq("is_list_item", true);
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
        const row = data as {
          timezone?: string;
          status_sync_swept_through?: string | null;
        } | null;
        const timezone = row?.timezone ?? undefined;
        const todayISO = timezone
          ? todayISOInZone(timezone)
          : todayLocalISO();
        return {
          settings,
          horizonISO: resolveStatusSyncHorizon(settings, todayISO),
          // `?? null` covers both a null column and a deploy that landed ahead
          // of its migration, and both mean the same thing: never swept.
          sweptThrough: row?.status_sync_swept_through ?? null,
        };
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
   * Apply the date→status half to the days that have *newly* come inside the
   * horizon — the pass that catches tasks whose scheduled date didn't move but
   * whose day arrived. One filtered UPDATE, not a fan-out.
   *
   * Call it where the app can notice a new day: page load on web, foreground
   * on mobile. Returns the tasks it moved, so the caller can refetch and tell
   * the user what happened.
   *
   * **This is a sweep over new days, not a re-application of the rule.** It
   * used to promote everything scheduled on or before the horizon on every
   * single run, which made a hand-demoted task impossible to keep demoted: the
   * user moved it back to Not started, the next foreground moved it to Next
   * again, and nothing said why. `status_sync_swept_through` closes off the
   * days already accounted for, so a day is promoted the once — when it comes
   * near — and the user's own edits stand after that.
   *
   * The watermark advances even when nothing matched. Leaving it behind on an
   * empty run would reopen the same band on the next pass, and re-promoting
   * demoted tasks is exactly what it exists to prevent.
   */
  async syncScheduledToStatus(): Promise<{
    updated: number;
    moved: { id: string; title: string }[];
    /**
     * One line for the user, or null when there is nothing to say. Composed
     * here rather than by each app so the phone and the laptop can't word the
     * same event differently — and because the settings needed to word it are
     * already loaded here and nowhere near either caller.
     */
    notice: string | null;
    error: Error | null;
  }> {
    const none = { updated: 0, moved: [], notice: null, error: null };
    const ctx = await this.statusSyncContext();
    if (!ctx || !ctx.settings.status_sync_promote) return none;

    const target = ctx.settings.status_sync_status;
    const from = statusesBelow(target);
    if (from.length === 0) return none;

    const band = sweepPromoteRange(ctx.horizonISO, ctx.sweptThrough);
    if (!band) return none;

    let query = this.supabase
      .from("tasks")
      .update({ status: target })
      .is("deleted_at", null)
      .lte("scheduled_date", band.through)
      .in("status", from);
    if (this.userId) query = query.eq("user_id", this.userId);
    // Exclusive: a day is swept once. `after` is null only on the very first
    // sweep for a user, which deliberately takes in everything already near.
    if (band.after !== null) {
      query = query.gt("scheduled_date", band.after);
    }
    // `scheduled_date <= through` is already false for NULL (SQL three-valued
    // logic), so undated tasks are excluded — stated explicitly because that
    // exclusion is required, not incidental.
    const { data, error } = await query
      .not("scheduled_date", "is", null)
      .select("id, title");
    if (error) {
      return { updated: 0, moved: [], notice: null, error: error as Error };
    }

    const moved = (data as { id: string; title: string }[] | null) ?? [];
    // Only now, and only on success: a watermark advanced past a band that
    // failed to write would skip those days forever.
    await this.recordSweptThrough(band.through);
    return {
      updated: moved.length,
      moved,
      notice: describeStatusSyncSweep(moved, ctx.settings),
      error: null,
    };
  }

  /**
   * Move the sweep watermark forward. Best-effort: the promotions have already
   * landed and there is nothing to roll back to, so a failure here costs a
   * repeated (idempotent) band on the next sweep rather than a wrong list.
   */
  private async recordSweptThrough(through: string): Promise<void> {
    try {
      let query = this.supabase
        .from("user_preferences")
        .update({ status_sync_swept_through: through });
      if (this.userId) query = query.eq("user_id", this.userId);
      await query;
      // Keep the cached context honest, or the next write in this same minute
      // still thinks the band is open.
      if (this.syncCache?.ctx) this.syncCache.ctx.sweptThrough = through;
    } catch {
      // swallow — see above
    }
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
   * The past tasks a quick-add suggestion is inferred from.
   *
   * Three narrow columns and no `*`: this is read once per session to build an
   * index the composer then queries on every keystroke, and a row's title, its
   * project and its estimate are the whole of what the index counts. Selecting
   * the rest would multiply the payload for fields nothing reads.
   *
   * Bounded and newest-first, unlike `listTags`, which has to sweep everything
   * because a tag it misses does not exist to the app at all. A suggestion has
   * no such requirement — it is a guess from recent habit, and older rows both
   * weigh less and describe a project list that has since moved on.
   *
   * The aggregation is `buildSuggestionIndex` in `@do-done/shared`, so the
   * demo sandbox and any future mobile caller guess the same way.
   */
  async suggestionHistory(opts?: {
    limit?: number;
  }): Promise<{ data: SuggestionRow[]; error: Error | null }> {
    let query = this.read("title, project_id, duration_minutes");
    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(opts?.limit ?? SUGGESTION_HISTORY_LIMIT);

    if (error) return { data: [], error: error as Error };
    return { data: (data as SuggestionRow[]) ?? [], error: null };
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
   * on a tag view is the entire reason the page exists.
   */
  async listByTag(
    tag: string,
    opts?: { limit?: number }
  ): Promise<{ data: Task[]; error: Error | null }> {
    return this.list({ tags: [tag], limit: opts?.limit ?? 500, offset: 0 });
  }

  /**
   * `base()`, not `read()`: the isolation rule is about *lists* of tasks, not
   * about addressing one. A shopping item is a real row with a real id — it
   * has a `/task/<id>` link, it opens in the editor, and a location reminder's
   * notification carries its id — so a by-id read that filtered list items out
   * would 404 on a row the app itself had just linked to.
   */
  async getById(id: string): Promise<{ data: Task | null; error: Error | null }> {
    const { data, error } = await this.base()
      .eq("id", id)
      .single();
    return {
      data: normalizeTask(data as Task | null),
      error: error as Error | null,
    };
  }

  async create(input: CreateTaskInput): Promise<{
    data: Task | null;
    error: Error | null;
    autoSync?: StatusSyncApplied;
  }> {
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
    let autoSync: StatusSyncApplied | undefined;
    if (syncCtx) {
      const applied = statusSyncPatch({
        prior: null,
        patch: {
          status: input.status,
          scheduled_date: input.scheduled_date ?? undefined,
        },
        settings: syncCtx.settings,
        horizonISO: syncCtx.horizonISO,
      });
      Object.assign(row, applied);
      // A create only counts as a surprise when the caller had an opinion the
      // rule overrode. Landing in Next with no status asked for is the default
      // arriving, not the rule taking something away — and a toast on every
      // quick-add is how a feature gets switched off.
      const overrode =
        (applied.status !== undefined && input.status !== undefined) ||
        (applied.scheduled_date !== undefined &&
          input.scheduled_date != null);
      const notice = overrode
        ? describeStatusSyncNotice(applied, syncCtx.settings)
        : null;
      if (notice) autoSync = { ...applied, notice };
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
    return { data: created, error: null, autoSync };
  }

  async update(
    id: string,
    input: UpdateTaskInput,
    actor: PetEventActor = "user"
  ): Promise<{
    data: Task | null;
    error: Error | null;
    autoSync?: StatusSyncApplied;
  }> {
    // Read the prior row so we can (a) detect a status→done transition for
    // completion feeding, and (b) compute which tracked fields are about to
    // transition from unset → set for energy feeding. One extra SELECT per
    // update is the price of stateless dedupe — the autosave hook fires at
    // most ~4/sec, well within Supabase headroom.
    // base(), not read() — same reason as getById: ticking an item off a
    // shopping list is an update by id, and reading its prior state through
    // the task-universe filter would find nothing and lose the status
    // transition that stamps completed_at.
    const prevRes = await this.base().eq("id", id).maybeSingle();
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

    // Re-parenting inherits the new parent's project, on the same terms as
    // creation: only when the caller didn't name a project in the same write.
    // Without this the two ways of making a task a subtask disagree — created
    // under a parent it lands in the parent's project, moved under one it keeps
    // whatever it had.
    if (
      input.parent_task_id &&
      input.project_id === undefined &&
      input.parent_task_id !== prior?.parent_task_id
    ) {
      const { data: parent } = await this.getById(input.parent_task_id);
      if (parent?.project_id) patch.project_id = parent.project_id;
    }

    // Status ↔ schedule auto-sync. Folded into the same UPDATE rather than
    // chased with a second write, so the row the caller gets back is already
    // the row the rule wants — no flicker, and no window where a concurrent
    // read sees the half-synced state.
    const syncCtx = await this.statusSyncContext();
    let autoSync: StatusSyncApplied | undefined;
    if (syncCtx && prior) {
      const applied = statusSyncPatch({
        prior: { status: prior.status, scheduled_date: prior.scheduled_date },
        patch: {
          status: input.status,
          scheduled_date: input.scheduled_date,
        },
        settings: syncCtx.settings,
        horizonISO: syncCtx.horizonISO,
      });
      Object.assign(patch, applied);
      const notice = describeStatusSyncNotice(applied, syncCtx.settings);
      if (notice) autoSync = { ...applied, notice };
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

    // A parent's move carries its subtree with it. Filing a task into Finance
    // and leaving its subtasks in whatever they were is the same bug the
    // create-time inheritance above fixed, arriving a day later — the subtasks
    // are the same work, and a project page that shows the parent without them
    // misreports what is left. Awaited, not fired and forgotten, so the
    // caller's cache invalidation lands after the children have moved.
    //
    // Tested against the *result*, not the input, so a project acquired by
    // re-parenting propagates too. A subtask that was deliberately filed
    // elsewhere is overwritten: the parent moving is the more recent
    // instruction, and the alternative — remembering which subtasks had been
    // hand-filed — is state nothing on this surface can show the user.
    if (prior && updated.project_id !== prior.project_id) {
      await this.cascadeProject(id, updated.project_id);
    }

    const userId = this.userId;
    const supabase = this.supabase;

    /*
      Ticking a shopping item off records it in the pantry.

      Done here rather than at each place a tick happens, because this is the
      single door web, mobile and MCP all write through. The other candidate was
      `clearGot`, which would miss two cases: an item ticked but never cleared,
      and an item deleted by hand after being bought.

      Fire-and-forget, and errors are swallowed, for the same reason as the pet
      code below it. The task row is already correct, and a lost pantry entry
      costs one extra correction later, where a failed tick costs the user the
      thing they came to the shop for.
    */
    if (isCompletionTransition && updated.is_list_item && updated.project_id) {
      const listId = updated.project_id;
      void (async () => {
        try {
          const [{ PantryApi }, { storeHint }] = await Promise.all([
            import("./pantry.js"),
            import("@do-done/shared"),
          ]);
          await new PantryApi(supabase, userId).record(
            listId,
            updated.title,
            storeHint(updated)
          );
        } catch {
          // swallow — the pantry must never break a tick
        }
      })();
    }

    // Pet feeding — completion + edit are independent and may both fire on
    // the same write (e.g. user saves the task with a new description AND
    // marks it done in one PATCH).
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

    return { data: updated, error: null, autoSync };
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
      // base(): a delete has to reach the whole subtree whatever it is made
      // of, and restore's undo token is computed from these ids.
      let query = this.base("id").in("parent_task_id", frontier);
      if (this.userId) query = query.eq("user_id", this.userId);
      const { data } = await query;
      frontier = ((data as { id: string }[] | null) ?? []).map((r) => r.id);
      ids.push(...frontier);
    }
    return ids;
  }

  /**
   * Move every descendant of `id` into `projectId`. Best-effort: the parent's
   * own move has already landed and there is nothing to roll back to, so a
   * failure here leaves the subtree behind rather than failing the write the
   * user actually asked for.
   */
  private async cascadeProject(
    id: string,
    projectId: string | null
  ): Promise<void> {
    const descendants = (await this.subtreeIds(id)).slice(1);
    if (descendants.length === 0) return;
    let query = this.supabase
      .from("tasks")
      .update({ project_id: projectId })
      .in("id", descendants);
    if (this.userId) query = query.eq("user_id", this.userId);
    await query;
  }

  /**
   * Delete a task and everything under it — reversibly.
   *
   * **Nothing is destroyed here.** The rows are stamped with `deleted_at` and
   * disappear from every read; the subtasks stay subtasks, the attachment rows
   * stay attached, the bytes stay in the bucket, the location links stay linked,
   * and the id stays the same. `restore()` puts it all back by clearing one
   * column, which is what lets Undo give back *the same task* rather than a new
   * row with the same title. `purgeDeleted()` does the real destroying later.
   *
   * This used to be a hard delete, and the reversal was `create()` from a
   * client-side snapshot — a new row, a new id, no subtasks, no files, and every
   * link handed out before the delete still broken afterwards.
   *
   * Returns the ids it touched, because that list *is* the undo token: it was
   * computed against the live tree, so a subtask deleted separately five minutes
   * ago is not in it and a restore correctly leaves it deleted.
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
   * leaves the files in the bucket forever with nothing in the app pointing at
   * them. Bytes first, rows second — an attachment row pointing at absent bytes
   * renders as permanently broken, while bytes with no row are merely invisible,
   * so a failure between the two lands on the invisible side.
   *
   * Best-effort on the Storage half by design: a bucket failure must not leave
   * rows that can never be collected.
   *
   * Driven from the apps rather than a server timer (web's `StatusSyncRunner`,
   * mobile's sweeps) — the same shape as `syncScheduledToStatus`, and for the
   * same reason: it is one filtered read that returns nothing in the ordinary
   * case, and it needs no infrastructure that a preview deploy will not have.
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

  // ── Shopping lists ───────────────────────────────────
  //
  // The only reads in the class that go through `readItems()`. Everything
  // above this point is the task universe and cannot see an item at all.

  /**
   * Every item on one list, bought and unbought, oldest first.
   *
   * Ascending `created_at` rather than `sort_order`: a shopping list is
   * append-only in practice — you say things in the order they occur to you —
   * and the first thing anyone does after adding an item is look for it at the
   * bottom. Manual reordering still works and still wins, because
   * `sort_order` leads the ordering; it just isn't what decides ties.
   */
  async listItems(
    listId: string
  ): Promise<{ data: Task[]; error: Error | null }> {
    let query = this.readItems()
      .eq("project_id", listId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (this.userId) query = query.eq("user_id", this.userId);
    const { data, error } = await query;
    return {
      data: normalizeTasks((data as Task[]) ?? []),
      error: error as Error | null,
    };
  }

  /**
   * Open and bought counts per list, for the sidebar and the lists index.
   *
   * Two narrow columns and no `.range()`, the same shape and cost as
   * `ProjectsApi.listWithCounts` — and deliberately a separate call from it,
   * because that one counts the task universe and this one counts what the
   * universe excludes. Merging them would mean one query that has to remember
   * which side of the isolation each row falls on.
   */
  async listCounts(): Promise<{
    data: Map<string, { open: number; got: number }>;
    error: Error | null;
  }> {
    let query = this.readItems("project_id, status").not(
      "project_id",
      "is",
      null
    );
    if (this.userId) query = query.eq("user_id", this.userId);
    const { data, error } = await query;
    if (error) return { data: new Map(), error: error as Error };

    const counts = new Map<string, { open: number; got: number }>();
    for (const row of (data ?? []) as Array<{
      project_id: string;
      status: TaskStatus;
    }>) {
      const entry = counts.get(row.project_id) ?? { open: 0, got: 0 };
      if (row.status === "done" || row.status === "cancelled") entry.got += 1;
      else entry.open += 1;
      counts.set(row.project_id, entry);
    }
    return { data: counts, error: null };
  }

  /**
   * Clear the bought items off a list — the action at the end of a shop.
   *
   * A soft delete of exactly the rows that are already ticked, which is what
   * makes a list *standing* rather than disposable: the list survives, its
   * history doesn't pile up in it, and the whole sweep is one undo token
   * because `restore()` takes ids.
   *
   * Deliberately not a hard delete. "Clear" reads as tidying, not destroying,
   * and someone who clears before noticing they mis-ticked something has the
   * same nine seconds back that every other deletion in the app offers.
   */
  async clearGot(
    listId: string
  ): Promise<{ data: string[]; error: Error | null }> {
    let find = this.readItems("id")
      .eq("project_id", listId)
      .in("status", ["done", "cancelled"]);
    if (this.userId) find = find.eq("user_id", this.userId);
    const { data: rows, error: findError } = await find;
    if (findError) return { data: [], error: findError as Error };

    const ids = ((rows as { id: string }[] | null) ?? []).map((r) => r.id);
    if (ids.length === 0) return { data: [], error: null };

    const stamp = new Date().toISOString();
    let wipe = this.supabase
      .from("tasks")
      .update({ deleted_at: stamp })
      .in("id", ids);
    if (this.userId) wipe = wipe.eq("user_id", this.userId);
    const { error } = await wipe;
    return { data: error ? [] : ids, error: (error as Error) ?? null };
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
