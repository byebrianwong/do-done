import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { getDisplayEventsFor } from "@/lib/calendar-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/calendar/events?start=YYYY-MM-DD&end=YYYY-MM-DD (end exclusive)
 *
 * Returns { events: CalendarEvent[] } — the user's Google Calendar events for
 * read-only display, same source the web views use. Exists for clients that
 * can't run the server-side fetch themselves (the mobile app): Google access
 * needs the refresh token + client secret, which never leave the server.
 *
 * Auth: the browser's cookie session, or `Authorization: Bearer <supabase
 * access token>` for the mobile app (which has no cookies). The bearer client
 * runs with the anon key + the user's JWT, so RLS scopes every read exactly
 * like a browser session.
 */
export async function GET(request: NextRequest) {
  const { supabase, userId } = await authenticate(request);
  if (!supabase || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  // Reject malformed bounds loudly — a silent {events: []} would make a
  // client-side date-formatting bug look like a disconnected calendar.
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!start || !end || !DAY_RE.test(start) || !DAY_RE.test(end)) {
    return NextResponse.json(
      { error: "start and end query params must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  // Best-effort inside: bad bounds, no connection, pref off, Google failure
  // all come back as [] — the client renders tasks-only.
  const events = await getDisplayEventsFor(supabase, userId, start, end);
  return NextResponse.json({ events });
}

async function authenticate(
  request: NextRequest
): Promise<{ supabase: SupabaseClient | null; userId: string | null }> {
  const bearer = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");

  if (bearer) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return { supabase: null, userId: null };
    const supabase = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser(bearer);
    return { supabase, userId: user?.id ?? null };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, userId: user?.id ?? null };
}
