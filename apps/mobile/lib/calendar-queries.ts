/**
 * Read-only Google Calendar events for display inside the mobile app.
 *
 * Events can't be fetched from Supabase — reading Google needs the refresh
 * token + client secret, which never leave the server — so this calls the web
 * app's /api/calendar/events route with the Supabase access token as a Bearer
 * header.
 *
 * A disconnected calendar, the "show events" preference off, and a Google
 * outage all come back from that route as a successful empty list, so the
 * screens render tasks-only for each — matching web. An HTTP failure throws
 * instead, which is what lets Today and Upcoming say they could not load
 * rather than showing an empty day: the two used to be the same [], so a build
 * that could not reach the web app at all looked exactly like a clear week. A
 * missing session stays an empty list — the screens are behind sign-in, so
 * that gap is a token refresh in flight rather than something to report.
 */

import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import {
  todayLocalISO,
  type CalendarEvent,
  type CalendarOption,
} from '@do-done/shared';
import { supabase } from './supabase';

/**
 * Where the DoDone web app is deployed. Defaults to production rather than
 * requiring configuration.
 *
 * It used to be env-var-only, and an unset var turned calendar events off with
 * nothing said anywhere a user looks: Today and Upcoming rendered tasks-only,
 * which is also what they render for someone whose day is genuinely clear. The
 * var has to reach the bundler, so every EAS build and every OTA bundle
 * inherited that unless it was wired into eas.json or the EAS environment, and
 * the feature was off for anyone who had not done so.
 *
 * The deployment URL is already a constant of this project — app.config.ts
 * pins the same host in `ios.associatedDomains` — so defaulting to it costs
 * nothing and removes that failure. A fork or self-hosted deploy sets the var.
 */
const PRODUCTION_WEB_APP_URL = 'https://dodone.byebrianwong.com';

// `||`, not `??`: an EAS variable that is declared but empty expands to "",
// and falling through to the default is the useful reading of that. Env var
// wins; app.config.ts `extra.webAppUrl` is next so EAS builds can set it per
// profile.
const WEB_APP_URL: string =
  process.env.EXPO_PUBLIC_WEB_APP_URL ||
  (Constants.expoConfig?.extra?.webAppUrl as string | undefined) ||
  PRODUCTION_WEB_APP_URL;

export const calendarKeys = {
  all: ['calendar'] as const,
  events: (start: string, end: string) =>
    [...calendarKeys.all, 'events', start, end] as const,
  list: () => [...calendarKeys.all, 'list'] as const,
};

/** The device's IANA timezone, or null when Intl can't say (older Hermes). */
function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

async function fetchCalendarEvents(
  startDay: string,
  endDayExclusive: string
): Promise<CalendarEvent[]> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return [];

  // Pass the device zone: the screens bucket events by the DEVICE's local
  // day, so the server must resolve "today" in that same zone (the stored
  // web preference can differ — travel, default-never-changed).
  const tz = deviceTimeZone();
  const base = WEB_APP_URL.replace(/\/$/, '');
  const url =
    `${base}/api/calendar/events?start=${startDay}&end=${endDayExclusive}` +
    (tz ? `&tz=${encodeURIComponent(tz)}` : '');
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // Throw on HTTP failure so React Query retries and marks the query errored,
  // instead of caching an empty list as fresh success for staleTime.
  if (!res.ok) throw new Error(`calendar events fetch failed: ${res.status}`);
  const body = (await res.json()) as { events?: CalendarEvent[] };
  return body.events ?? [];
}

/**
 * The device's current local day (YYYY-MM-DD) as state, re-read whenever the
 * app returns to the foreground. Query keys built from a render-time
 * todayLocalISO() freeze overnight — the focus refetch re-runs the OLD key
 * without re-rendering — so screens derive their event window from this hook
 * and the key rolls over with the day.
 */
export function useLocalDay(): string {
  const [day, setDay] = useState(() => todayLocalISO());
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setDay(todayLocalISO());
    });
    return () => sub.remove();
  }, []);
  return day;
}

/** Local YYYY-MM-DD `days` after a YYYY-MM-DD string (pure date math). */
export function addDaysISO(dayISO: string, days: number): string {
  const [y, m, d] = dayISO.split('-').map(Number);
  return todayLocalISO(new Date(y, m - 1, d + days));
}

/**
 * Google Calendar events for [startDay, endDayExclusive), local YYYY-MM-DD.
 * `isError` is what the screens show a notice for — see the module comment for
 * which failures reach it and which resolve to an empty list instead.
 */
export function useCalendarEvents(startDay: string, endDayExclusive: string) {
  return useQuery({
    queryKey: calendarKeys.events(startDay, endDayExclusive),
    // Meetings don't move second-to-second; spare the round trip on tab hops.
    staleTime: 60_000,
    queryFn: () => fetchCalendarEvents(startDay, endDayExclusive),
  });
}

/** What `/api/calendar/list` answers, for the calendar picker. */
export interface CalendarListResponse {
  calendars: CalendarOption[];
  /** Ids switched off for display; null = never configured. */
  hidden: string[] | null;
}

/** Raised when the user hasn't connected Google Calendar (web-only flow). */
export class CalendarNotConnectedError extends Error {
  constructor() {
    super('not_connected');
    this.name = 'CalendarNotConnectedError';
  }
}

/**
 * One fetch of the calendar list. `useCalendarList` is the normal entry
 * point; this is exported so the response contract (the not-connected mapping
 * and the null-vs-empty meaning of `hidden`) can be tested without a renderer.
 */
export async function fetchCalendarList(): Promise<CalendarListResponse> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not signed in');

  const base = WEB_APP_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/api/calendar/list`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // 400 here means exactly one thing (no calendar_sync row) and the screen
  // renders a "connect on web" explanation for it rather than a raw error.
  if (res.status === 400) throw new CalendarNotConnectedError();
  if (!res.ok) throw new Error(`calendar list fetch failed: ${res.status}`);
  const body = (await res.json()) as Partial<CalendarListResponse>;
  return {
    calendars: body.calendars ?? [],
    hidden: Array.isArray(body.hidden) ? body.hidden : null,
  };
}

/**
 * The user's Google calendars plus their stored display selection. Google
 * needs the refresh token and client secret, which never leave the server, so
 * this goes through the web app the same way events do.
 */
export function useCalendarList() {
  return useQuery({
    queryKey: calendarKeys.list(),
    // The list changes when the user adds a calendar in Google — rare, but a
    // stale list is exactly what sends someone to this screen. Keep it short.
    staleTime: 30_000,
    // A missing connection is a state to render, not a failure to retry.
    retry: (count, error) =>
      !(error instanceof CalendarNotConnectedError) && count < 2,
    queryFn: fetchCalendarList,
  });
}
