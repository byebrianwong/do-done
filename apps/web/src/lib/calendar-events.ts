import "server-only";
import { zonedClockToUtc, type CalendarEvent } from "@do-done/shared";
import { createServerSupabase } from "@/lib/supabase/server";
import { listDisplayEvents } from "@/lib/google-calendar";

const DEFAULT_TIMEZONE = "America/New_York";

/**
 * Google Calendar events to display for [startDay, endDayExclusive), local
 * YYYY-MM-DD. Best-effort: returns [] when the user isn't signed in, hasn't
 * connected Google Calendar, turned the "show events" preference off, or the
 * Google fetch fails — views render tasks-only in all of those cases.
 */
export async function getDisplayEvents(
  startDay: string,
  endDayExclusive: string
): Promise<CalendarEvent[]> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const [{ data: sync }, { data: prefs }] = await Promise.all([
    supabase
      .from("calendar_sync")
      .select("google_refresh_token")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("user_preferences")
      .select("show_calendar_events, timezone")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (!sync?.google_refresh_token) return [];
  if (prefs?.show_calendar_events === false) return [];

  // The day bounds are wall-clock dates in the USER's timezone — resolve them
  // there, not in the server's zone (UTC on a deployed host).
  const timeZone = prefs?.timezone ?? DEFAULT_TIMEZONE;
  const [sy, sm, sd] = startDay.split("-").map(Number);
  const [ey, em, ed] = endDayExclusive.split("-").map(Number);
  const timeMin = zonedClockToUtc(sy, sm, sd, 0, 0, timeZone).toISOString();
  const timeMax = zonedClockToUtc(ey, em, ed, 0, 0, timeZone).toISOString();

  try {
    return await listDisplayEvents(sync.google_refresh_token, timeMin, timeMax);
  } catch {
    // Calendar fetch failed (revoked token, network) — tasks-only view.
    return [];
  }
}
