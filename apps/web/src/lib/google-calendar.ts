import "server-only";
import { google, type calendar_v3 } from "googleapis";
import type { Task } from "@do-done/shared";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

const SYNC_TAG = "do-done-sync";

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

/**
 * Convert a Task into a Google Calendar event.
 * Tasks tagged with the SYNC_TAG identifier in `extendedProperties.private`
 * so we can recognize our own events when pulling changes.
 */
export function taskToEvent(task: Task): calendar_v3.Schema$Event | null {
  if (!task.due_date || !task.duration_minutes) return null;

  const startIso = task.due_time
    ? `${task.due_date}T${task.due_time}:00`
    : `${task.due_date}T09:00:00`;
  const start = new Date(startIso);
  const end = new Date(start.getTime() + task.duration_minutes * 60 * 1000);

  return {
    summary: task.title,
    description: task.description ?? undefined,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    extendedProperties: {
      private: {
        [SYNC_TAG]: "1",
        do_done_task_id: task.id,
      },
    },
  };
}

export async function pushTaskToCalendar(
  refreshToken: string,
  task: Task
): Promise<string | null> {
  const event = taskToEvent(task);
  if (!event) return null;

  const calendar = calendarClientFor(refreshToken);

  if (task.calendar_event_id) {
    // Update existing event
    const { data } = await calendar.events.update({
      calendarId: "primary",
      eventId: task.calendar_event_id,
      requestBody: event,
    });
    return data.id ?? null;
  }

  // Create new event
  const { data } = await calendar.events.insert({
    calendarId: "primary",
    requestBody: event,
  });
  return data.id ?? null;
}

export async function deleteCalendarEvent(
  refreshToken: string,
  eventId: string
): Promise<void> {
  const calendar = calendarClientFor(refreshToken);
  await calendar.events.delete({
    calendarId: "primary",
    eventId,
  });
}

export interface CalendarChange {
  eventId: string;
  taskId: string | null;
  start: Date | null;
  end: Date | null;
  summary: string | null;
  status: "confirmed" | "cancelled" | "tentative";
}

/**
 * Pull changes from Google Calendar for events tagged as ours.
 * Returns the changes plus the next sync token to persist.
 */
export async function pullCalendarChanges(
  refreshToken: string,
  syncToken?: string | null
): Promise<{ changes: CalendarChange[]; nextSyncToken: string | null }> {
  const calendar = calendarClientFor(refreshToken);

  const params: calendar_v3.Params$Resource$Events$List = {
    calendarId: "primary",
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

  const changes: CalendarChange[] = (data.items ?? []).map((item) => ({
    eventId: item.id ?? "",
    taskId:
      item.extendedProperties?.private?.do_done_task_id ?? null,
    start: item.start?.dateTime ? new Date(item.start.dateTime) : null,
    end: item.end?.dateTime ? new Date(item.end.dateTime) : null,
    summary: item.summary ?? null,
    status: (item.status as CalendarChange["status"]) ?? "confirmed",
  }));

  return {
    changes,
    nextSyncToken: data.nextSyncToken ?? null,
  };
}
