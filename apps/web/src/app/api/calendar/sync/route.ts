import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { TasksApi } from "@do-done/api-client";
import {
  pushTaskToCalendar,
  pullCalendarChanges,
} from "@/lib/google-calendar";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Get refresh token for this user
  const { data: sync, error: syncErr } = await supabase
    .from("calendar_sync")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (syncErr || !sync) {
    return NextResponse.json(
      { error: "calendar_not_connected" },
      { status: 400 }
    );
  }

  const tasks = new TasksApi(supabase, user.id);
  const stats = { pushed: 0, pulled: 0, errors: [] as string[] };

  // ── PUSH: tasks with date+duration that aren't yet on the calendar
  const { data: pushable, error: listErr } = await tasks.list({
    limit: 100,
    offset: 0,
  });
  if (listErr) {
    stats.errors.push(`list_tasks: ${listErr.message}`);
  } else {
    for (const task of pushable) {
      if (!task.due_date || !task.duration_minutes) continue;
      if (task.status === "done" || task.status === "archived") continue;

      try {
        const eventId = await pushTaskToCalendar(
          sync.google_refresh_token,
          task
        );
        if (eventId && eventId !== task.calendar_event_id) {
          await tasks.update(task.id, { calendar_event_id: eventId });
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
      sync.last_sync_token
    );

    for (const change of changes) {
      if (!change.taskId) continue;

      if (change.status === "cancelled") {
        await tasks.update(change.taskId, { calendar_event_id: null });
      } else if (change.start) {
        const startDate = change.start.toISOString();
        const date = startDate.split("T")[0];
        const time = startDate.split("T")[1].slice(0, 5);
        const durationMinutes = change.end
          ? Math.round((change.end.getTime() - change.start.getTime()) / 60000)
          : null;

        await tasks.update(change.taskId, {
          due_date: date,
          due_time: time,
          ...(durationMinutes && { duration_minutes: durationMinutes }),
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
