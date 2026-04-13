import type { SupabaseClient } from "@supabase/supabase-js";
import type { Location, CreateLocationInput, TaskLocation } from "@do-done/shared";

export class LocationsApi {
  constructor(
    private supabase: SupabaseClient,
    private userId?: string
  ) {}

  async list(): Promise<{ data: Location[]; error: Error | null }> {
    let query = this.supabase.from("locations").select("*").order("name");
    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    return { data: (data as Location[]) ?? [], error: error as Error | null };
  }

  async create(input: CreateLocationInput): Promise<{ data: Location | null; error: Error | null }> {
    const row = {
      ...input,
      ...(this.userId ? { user_id: this.userId } : {}),
    };
    const { data, error } = await this.supabase
      .from("locations")
      .insert(row)
      .select()
      .single();
    return { data: data as Location | null, error: error as Error | null };
  }

  async linkTask(
    taskId: string,
    locationId: string,
    triggerType: "enter" | "exit"
  ): Promise<{ error: Error | null }> {
    const { error } = await this.supabase.from("task_locations").insert({
      task_id: taskId,
      location_id: locationId,
      trigger_type: triggerType,
    });
    return { error: error as Error | null };
  }

  async getTaskLocations(taskId: string): Promise<{ data: TaskLocation[]; error: Error | null }> {
    const { data, error } = await this.supabase
      .from("task_locations")
      .select("*, locations(*)")
      .eq("task_id", taskId);
    return { data: (data as TaskLocation[]) ?? [], error: error as Error | null };
  }
}
