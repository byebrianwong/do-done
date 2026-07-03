/**
 * Read-only Google Calendar events for display inside the mobile app.
 *
 * Events can't be fetched from Supabase — reading Google needs the refresh
 * token + client secret, which never leave the server — so this calls the web
 * app's /api/calendar/events route with the Supabase access token as a Bearer
 * header. Best-effort everywhere: no configured URL, no session, HTTP errors,
 * or a disconnected calendar all resolve to [] and the screens simply render
 * tasks-only, matching the web behavior.
 */

import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import type { CalendarEvent } from '@do-done/shared';
import { supabase } from './supabase';

// Where the DoDone web app is deployed. Env var wins; app.config.ts
// `extra.webAppUrl` is the fallback so EAS builds can set it per profile.
const WEB_APP_URL: string | undefined =
  process.env.EXPO_PUBLIC_WEB_APP_URL ??
  (Constants.expoConfig?.extra?.webAppUrl as string | undefined);

export const calendarKeys = {
  all: ['calendar'] as const,
  events: (start: string, end: string) =>
    [...calendarKeys.all, 'events', start, end] as const,
};

async function fetchCalendarEvents(
  startDay: string,
  endDayExclusive: string
): Promise<CalendarEvent[]> {
  if (!WEB_APP_URL) return [];
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return [];

  const base = WEB_APP_URL.replace(/\/$/, '');
  const res = await fetch(
    `${base}/api/calendar/events?start=${startDay}&end=${endDayExclusive}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return [];
  const body = (await res.json()) as { events?: CalendarEvent[] };
  return body.events ?? [];
}

/**
 * Google Calendar events for [startDay, endDayExclusive), local YYYY-MM-DD.
 * Disabled entirely when no web app URL is configured (e.g. a fresh local
 * setup) so the feature is invisible rather than erroring.
 */
export function useCalendarEvents(startDay: string, endDayExclusive: string) {
  return useQuery({
    queryKey: calendarKeys.events(startDay, endDayExclusive),
    enabled: !!WEB_APP_URL,
    // Meetings don't move second-to-second; spare the round trip on tab hops.
    staleTime: 60_000,
    queryFn: () => fetchCalendarEvents(startDay, endDayExclusive),
  });
}
