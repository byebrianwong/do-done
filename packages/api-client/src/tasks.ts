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
    const today = new Date().toISOString().split("T")[0];
    let query = this.supabase
      .from("tasks")
      .select("*")
      .in("status", ["todo", "in_progress"])
      .lte("due_date", today)
      .order("priority")
      .order("sort_order");

    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    return { data: (data as Task[]) ?? [], error: error as Error | null };
  }

  async getUpcoming(days: number = 7): Promise<{ data: Task[]; error: Error | null }> {
    const end = new Date();
    end.setDate(end.getDate() + days);
    const endDate = end.toISOString().split("T")[0];

    let query = this.supabase
      .from("tasks")
      .select("*")
      .in("status", ["todo", "in_progress"])
      .not("due_date", "is", null)
      .lte("due_date", endDate)
      .order("due_date")
      .order("priority");

    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    return { data: (data as Task[]) ?? [], error: error as Error | null };
  }
}
