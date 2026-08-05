import { NextResponse, type NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { getDisplayEventsFor } from "@/lib/calendar-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/calendar/events?start=YYYY-MM-DD&end=YYYY-MM-DD (end exclusive)
 *              [&tz=<IANA zone>]
 *
 * `tz` resolves the day bounds and event times in the caller's zone (mobile
 * sends its device zone); omitted, the user's stored preference applies.
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
  const { supabase, userId } = await authenticateRequest(request);
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

  const tz = searchParams.get("tz");
  if (tz && !isValidTimeZone(tz)) {
    return NextResponse.json({ error: "invalid tz" }, { status: 400 });
  }

  // Best-effort inside: no connection, pref off, Google failure all come
  // back as [] — the client renders tasks-only.
  const events = await getDisplayEventsFor(
    supabase,
    userId,
    start,
    end,
    tz ?? undefined
  );
  return NextResponse.json({ events });
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
