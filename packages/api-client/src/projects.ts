import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project, CreateProjectInput } from "@do-done/shared";

export class ProjectsApi {
  constructor(
    private supabase: SupabaseClient,
    private userId?: string
  ) {}

  async list(): Promise<{ data: Project[]; error: Error | null }> {
    let query = this.supabase.from("projects").select("*").order("sort_order");
    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    return { data: (data as Project[]) ?? [], error: error as Error | null };
  }

  async getById(
    id: string
  ): Promise<{ data: Project | null; error: Error | null }> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .single();
    return { data: data as Project | null, error: error as Error | null };
  }

  async create(
    input: CreateProjectInput
  ): Promise<{ data: Project | null; error: Error | null }> {
    const row = {
      ...input,
      ...(this.userId ? { user_id: this.userId } : {}),
    };
    const { data, error } = await this.supabase
      .from("projects")
      .insert(row)
      .select()
      .single();
    return { data: data as Project | null, error: error as Error | null };
  }

  async update(
    id: string,
    input: Partial<CreateProjectInput>
  ): Promise<{ data: Project | null; error: Error | null }> {
    const { data, error } = await this.supabase
      .from("projects")
      .update(input)
      .eq("id", id)
      .select()
      .single();
    return { data: data as Project | null, error: error as Error | null };
  }

  async delete(id: string): Promise<{ error: Error | null }> {
    const { error } = await this.supabase
      .from("projects")
      .delete()
      .eq("id", id);
    return { error: error as Error | null };
  }

  /**
   * Returns task counts per project for the current user.
   * Useful for sidebar/list views.
   */
  async listWithCounts(): Promise<{
    data: Array<Project & { task_count: number; open_count: number }>;
    error: Error | null;
  }> {
    const [projectsRes, tasksRes] = await Promise.all([
      this.list(),
      this.supabase
        .from("tasks")
        .select("project_id, status")
        .not("project_id", "is", null),
    ]);

    if (projectsRes.error) {
      return { data: [], error: projectsRes.error };
    }

    const counts = new Map<string, { task_count: number; open_count: number }>();
    for (const t of (tasksRes.data ?? []) as Array<{
      project_id: string;
      status: string;
    }>) {
      if (!t.project_id) continue;
      const c = counts.get(t.project_id) ?? { task_count: 0, open_count: 0 };
      c.task_count++;
      if (t.status !== "done" && t.status !== "archived") c.open_count++;
      counts.set(t.project_id, c);
    }

    return {
      data: projectsRes.data.map((p) => ({
        ...p,
        task_count: counts.get(p.id)?.task_count ?? 0,
        open_count: counts.get(p.id)?.open_count ?? 0,
      })),
      error: null,
    };
  }
}
