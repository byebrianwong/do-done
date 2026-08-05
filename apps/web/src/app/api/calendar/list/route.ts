import { NextResponse, type NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { listCalendars } from "@/lib/google-calendar";

// googleapis needs the Node runtime; never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/calendar/list
 *
 * Returns { calendars, selected, hidden } — every calendar in the user's
 * Google list, which one receives synced tasks, and the ids they've switched
 * off for display (`null` = never configured, so Google's own visible flags
 * apply).
 *
 * Auth: cookie session on web, `Authorization: Bearer <supabase access token>`
 * from the mobile settings screen. Google needs the refresh token and client
 * secret, which never leave the server, so mobile can't list calendars itself.
 */
export async function GET(request: NextRequest) {
  const { supabase, userId } = await authenticateRequest(request);
  if (!supabase || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: sync } = await supabase
    .from("calendar_sync")
    .select("google_refresh_token, calendar_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!sync) {
    return NextResponse.json({ error: "not_connected" }, { status: 400 });
  }

  // Missing column on an older deploy, or no prefs row yet, both mean "never
  // configured" — the picker then seeds itself from Google's visible flags.
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  const hidden = Array.isArray(prefs?.hidden_calendar_ids)
    ? (prefs.hidden_calendar_ids as string[])
    : null;

  try {
    const calendars = await listCalendars(sync.google_refresh_token);
    return NextResponse.json({
      calendars,
      selected: sync.calendar_id ?? "primary",
      hidden,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "list_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
