import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { exchangeCodeForTokens } from "@/lib/google-calendar";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(
      `${origin}/settings?error=${encodeURIComponent(error ?? "no_code")}`
    );
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  try {
    const tokens = await exchangeCodeForTokens(
      code,
      `${origin}/api/calendar/callback`
    );

    // Upsert into calendar_sync table
    const { error: upsertError } = await supabase
      .from("calendar_sync")
      .upsert(
        {
          user_id: user.id,
          google_refresh_token: tokens.refresh_token,
          google_access_token: tokens.access_token,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      return NextResponse.redirect(
        `${origin}/settings?error=${encodeURIComponent(upsertError.message)}`
      );
    }

    // Backfill: enqueue all of this user's existing scheduled tasks so they
    // appear in Google right away. The DB trigger only fires on future task
    // changes, so without this a freshly connected calendar would stay empty
    // until each task is next edited. Only a date is required (time/duration
    // optional). Best-effort; the worker and manual sync recover if it fails.
    // Uses the service role to write the RLS-protected outbox. Duplicate pending
    // upserts are harmless — the worker is idempotent.
    try {
      const service = createServiceSupabase();
      const { data: scheduledTasks } = await service
        .from("tasks")
        .select("id")
        // Deleted tasks are not re-pushed: they have no place on a calendar,
        // and the row is only still here so Undo can give it back.
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
    } catch {
      // best-effort backfill — non-fatal
    }

    return NextResponse.redirect(`${origin}/settings?connected=1`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "exchange_failed";
    return NextResponse.redirect(
      `${origin}/settings?error=${encodeURIComponent(message)}`
    );
  }
}
