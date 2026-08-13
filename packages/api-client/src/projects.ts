import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Project,
  CreateProjectInput,
  UpdateProjectInput,
} from "@do-done/shared";
import { splitProjects } from "@do-done/shared";

// Spacing between adjacent projects' sort_order values. Leaving gaps means a
// single drag only rewrites the moved rows, never every row, and there's room
// to slot a project between two others without a full renumber.
const SORT_STEP = 1000;

export class ProjectsApi {
  constructor(
    private supabase: SupabaseClient,
    private userId?: string
  ) {}

  async list(): Promise<{ data: Project[]; error: Error | null }> {
    // Ascending sort_order is the user-chosen order; created_at breaks ties so
    // rows that still share a sort_order (e.g. pre-backfill) stay deterministic.
    let query = this.supabase
      .from("projects")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    return { data: (data as Project[]) ?? [], error: error as Error | null };
  }

  /**
   * The two sidebar sections, from one read.
   *
   * `list()` deliberately keeps returning *both* kinds and is what the quick-add
   * surfaces use: `milk #groceries` has to reach a list, so the token matcher
   * needs to see lists alongside projects. Splitting is a display concern, so
   * it happens here and in `splitProjects`, not in the query.
   */
  async listByKind(): Promise<{
    projects: Project[];
    lists: Project[];
    error: Error | null;
  }> {
    const { data, error } = await this.list();
    if (error) return { projects: [], lists: [], error };
    return { ...splitProjects(data), error: null };
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
    // New projects land at the end of the user's ordering rather than all
    // sharing the DB default of 0, so drag-to-reorder starts from a stable list.
    const sort_order = await this.nextSortOrder();
    const row = {
      ...input,
      sort_order,
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
    input: UpdateProjectInput
  ): Promise<{ data: Project | null; error: Error | null }> {
    let query = this.supabase.from("projects").update(input).eq("id", id);
    if (this.userId) query = query.eq("user_id", this.userId);
    const { data, error } = await query.select().single();
    return { data: data as Project | null, error: error as Error | null };
  }

  /**
   * Persist a user-chosen ordering. `orderedIds` is the full list of the
   * user's projects in their desired top-to-bottom order; each row is stamped
   * with an evenly spaced sort_order so `list()` returns them in this order
   * everywhere (sidebar, pickers, mobile, grouped views).
   *
   * Writes are fanned out in parallel — Supabase has no batch update for
   * distinct values — and each is scoped to the caller's own rows (RLS plus
   * the optional userId guard). Returns the first error, if any.
   */
  async reorder(orderedIds: string[]): Promise<{ error: Error | null }> {
    const results = await Promise.all(
      orderedIds.map((id, i) => {
        let query = this.supabase
          .from("projects")
          .update({ sort_order: (i + 1) * SORT_STEP })
          .eq("id", id);
        if (this.userId) query = query.eq("user_id", this.userId);
        return query;
      })
    );
    for (const { error } of results) {
      if (error) return { error: error as Error };
    }
    return { error: null };
  }

  /** The sort_order to give a newly created project: one step past the last. */
  private async nextSortOrder(): Promise<number> {
    let query = this.supabase
      .from("projects")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1);
    if (this.userId) query = query.eq("user_id", this.userId);
    const { data } = await query;
    const max =
      (data as Array<{ sort_order: number }> | null)?.[0]?.sort_order ?? 0;
    return max + SORT_STEP;
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
        // A deleted task must stop counting against its project the moment it
        // is hidden, or the sidebar disagrees with the list it opens.
        .is("deleted_at", null)
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
      if (
        t.status !== "done" &&
        t.status !== "cancelled" &&
        t.status !== "archived"
      )
        c.open_count++;
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
