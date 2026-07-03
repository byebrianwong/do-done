import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { TasksApi } from "@do-done/api-client";
import { wallClockInZone } from "@do-done/shared";
import { pushTaskToCalendar, pullCalendarChanges } from "@/lib/google-calendar";

// googleapis needs the Node runtime; never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Matches UserPreferencesSchema's default — used when a user has no prefs row.
const DEFAULT_TIMEZONE = "America/New_York";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: sync, error: syncErr } = await supabase
    .from("calendar_sync")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (syncErr || !sync) {
    return NextResponse.json({ error: "calendar_not_connected" }, { status: 400 });
  }

  // Tasks store wall-clock dates/times in the user's timezone; pushing to and
  // pulling from Google needs that zone to convert to/from absolute instants.
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("timezone")
    .eq("user_id", user.id)
    .maybeSingle();
  const timeZone = prefs?.timezone ?? DEFAULT_TIMEZONE;
  const calendarId = sync.calendar_id ?? "primary";

  const tasks = new TasksApi(supabase, user.id);
  // Pull changes go through the RPC (service role): it stamps app.sync_origin so
  // the enqueue trigger doesn't loop, and applies etag-based echo suppression.
  const service = createServiceSupabase();
  const stats = { pushed: 0, pulled: 0, errors: [] as string[] };

  // ── PUSH: scheduled tasks (date required; time/duration optional)
  const { data: pushable, error: listErr } = await tasks.list({
    limit: 100,
    offset: 0,
  });
  if (listErr) {
    stats.errors.push(`list_tasks: ${listErr.message}`);
  } else {
    for (const task of pushable) {
      if (!task.when_date) continue;
      if (task.status === "done" || task.status === "cancelled") continue;

      try {
        const pushed = await pushTaskToCalendar(
          sync.google_refresh_token,
          task,
          timeZone,
          calendarId
        );
        if (pushed.id) {
          await tasks.update(task.id, {
            calendar_event_id: pushed.id,
            calendar_event_etag: pushed.etag,
          });
        }
        stats.pushed++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        stats.errors.push(`push ${task.id}: ${msg}`);
      }
    }
  }

  // ── PULL: changes from Google Calendar
  try {
    const { changes, nextSyncToken } = await pullCalendarChanges(
      sync.google_refresh_token,
      sync.last_sync_token,
      calendarId
    );

    for (const change of changes) {
      if (!change.taskId) continue;

      if (change.status === "cancelled") {
        await service.rpc("calendar_apply_remote_change", {
          p_task_id: change.taskId,
          p_cancelled: true,
          p_due_date: null,
          p_due_time: null,
          p_duration: null,
          p_etag: change.etag,
        });
      } else if (change.allDay && change.date) {
        await service.rpc("calendar_apply_remote_change", {
          p_task_id: change.taskId,
          p_cancelled: false,
          p_due_date: change.date,
          p_due_time: null,
          p_duration: null,
          p_etag: change.etag,
        });
      } else if (change.start) {
        const { date, time } = wallClockInZone(change.start, timeZone);
        const duration = change.end
          ? Math.round((change.end.getTime() - change.start.getTime()) / 60000)
          : null;
        await service.rpc("calendar_apply_remote_change", {
          p_task_id: change.taskId,
          p_cancelled: false,
          p_due_date: date,
          p_due_time: time,
          p_duration: duration,
          p_etag: change.etag,
        });
      }
      stats.pulled++;
    }

    await supabase
      .from("calendar_sync")
      .update({
        last_sync_token: nextSyncToken,
        synced_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    stats.errors.push(`pull: ${msg}`);
  }

  return NextResponse.json(stats);
}
