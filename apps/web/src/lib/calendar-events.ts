import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { zonedClockToUtc, type CalendarEvent } from "@do-done/shared";
import { createServerSupabase } from "@/lib/supabase/server";
import { listDisplayEvents } from "@/lib/google-calendar";

const DEFAULT_TIMEZONE = "America/New_York";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Google Calendar events to display for [startDay, endDayExclusive), local
 * YYYY-MM-DD, for the user `userId` as seen through `supabase` (any client
 * authenticated as that user — cookie session on web pages, Bearer token for
 * the mobile API route; RLS scopes the reads either way). Best-effort:
 * returns [] when the user hasn't connected Google Calendar, turned the
 * "show events" preference off, the bounds are malformed (e.g. a garbage
 * ?week= param upstream), or the Google fetch fails — callers render
 * tasks-only in all of those cases.
 */
export async function getDisplayEventsFor(
  supabase: SupabaseClient,
  userId: string,
  startDay: string,
  endDayExclusive: string
): Promise<CalendarEvent[]> {
  if (!DAY_RE.test(startDay) || !DAY_RE.test(endDayExclusive)) return [];

  // select("*") on prefs (not the new column by name) so a deploy that lands
  // before the show_calendar_events migration degrades to defaults instead of
  // erroring the whole read.
  const [syncRes, prefsRes] = await Promise.all([
    supabase
      .from("calendar_sync")
      .select("google_refresh_token")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  // Errors mean "can't tell if connected" — show nothing rather than guess.
  if (syncRes.error || !syncRes.data?.google_refresh_token) return [];
  const prefs = prefsRes.error ? null : prefsRes.data;
  if (prefs?.show_calendar_events === false) return [];

  // The day bounds are wall-clock dates in the USER's timezone — resolve them
  // there, not in the server's zone (UTC on a deployed host). The same zone is
  // passed to Google so returned event times read as the user's wall clock.
  const timeZone: string = prefs?.timezone ?? DEFAULT_TIMEZONE;
  const [sy, sm, sd] = startDay.split("-").map(Number);
  const [ey, em, ed] = endDayExclusive.split("-").map(Number);

  try {
    const timeMin = zonedClockToUtc(sy, sm, sd, 0, 0, timeZone).toISOString();
    const timeMax = zonedClockToUtc(ey, em, ed, 0, 0, timeZone).toISOString();
    return await listDisplayEvents(
      syncRes.data.google_refresh_token,
      timeMin,
      timeMax,
      timeZone
    );
  } catch {
    // Calendar fetch failed (revoked token, network) — tasks-only view.
    return [];
  }
}

/**
 * Cookie-session wrapper for server components (Today, Upcoming, Calendar
 * pages). Also returns [] when nobody is signed in.
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
  return getDisplayEventsFor(supabase, user.id, startDay, endDayExclusive);
}
