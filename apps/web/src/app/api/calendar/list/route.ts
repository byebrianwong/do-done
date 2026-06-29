import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { listCalendars } from "@/lib/google-calendar";

// googleapis needs the Node runtime; never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: sync } = await supabase
    .from("calendar_sync")
    .select("google_refresh_token, calendar_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!sync) {
    return NextResponse.json({ error: "not_connected" }, { status: 400 });
  }

  try {
    const calendars = await listCalendars(sync.google_refresh_token);
    return NextResponse.json({
      calendars,
      selected: sync.calendar_id ?? "primary",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "list_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
