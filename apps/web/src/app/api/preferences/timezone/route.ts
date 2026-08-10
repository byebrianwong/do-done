import { NextResponse, type NextRequest } from "next/server";
import { UserPrefsApi } from "@do-done/api-client";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const timezone = body?.timezone;
  if (typeof timezone !== "string" || !isValidTimeZone(timezone)) {
    return NextResponse.json({ error: "invalid_timezone" }, { status: 400 });
  }

  const prefs = new UserPrefsApi(supabase, user.id);
  const { error } = await prefs.updateTimezone(timezone);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Re-push the user's scheduled tasks so existing calendar events pick up the
  // corrected timezone (a no-op for all-day events). Best-effort; only if the
  // calendar is connected. Uses the service role to write the RLS-protected
  // outbox.
  try {
    const service = createServiceSupabase();
    const { data: connected } = await service
      .from("calendar_sync")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (connected) {
      const { data: scheduled } = await service
        .from("tasks")
        .select("id")
        // Deleted tasks are not re-pushed: they have no place on a calendar,
        // and the row is only still here so Undo can give it back.
        .is("deleted_at", null)
        .eq("user_id", user.id)
        .not("scheduled_date", "is", null)
        .not("scheduled_time", "is", null)
        .not("status", "in", "(done,cancelled)");
      if (scheduled && scheduled.length > 0) {
        await service.from("calendar_outbox").insert(
          scheduled.map((t) => ({
            user_id: user.id,
            task_id: t.id as string,
            op: "upsert",
          }))
        );
      }
    }
  } catch {
    // best-effort re-push — the timezone change itself already succeeded
  }

  return NextResponse.json({ ok: true });
}
