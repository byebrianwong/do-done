import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const calendarId = body?.calendar_id;
  const calendarSummary =
    typeof body?.calendar_summary === "string" ? body.calendar_summary : null;
  if (!calendarId || typeof calendarId !== "string") {
    return NextResponse.json({ error: "calendar_id required" }, { status: 400 });
  }

  // Switch the synced calendar. The service role bypasses RLS to touch the
  // outbox and reset watch state.
  const service = createServiceSupabase();

  // Unlink existing events so the tasks re-create on the newly chosen calendar.
  // (Events already on the previous calendar are left in place.)
  await service
    .from("tasks")
    .update({ calendar_event_id: null })
    .eq("user_id", user.id)
    .not("calendar_event_id", "is", null);

  // Point at the new calendar and reset the watch channel + sync token so the
  // worker opens a fresh watch on the new calendar.
  await service
    .from("calendar_sync")
    .update({
      calendar_id: calendarId,
      calendar_summary: calendarSummary,
      watch_channel_id: null,
      watch_resource_id: null,
      watch_expiration: null,
      watch_token: null,
      last_sync_token: null,
    })
    .eq("user_id", user.id);

  // Enqueue a re-push of all scheduled tasks onto the new calendar.
  const { data: scheduledTasks } = await service
    .from("tasks")
    .select("id")
    // Deleted tasks are not re-pushed: they have no place on a calendar, and
    // the row is only still here so Undo can give it back.
    .is("deleted_at", null)
    .eq("user_id", user.id)
    .not("scheduled_date", "is", null)
    .not("status", "in", "(done,cancelled)");
  if (scheduledTasks && scheduledTasks.length > 0) {
    await service.from("calendar_outbox").insert(
      scheduledTasks.map((t) => ({
        user_id: user.id,
        task_id: t.id as string,
        op: "upsert",
      }))
    );
  }

  return NextResponse.json({ ok: true });
}
