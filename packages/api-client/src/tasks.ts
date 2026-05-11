import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilterInput,
  PetEventActor,
} from "@do-done/shared";

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
    return { data: (data as Task[]) ?? [], error: error as Error | null };
  }

  async getById(id: string): Promise<{ data: Task | null; error: Error | null }> {
    const { data, error } = await this.supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .single();
    return { data: data as Task | null, error: error as Error | null };
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
    return { data: data as Task | null, error: error as Error | null };
  }

  async update(
    id: string,
    input: UpdateTaskInput,
    actor: PetEventActor = "user"
  ): Promise<{ data: Task | null; error: Error | null }> {
    // Detect status→done transition so we can feed Pip after the write.
    let priorStatus: string | null = null;
    if (input.status === "done") {
      const prev = await this.supabase
        .from("tasks")
        .select("status")
        .eq("id", id)
        .single();
      priorStatus = (prev.data as { status: string } | null)?.status ?? null;
    }

    // Stamp completed_at on first transition to done.
    const patch: Record<string, unknown> = { ...input };
    if (input.status === "done" && priorStatus !== "done") {
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

    const updated = data as Task;
    if (input.status === "done" && priorStatus !== "done") {
      // Lazy import to avoid a circular dep at module load time.
      const { PetsApi } = await import("./pets.js");
      const pets = new PetsApi(this.supabase, this.userId);
      // Best-effort; never block or fail the task update if feeding fails.
      try {
        await pets.feedFromTask({ task: updated, actor });
      } catch {
        // swallow — pet plumbing must never break task writes
      }
    }

    return { data: updated, error: null };
  }

  async complete(
    id: string,
    actor: PetEventActor = "user"
  ): Promise<{ data: Task | null; error: Error | null }> {
    return this.update(id, { status: "done" }, actor);
  }

  async search(query: string): Promise<{ data: Task[]; error: Error | null }> {
    const { data, error } = await this.supabase
      .from("tasks")
      .select("*")
      .textSearch("fts", query)
      .limit(20);
    return { data: (data as Task[]) ?? [], error: error as Error | null };
  }

  async getInbox(): Promise<{ data: Task[]; error: Error | null }> {
    return this.list({ status: "inbox" } as TaskFilterInput);
  }

  async getToday(): Promise<{ data: Task[]; error: Error | null }> {
    // Today = anything scheduled to be DONE on or before today (when_date),
    // OR DUE on or before today (due_date), OR bucketed as 'today'.
    //
    // Status filter is "anything not closed" (not done, not archived).
    // Crucially, inbox tasks with a when_date set DO show up here —
    // scheduling a task no longer requires moving it out of inbox.
    const today = new Date().toISOString().split("T")[0];
    let query = this.supabase
      .from("tasks")
      .select("*")
      .not("status", "in", "(done,archived)")
      .or(
        `when_date.lte.${today},due_date.lte.${today},when_bucket.eq.today`
      )
      .order("priority")
      .order("sort_order");

    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    return { data: (data as Task[]) ?? [], error: error as Error | null };
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
      .not("status", "in", "(done,archived)")
      .or(
        `and(when_date.gte.${today},when_date.lte.${endDate}),and(due_date.gte.${today},due_date.lte.${endDate})`
      )
      .order("when_date", { nullsFirst: false })
      .order("due_date", { nullsFirst: false })
      .order("priority");

    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    return { data: (data as Task[]) ?? [], error: error as Error | null };
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
