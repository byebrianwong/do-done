import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilterInput,
  PetEventActor,
  TrackedField,
} from "@do-done/shared";
import { TRACKED_FIELDS } from "@do-done/shared";

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

export class TasksApi {
  constructor(
    private supabase: SupabaseClient,
    private userId?: string
  ) {}

  async list(filters?: TaskFilterInput): Promise<{ data: Task[]; error: Error | null }> {
    let query = this.supabase.from("tasks").select("*");

    if (this.userId) query = query.eq("user_id", this.userId);
    if (filters?.status) query = query.eq("status", filters.status);
    if (filters?.project_id) query = query.eq("project_id", filters.project_id);
    if (filters?.priority) query = query.eq("priority", filters.priority);
    if (filters?.due_before) query = query.lte("due_date", filters.due_before);
    if (filters?.due_after) query = query.gte("due_date", filters.due_after);
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

  async getById(id: string): Promise<{ data: Task | null; error: Error | null }> {
    const { data, error } = await this.supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .single();
    return {
      data: normalizeTask(data as Task | null),
      error: error as Error | null,
    };
  }

  async create(input: CreateTaskInput): Promise<{ data: Task | null; error: Error | null }> {
    const row = {
      ...input,
      ...(this.userId ? { user_id: this.userId } : {}),
    };
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
    const prevRes = await this.supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    const prior = (prevRes.data as Task | null) ?? null;
    const priorStatus = prior?.status ?? null;

    // Stamp completed_at on first transition to done.
    const patch: Record<string, unknown> = { ...input };
    const isCompletionTransition =
      input.status === "done" && priorStatus !== "done";
    if (isCompletionTransition) {
      patch.completed_at = new Date().toISOString();
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

  async delete(id: string): Promise<{ error: Error | null }> {
    // Hard delete. FKs handle cleanup: task_locations cascade,
    // pet_events.task_id sets null, child tasks (parent_task_id) cascade.
    const { error } = await this.supabase.from("tasks").delete().eq("id", id);
    return { error: error as Error | null };
  }

  async reopen(id: string): Promise<{ data: Task | null; error: Error | null }> {
    // Move a done task back to active (not_started) and clear completed_at.
    // We don't route through update() because we want completed_at cleared
    // regardless of the input shape, which update()'s patch logic doesn't
    // handle on its own.
    const { data, error } = await this.supabase
      .from("tasks")
      .update({ status: "not_started", completed_at: null })
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
  ): Promise<{ data: Task[]; error: Error | null }> {
    // Fan out to individual updates so each one stamps completed_at, fires pet
    // events, etc. Supabase has no native batch-update for distinct patches.
    // Runs in parallel to amortize round-trip cost.
    const results = await Promise.all(
      updates.map(({ id, input }) => this.update(id, input))
    );
    const data: Task[] = [];
    for (const r of results) {
      if (r.error) return { data: [], error: r.error };
      if (r.data) data.push(r.data);
    }
    return { data, error: null };
  }

  async listCompleted(opts?: {
    limit?: number;
    before?: string;
  }): Promise<{ data: Task[]; error: Error | null }> {
    let query = this.supabase
      .from("tasks")
      .select("*")
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
    let query = this.supabase
      .from("tasks")
      .select("*")
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
    // Tasks with no when_date AND no due_date that aren't in a terminal
    // state. Bucket-only tasks (later/someday) belong here — they have
    // no concrete date, just a fuzzy intent. Used as a drag source in the
    // Upcoming view so the user can pull undated work onto a real day.
    let query = this.supabase
      .from("tasks")
      .select("*")
      .is("when_date", null)
      .is("due_date", null)
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
    // Tasks whose when_date OR due_date is strictly before today,
    // excluding done/cancelled. Mirrors isOverdue() in @do-done/shared.
    const today = new Date().toISOString().split("T")[0];
    let query = this.supabase
      .from("tasks")
      .select("*")
      .not("status", "in", "(done,cancelled,archived)")
      .or(`when_date.lt.${today},due_date.lt.${today}`)
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
    const { data, error } = await this.supabase
      .from("tasks")
      .select("*")
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
    // Today = anything scheduled to be DONE on or before today (when_date),
    // OR DUE on or before today (due_date), OR bucketed as 'today'.
    //
    // Status filter is "anything not closed" (not done, not cancelled).
    // Crucially, inbox tasks with a when_date set DO show up here —
    // scheduling a task no longer requires moving it out of inbox.
    const today = new Date().toISOString().split("T")[0];
    let query = this.supabase
      .from("tasks")
      .select("*")
      .not("status", "in", "(done,cancelled,archived)")
      .or(
        `when_date.lte.${today},due_date.lte.${today},when_bucket.eq.today`
      )
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
    // Upcoming = scheduled (when_date) OR due (due_date) at some point
    // BETWEEN today and today+days. Past-dated tasks are not "upcoming"
    // — overdue tasks live in Today. Bucket-only tasks (when_bucket
    // set, no date) live in their bucket views.
    //
    // Status filter mirrors getToday — inbox tasks with a future date
    // are upcoming even if the user hasn't promoted them to todo yet.
    const today = new Date().toISOString().split("T")[0];
    const end = new Date();
    end.setDate(end.getDate() + days);
    const endDate = end.toISOString().split("T")[0];

    let query = this.supabase
      .from("tasks")
      .select("*")
      .not("status", "in", "(done,cancelled,archived)")
      .or(
        `and(when_date.gte.${today},when_date.lte.${endDate}),and(due_date.gte.${today},due_date.lte.${endDate})`
      )
      .order("when_date", { nullsFirst: false })
      .order("due_date", { nullsFirst: false })
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
 * Prefer when_date (the explicit user "I'm doing this on …") over due_date
 * (the hard deadline). Returns YYYY-MM-DD or null.
 */
export function taskDate(task: Task): string | null {
  return task.when_date ?? task.due_date ?? null;
}
