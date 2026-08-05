import "server-only";
import { google, type calendar_v3 } from "googleapis";
import type { CalendarEvent, CalendarOption, Task } from "@do-done/shared";
import { zonedClockToUtc, pickDisplayCalendars } from "@do-done/shared";


const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

const SYNC_TAG = "do-done-sync";

// Used when a timed task has no estimate — default the calendar block to 1 hour.
const DEFAULT_DURATION_MINUTES = 60;

export function getOAuth2Client(redirectUri?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment"
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(redirectUri: string, state?: string): string {
  const oauth2 = getOAuth2Client(redirectUri);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // forces refresh_token to be returned
    state,
  });
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: number;
}> {
  const oauth2 = getOAuth2Client(redirectUri);
  const { tokens } = await oauth2.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh token returned. User may need to revoke access and reconnect."
    );
  }

  return {
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiry_date ?? Date.now() + 3600 * 1000,
  };
}

/**
 * Build an authenticated calendar client given a refresh token.
 * Auto-refreshes the access token under the hood.
 */
export function calendarClientFor(refreshToken: string) {
  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: "v3", auth: oauth2 });
}

/** The day after `YYYY-MM-DD`, as `YYYY-MM-DD` (Google all-day end is exclusive). */
function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/**
 * Convert a Task into a Google Calendar event. Requires only `scheduled_date`:
 *  - no `scheduled_time`            → an all-day event
 *  - `scheduled_time`, no estimate  → a 1-hour timed block
 *  - `scheduled_time` + estimate    → a timed block of that length
 * Tagged via `extendedProperties.private` so we recognize our own events on pull.
 */
