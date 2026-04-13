import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project, CreateProjectInput } from "@do-done/shared";

export class ProjectsApi {
  constructor(
    private supabase: SupabaseClient,
    private userId?: string
  ) {}

  async list(): Promise<{ data: Project[]; error: Error | null }> {
    let query = this.supabase
      .from("projects")
      .select("*")
      .order("sort_order");
    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    return { data: (data as Project[]) ?? [], error: error as Error | null };
  }

  async getById(id: string): Promise<{ data: Project | null; error: Error | null }> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .single();
    return { data: data as Project | null, error: error as Error | null };
  }

  async create(input: CreateProjectInput): Promise<{ data: Project | null; error: Error | null }> {
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
}
