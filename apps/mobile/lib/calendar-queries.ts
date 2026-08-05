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

// Where the DoDone web app is deployed. Env var wins; app.config.ts
// `extra.webAppUrl` is the fallback so EAS builds can set it per profile.
const WEB_APP_URL: string | undefined =
  process.env.EXPO_PUBLIC_WEB_APP_URL ??
  (Constants.expoConfig?.extra?.webAppUrl as string | undefined);

export const calendarKeys = {
  all: ['calendar'] as const,
  events: (start: string, end: string) =>
    [...calendarKeys.all, 'events', start, end] as const,
  list: () => [...calendarKeys.all, 'list'] as const,
};

/** True when this build knows where the web app lives — see WEB_APP_URL. */
export const hasWebAppUrl = !!WEB_APP_URL;

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
  if (!WEB_APP_URL) return [];
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
  if (!WEB_APP_URL) throw new Error('no web app URL configured');
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
    enabled: !!WEB_APP_URL,
    // The list changes when the user adds a calendar in Google — rare, but a
    // stale list is exactly what sends someone to this screen. Keep it short.
    staleTime: 30_000,
    // A missing connection is a state to render, not a failure to retry.
    retry: (count, error) =>
      !(error instanceof CalendarNotConnectedError) && count < 2,
    queryFn: fetchCalendarList,
  });
}
