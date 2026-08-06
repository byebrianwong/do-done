import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Location,
  CreateLocationInput,
  TaskLocation,
  TriggerType,
} from "@do-done/shared";

/** A saved location plus the open tasks that want to be reminded there. */
export interface LocationWithPending {
  location: Location;
  /** Distinct trigger types that still have at least one open task. */
  triggers: TriggerType[];
  /** Count of open (not done/cancelled) tasks linked to this location. */
  pendingCount: number;
}

const CLOSED_STATUSES = new Set(["done", "cancelled"]);

export class LocationsApi {
  constructor(
    private supabase: SupabaseClient,
    private userId?: string
  ) {}

  /**
   * The user's *saved* places — what a picker or the places manager means by
   * "my locations".
   *
   * One-off places (`is_saved = false`) are deliberately absent. They exist to
   * carry a single task's reminder and are swept away with it; listing them
   * would refill the very list this feature exists to keep short. Use
   * `listAll()` for anything that has to see every geofenceable place.
   */
  async list(): Promise<{ data: Location[]; error: Error | null }> {
    let query = this.supabase
      .from("locations")
      .select("*")
      .eq("is_saved", true)
      .order("name");
    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    return { data: (data as Location[]) ?? [], error: error as Error | null };
  }

  /**
   * Every place, saved or one-off. Only the geofence path wants this: the OS
   * has to watch a one-off place exactly as it watches a saved one.
   */
  async listAll(): Promise<{ data: Location[]; error: Error | null }> {
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

  async update(
    id: string,
    patch: Partial<CreateLocationInput>
  ): Promise<{ data: Location | null; error: Error | null }> {
    let query = this.supabase
      .from("locations")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query.select().single();
    return { data: data as Location | null, error: error as Error | null };
  }

  /**
   * Delete a saved location. `task_locations` rows cascade, so any task
   * reminding at this place quietly loses that reminder — callers should warn
   * when `pendingCount` is non-zero.
   */
  async remove(id: string): Promise<{ error: Error | null }> {
    let query = this.supabase.from("locations").delete().eq("id", id);
    if (this.userId) query = query.eq("user_id", this.userId);

    const { error } = await query;
    return { error: error as Error | null };
  }

  async linkTask(
    taskId: string,
    locationId: string,
    triggerType: TriggerType
  ): Promise<{ error: Error | null }> {
    const { error } = await this.supabase.from("task_locations").insert({
      task_id: taskId,
      location_id: locationId,
      trigger_type: triggerType,
    });
    return { error: error as Error | null };
  }

  async unlinkTask(
    taskId: string,
    locationId: string,
    triggerType: TriggerType
  ): Promise<{ error: Error | null }> {
    const { error } = await this.supabase
      .from("task_locations")
      .delete()
      .eq("task_id", taskId)
      .eq("location_id", locationId)
      .eq("trigger_type", triggerType);
    return { error: error as Error | null };
  }

  async getTaskLocations(taskId: string): Promise<{ data: TaskLocation[]; error: Error | null }> {
    const { data, error } = await this.supabase
      .from("task_locations")
      .select("*, locations(*)")
      .eq("task_id", taskId);
    return { data: (data as TaskLocation[]) ?? [], error: error as Error | null };
  }

  /**
   * Promote a one-off place into Saved places, optionally renaming it on the
   * way. Attaching a place inline is the fast path; this is the "actually, keep
   * this one" afterthought, and it must survive the orphan sweep, so it is a
   * plain update rather than a re-create (the task links keep pointing at the
   * same row).
   */
  async save(
    id: string,
    name?: string
  ): Promise<{ data: Location | null; error: Error | null }> {
    return this.update(id, {
      is_saved: true,
      ...(name ? { name } : {}),
    });
  }

  /**
   * Locations that still have at least one open task attached — i.e. the only
   * ones worth handing to the OS as geofences.
   *
   * The open/closed split runs client-side rather than as a nested PostgREST
   * filter. The join is small (a user has a handful of locations), and a
   * filter on an embedded column keeps the parent row and empties the child
   * array rather than dropping the parent — which would leave us registering
   * geofences for locations whose tasks are all done.
   */
  async listWithPendingTasks(): Promise<{
    data: LocationWithPending[];
    error: Error | null;
  }> {
    // listAll, not list: a one-off place is not in the picker but is very much
    // in the set the OS has to watch.
    const { data: locations, error: locError } = await this.listAll();
    if (locError) return { data: [], error: locError };
    if (locations.length === 0) return { data: [], error: null };

    const { data: links, error: linkError } = await this.supabase
      .from("task_locations")
      .select("location_id, trigger_type, tasks!inner(id, status)")
      .in(
        "location_id",
        locations.map((l) => l.id)
      );
    if (linkError) return { data: [], error: linkError as Error };

    type LinkRow = {
      location_id: string;
      trigger_type: TriggerType;
      tasks: { id: string; status: string } | { id: string; status: string }[] | null;
    };

    const byLocation = new Map<string, { triggers: Set<TriggerType>; count: number }>();
    for (const link of (links ?? []) as LinkRow[]) {
      // A to-one embed comes back as an object, but PostgREST versions differ
      // on whether it's wrapped in an array — normalise both shapes.
      const task = Array.isArray(link.tasks) ? link.tasks[0] : link.tasks;
      if (!task || CLOSED_STATUSES.has(task.status)) continue;

      const entry = byLocation.get(link.location_id) ?? {
        triggers: new Set<TriggerType>(),
        count: 0,
      };
      entry.triggers.add(link.trigger_type);
      entry.count += 1;
      byLocation.set(link.location_id, entry);
    }

    const result: LocationWithPending[] = [];
    for (const location of locations) {
      const entry = byLocation.get(location.id);
      if (!entry) continue;
      result.push({
        location,
        triggers: [...entry.triggers],
        pendingCount: entry.count,
      });
    }
    return { data: result, error: null };
  }
}