export function taskToEvent(
  task: Task,
  timeZone: string
): calendar_v3.Schema$Event | null {
  if (!task.scheduled_date) return null;

  // Deep-link back to the task in DoDone (the /task/[id] route). Surfaced both
  // as the event `source` and appended to the description, since clients vary
  // in which they show.
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  const taskUrl = appUrl ? `${appUrl}/task/${task.id}` : null;
  const description =
    [
      task.description ?? undefined,
      taskUrl ? `Open in DoDone: ${taskUrl}` : undefined,
    ]
      .filter(Boolean)
      .join("\n\n") || undefined;

  const base: calendar_v3.Schema$Event = {
    summary: task.title,
    description,
    ...(taskUrl ? { source: { title: "DoDone", url: taskUrl } } : {}),
    extendedProperties: {
      private: {
        [SYNC_TAG]: "1",
        do_done_task_id: task.id,
      },
    },
  };

  // No time-of-day → all-day event. Google all-day events use `date` (not
  // `dateTime`) with an EXCLUSIVE end, so a single day ends on the next date.
  if (!task.scheduled_time) {
    return {
      ...base,
      start: { date: task.scheduled_date },
      end: { date: nextDay(task.scheduled_date) },
    };
  }

  // Timed block. scheduled_date + scheduled_time are wall-clock values in the USER's
  // timezone (the scheduled "do" time, NOT deadline_date). Resolve to an absolute
  // instant in that zone — `new Date("…T09:00:00")` would interpret them in the
  // server's zone (UTC on a deployed host).
  const [y, m, d] = task.scheduled_date.split("-").map(Number);
  const [hh, mm] = task.scheduled_time.split(":").map(Number);
  const start = zonedClockToUtc(y, m, d, hh, mm, timeZone);
  const minutes = task.duration_minutes ?? DEFAULT_DURATION_MINUTES;
  const end = new Date(start.getTime() + minutes * 60 * 1000);

  return {
    ...base,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}

export async function pushTaskToCalendar(
  refreshToken: string,
  task: Task,
  timeZone: string,
  calendarId: string = "primary"
): Promise<{ id: string | null; etag: string | null }> {
  const event = taskToEvent(task, timeZone);
  if (!event) return { id: null, etag: null };

  const calendar = calendarClientFor(refreshToken);

  if (task.calendar_event_id) {
    // Update existing event (full replace handles timed ↔ all-day transitions).
    const { data } = await calendar.events.update({
      calendarId,
      eventId: task.calendar_event_id,
      requestBody: event,
    });
    return { id: data.id ?? null, etag: data.etag ?? null };
  }

  // Create new event
  const { data } = await calendar.events.insert({
    calendarId,
    requestBody: event,
  });
  return { id: data.id ?? null, etag: data.etag ?? null };
}

export async function deleteCalendarEvent(
  refreshToken: string,
  eventId: string,
  calendarId: string = "primary"
): Promise<void> {
  const calendar = calendarClientFor(refreshToken);
  try {
    await calendar.events.delete({ calendarId, eventId });
  } catch (e: unknown) {
    // Already gone (deleted in Google, or a stale id) — treat as success.
    const code = (e as { code?: number })?.code;
    if (code !== 404 && code !== 410) throw e;
  }
}

export type { CalendarOption };

/**
 * List every calendar in the user's list — including read-only subscriptions.
 *
 * Both Settings controls are fed from this one call: the "Sync to calendar"
 * dropdown filters to `canWrite`, while the display picker shows all of them
 * (you very much want to *see* the holidays calendar you can't write to).
 * Returned in Google's own list order, which is the order the picker renders
 * and the order the display cap applies in.
 */
export async function listCalendars(
  refreshToken: string
): Promise<CalendarOption[]> {
  const calendar = calendarClientFor(refreshToken);
  const { data } = await calendar.calendarList.list({ maxResults: 250 });
  return (data.items ?? [])
    .filter((c) => c.id)
    .map((c) => ({
      id: c.id!,
      summary: c.summaryOverride ?? c.summary ?? c.id!,
      primary: !!c.primary,
      selected: !!c.selected,
      canWrite: c.accessRole === "writer" || c.accessRole === "owner",
      color: c.backgroundColor ?? null,
    }));
}

/**
 * Open a push-notification (watch) channel on the chosen calendar. Google POSTs
 * to `address` on any change. Channels expire, so the returned `expiration`
 * must be stored and the channel renewed before then.
 */
export async function watchCalendar(
  refreshToken: string,
  opts: {
    channelId: string;
    address: string;
    token: string;
    calendarId?: string;
  }
): Promise<{ resourceId: string | null; expiration: Date | null }> {
  const calendar = calendarClientFor(refreshToken);
  const { data } = await calendar.events.watch({
    calendarId: opts.calendarId ?? "primary",
    requestBody: {
      id: opts.channelId,
      type: "web_hook",
      address: opts.address,
      token: opts.token,
    },
  });
  return {
    resourceId: data.resourceId ?? null,
    expiration: data.expiration ? new Date(Number(data.expiration)) : null,
  };
}

/**
 * Stop a previously opened watch channel. Tolerates an already-gone channel.
 */
export async function stopChannel(
  refreshToken: string,
  channelId: string,
  resourceId: string
): Promise<void> {
  const calendar = calendarClientFor(refreshToken);
  try {
    await calendar.channels.stop({
      requestBody: { id: channelId, resourceId },
    });
  } catch {
    // Channel may already be expired/stopped — nothing to clean up.
  }
}

// Per-page API max is 250; follow nextPageToken a few pages per calendar so a
// dense month isn't silently truncated, but don't chase pathological tails.
const MAX_EVENT_PAGES = 4;

// Partial-response mask: only the fields the CalendarEvent mapping below
// reads. Keeps dense calendars from shipping attendee lists/attachments/etc.
const EVENT_FIELDS =
  "nextPageToken,items(id,status,summary,location,htmlLink,eventType,start,end,attendees(self,responseStatus),extendedProperties/private)";

/**
 * List the user's Google Calendar events for read-only display inside DoDone.
 * Reads every calendar the user has chosen in Settings (`hiddenIds` is the
 * exclusion set; `null` falls back to the ones Google has ticked visible), not
 * just the sync target, so the in-app day mirrors what they'd see in Google.
 * All dateTimes are returned in `timeZone` (the user's preferred zone), so the
 * RFC3339 date/clock portions are directly usable as the user's wall time.
 * Excludes:
 *  - events DoDone itself created for tasks (tagged with SYNC_TAG) — the task
 *    is already on screen, showing its mirror event would duplicate it
 *  - events the user declined
 *  - working-location pseudo-events
 */
export async function listDisplayEvents(
  refreshToken: string,
  timeMin: string,
  timeMax: string,
  timeZone: string,
  hiddenIds: string[] | null = null
): Promise<CalendarEvent[]> {
  const calendar = calendarClientFor(refreshToken);

  const { data: calList } = await calendar.calendarList.list({
    maxResults: 250,
  });
  const { visible } = pickDisplayCalendars(calList.items ?? [], hiddenIds);

  const perCalendar = await Promise.allSettled(
    visible.map(async (cal) => {
      const items: calendar_v3.Schema$Event[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_EVENT_PAGES; page++) {
        const { data } = await calendar.events.list({
          calendarId: cal.id!,
          timeMin,
          timeMax,
          timeZone,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 250,
          fields: EVENT_FIELDS,
          pageToken,
        });
        items.push(...(data.items ?? []));
        if (!data.nextPageToken) break;
        pageToken = data.nextPageToken;
      }
      return { cal, items };
    })
  );

  const events: CalendarEvent[] = [];
  const seen = new Set<string>();
  for (const result of perCalendar) {
    // One unreadable calendar shouldn't blank out the rest.
    if (result.status !== "fulfilled") continue;
    const { cal, items } = result.value;
    for (const e of items) {
      if (!e.id || e.status === "cancelled") continue;
      if (e.extendedProperties?.private?.[SYNC_TAG]) continue;
      if (e.eventType === "workingLocation") continue;
      const self = e.attendees?.find((a) => a.self);
      if (self?.responseStatus === "declined") continue;
      // The same event can live on several calendars (an invite plus a shared
      // team calendar) — show it once, under the first calendar that has it.
      if (seen.has(e.id)) continue;
      seen.add(e.id);

      const allDay = !!e.start?.date && !e.start?.dateTime;
      events.push({
        id: e.id,
        calendar_id: cal.id ?? "primary",
        calendar_name: cal.summaryOverride ?? cal.summary ?? null,
        color: cal.backgroundColor ?? null,
        title: e.summary ?? "(untitled)",
        all_day: allDay,
        start_date: e.start?.date ?? null,
        end_date: e.end?.date ?? null,
        start: e.start?.dateTime ?? null,
        end: e.end?.dateTime ?? null,
        location: e.location ?? null,
        html_link: e.htmlLink ?? null,
      });
    }
  }

  return events.sort((a, b) => {
    const aKey = a.all_day ? `${a.start_date}` : `${a.start}`;
    const bKey = b.all_day ? `${b.start_date}` : `${b.start}`;
    return aKey.localeCompare(bKey);
  });
}

export interface CalendarChange {
  eventId: string;
  etag: string | null; // event version — used to skip our own push echoes
  taskId: string | null;
  allDay: boolean;
  date: string | null; // YYYY-MM-DD, set when allDay
  start: Date | null; // set when timed
  end: Date | null; // set when timed
  summary: string | null;
  status: "confirmed" | "cancelled" | "tentative";
}

/**
 * Pull changes from the chosen calendar for events tagged as ours.
 * Returns the changes plus the next sync token to persist.
 */
export async function pullCalendarChanges(
  refreshToken: string,
  syncToken?: string | null,
  calendarId: string = "primary"
): Promise<{ changes: CalendarChange[]; nextSyncToken: string | null }> {
  const calendar = calendarClientFor(refreshToken);

  const params: calendar_v3.Params$Resource$Events$List = {
    calendarId,
    privateExtendedProperty: [`${SYNC_TAG}=1`],
    singleEvents: true,
    showDeleted: true,
  };

  if (syncToken) {
    params.syncToken = syncToken;
  } else {
    params.timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  const { data } = await calendar.events.list(params);

  const changes: CalendarChange[] = (data.items ?? []).map((item) => {
    const allDay = !!item.start?.date && !item.start?.dateTime;
    return {
      eventId: item.id ?? "",
      etag: item.etag ?? null,
      taskId: item.extendedProperties?.private?.do_done_task_id ?? null,
      allDay,
      date: item.start?.date ?? null,
      start: item.start?.dateTime ? new Date(item.start.dateTime) : null,
      end: item.end?.dateTime ? new Date(item.end.dateTime) : null,
      summary: item.summary ?? null,
      status: (item.status as CalendarChange["status"]) ?? "confirmed",
    };
  });

  return {
    changes,
    nextSyncToken: data.nextSyncToken ?? null,
  };
}
