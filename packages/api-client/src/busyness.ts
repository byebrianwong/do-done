import type { SupabaseClient } from "@supabase/supabase-js";
import type { Task, TaskPriority } from "@do-done/shared";

/**
 * One item that contributes to a day's busyness: either a task scheduled
 * for that day (scheduled_date matches), or a calendar event from Google.
 *
 * Events are not produced by this module — they come from a server-side
 * fetch against Google Calendar API in apps/web (the refresh token lives
 * in the calendar_sync table and is never exposed to the client). The
 * web component merges task-busyness + event-busyness before passing
 * the combined array to the calendar UI.
 */
export type BusyItem = {
  type: "task" | "event";
  id: string;
  title: string;
  duration_minutes: number;
  /** Tasks only. Events don't have a priority concept. */
  priority?: TaskPriority;
  /** Events only. ISO timestamp; tasks use start-of-day implicitly. */
  start_time?: string;
};

export type DayBusyness = {
  /** YYYY-MM-DD. */
  date: string;
  items: BusyItem[];
  /** Sum of all item durations on this day. */
  total_minutes: number;
};

/**
 * Build a per-day map of busyness items from a flat list of tasks.
 * Pure function — no Supabase dependency. Useful for the web component
 * that merges task-busyness with calendar-event-busyness on the client.
 *
 * Tasks with no scheduled_date are skipped (they don't appear on the calendar).
 * Tasks with duration_minutes = null default to 30 minutes so they still
 * show up as a thin dot.
 */
export function groupTasksByDate(tasks: Task[]): Map<string, BusyItem[]> {
  const byDate = new Map<string, BusyItem[]>();
  for (const t of tasks) {
    if (!t.scheduled_date) continue;
    const item: BusyItem = {
      type: "task",
      id: t.id,
      title: t.title,
      duration_minutes: t.duration_minutes ?? 30,
      priority: t.priority,
    };
    const existing = byDate.get(t.scheduled_date);
    if (existing) {
      existing.push(item);
    } else {
      byDate.set(t.scheduled_date, [item]);
    }
  }
  return byDate;
}

/**
 * Materialize the calendar view: every day in [startDate, endDate] gets a
 * DayBusyness entry (even empty ones, so the UI can render placeholders).
 */
export function buildDaysInRange(
  startDate: string,
  endDate: string,
  itemsByDate: Map<string, BusyItem[]>
): DayBusyness[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (end < start) return [];

  const out: DayBusyness[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const dateStr = cursor.toISOString().split("T")[0];
    const items = itemsByDate.get(dateStr) ?? [];
    const total_minutes = items.reduce(
      (sum, i) => sum + i.duration_minutes,
      0
    );
    out.push({ date: dateStr, items, total_minutes });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export class BusynessApi {
  constructor(
    private supabase: SupabaseClient,
    private userId?: string
  ) {}

  /**
   * Fetch all open tasks scheduled (via scheduled_date) in the given range and
   * return a DayBusyness[] keyed by YYYY-MM-DD date. Skips done/cancelled
   * tasks since they aren't part of the "what's coming up" view.
   *
   * Date range is inclusive on both ends. Pass start = today and
   * end = today + 14 days for the default modal view.
   *
   * Calendar events are NOT included here — those come from a separate
   * server-side fetch (see comment on BusyItem.type = "event"). To get
   * the merged view, fetch from this API and from /api/calendar/busyness
   * (web only) and combine client-side.
   */
  async getTasksRange(
    startDate: string,
    endDate: string
  ): Promise<{ data: DayBusyness[]; error: Error | null }> {
    let query = this.supabase
      .from("tasks")
      .select(
        "id, title, scheduled_date, duration_minutes, priority, status, depth"
      )
      .is("deleted_at", null)
      .not("scheduled_date", "is", null)
      .gte("scheduled_date", startDate)
      .lte("scheduled_date", endDate)
      .not("status", "in", "(done,cancelled,archived)");

    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    if (error) return { data: [], error: error as Error };

    const tasks = (data ?? []) as Task[];
    const byDate = groupTasksByDate(tasks);
    return { data: buildDaysInRange(startDate, endDate, byDate), error: null };
  }
}
