import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { TasksApi } from "@do-done/api-client";
import { zonedClockToUtc } from "@do-done/shared";
import { calendarClientFor } from "@/lib/google-calendar";
import type { calendar_v3 } from "googleapis";

interface SuggestRequest {
  task_id?: string;
  duration_minutes?: number;
  preferred_date?: string; // YYYY-MM-DD
}

interface Slot {
  start: string; // ISO
  end: string; // ISO
}

const DEFAULT_FOCUS_START = 9; // 9 AM
const DEFAULT_FOCUS_END = 17; // 5 PM
const SLOT_BUFFER_MIN = 15; // padding around busy events
// Matches UserPreferencesSchema's default — used only when a user has no
// preferences row yet.
const DEFAULT_TIMEZONE = "America/New_York";
const FIFTEEN_MIN = 15 * 60_000;

// A target day expressed as a calendar tuple (in the user's timezone), so
// focus-hour boundaries can be turned into absolute instants for that zone.
interface CalDay {
  y: number;
  m: number; // 1-12
  d: number;
}

// Today's calendar date in `timeZone`, as a {y,m,d} tuple. en-CA formats as
// ISO YYYY-MM-DD.
function todayInZone(timeZone: string): CalDay {
  let s: string;
  try {
    s = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    s = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as SuggestRequest;
  const tasks = new TasksApi(supabase, user.id);

  // Resolve duration: explicit param wins, else fetch from task
  let durationMinutes = body.duration_minutes;
  if (body.task_id && !durationMinutes) {
    const { data: task } = await tasks.getById(body.task_id);
    durationMinutes = task?.duration_minutes ?? 30;
  }
  durationMinutes = durationMinutes ?? 30;

  // Load user prefs
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("focus_hours_start, focus_hours_end, timezone")
    .eq("user_id", user.id)
    .maybeSingle();
  const focusStart = prefs?.focus_hours_start ?? DEFAULT_FOCUS_START;
  const focusEnd = prefs?.focus_hours_end ?? DEFAULT_FOCUS_END;
  // Focus hours are wall-clock times in the USER's timezone, not the server's
  // (the server runs in UTC). Reading this pref is what fixes the "3am
  // suggestion" bug — previously focus hours were applied in server-local time.
  const timeZone = prefs?.timezone ?? DEFAULT_TIMEZONE;

  // Determine target days: the first day + next, up to 5, as calendar tuples in
  // the user's timezone. We advance by whole days using a UTC midnight as a pure
  // calendar counter (UTC has no DST, so getUTCDate increments cleanly).
  const firstDay: CalDay = body.preferred_date
    ? (() => {
        const [y, m, d] = body.preferred_date.split("-").map(Number);
        return { y, m, d };
      })()
    : todayInZone(timeZone);
  const baseUTC = Date.UTC(firstDay.y, firstDay.m - 1, firstDay.d);
  const days: CalDay[] = [];
  for (let i = 0; days.length < 5 && i < 14; i++) {
    const dd = new Date(baseUTC + i * 86_400_000);
    days.push({
      y: dd.getUTCFullYear(),
      m: dd.getUTCMonth() + 1,
      d: dd.getUTCDate(),
    });
  }

  // Try to fetch calendar events; fall back to no-events if not connected
  let calendarEvents: { start: Date; end: Date }[] = [];
  const { data: sync } = await supabase
    .from("calendar_sync")
    .select("google_refresh_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (sync?.google_refresh_token) {
    try {
      const cal = calendarClientFor(sync.google_refresh_token);
      const first = days[0];
      const last = days[days.length - 1];
      const rangeStart = zonedClockToUtc(first.y, first.m, first.d, 0, 0, timeZone);
      const rangeEnd = zonedClockToUtc(last.y, last.m, last.d, 23, 59, timeZone);
      const params: calendar_v3.Params$Resource$Events$List = {
        calendarId: "primary",
        timeMin: rangeStart.toISOString(),
        timeMax: rangeEnd.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
      };
      const { data } = await cal.events.list(params);
      calendarEvents = (data.items ?? [])
        .filter((e) => e.start?.dateTime && e.end?.dateTime)
        .map((e) => ({
          start: new Date(e.start!.dateTime!),
          end: new Date(e.end!.dateTime!),
        }));
    } catch {
      // ignore — fall back to in-app scheduled tasks only
    }
  }

  // Also treat existing scheduled tasks as busy. A task reserves space at its
  // "do" time (scheduled_date/scheduled_time) if it has one, else at its hard deadline
  // (deadline_date/deadline_time). Both are wall-clock in the user's timezone.
  const { data: scheduledTasks = [] } = await tasks.list({
    limit: 100,
    offset: 0,
  });
  for (const t of scheduledTasks) {
    if (
      !t.duration_minutes ||
      t.status === "done" ||
      t.status === "cancelled" ||
      (body.task_id && t.id === body.task_id)
    ) {
      continue;
    }
    const date = t.scheduled_date && t.scheduled_time ? t.scheduled_date : t.deadline_date;
    const time = t.scheduled_date && t.scheduled_time ? t.scheduled_time : t.deadline_time;
    if (!date || !time) continue;
    const [yy, mm, dd] = date.split("-").map(Number);
    const [hh, min] = time.split(":").map(Number);
    const tStart = zonedClockToUtc(yy, mm, dd, hh, min, timeZone);
    const tEnd = new Date(tStart.getTime() + t.duration_minutes * 60_000);
    calendarEvents.push({ start: tStart, end: tEnd });
  }

  // Build candidate slots within focus hours, skipping busy windows
  const slots: Slot[] = [];
  const durationMs = durationMinutes * 60_000;

  for (const day of days) {
    if (slots.length >= 3) break;

    // Focus window as absolute instants for this calendar day in the user's tz.
    const dayStart = zonedClockToUtc(day.y, day.m, day.d, focusStart, 0, timeZone);
    const dayEnd = zonedClockToUtc(day.y, day.m, day.d, focusEnd, 0, timeZone);

    if (dayEnd.getTime() <= Date.now()) continue;

    const busy = calendarEvents
      .filter((e) => e.start < dayEnd && e.end > dayStart)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    // Round the start cursor up to the next 15-minute mark on the absolute
    // timeline (offset-invariant for all real zones, so no tz math needed).
    let cursor = new Date(
      Math.ceil(Math.max(dayStart.getTime(), Date.now()) / FIFTEEN_MIN) *
        FIFTEEN_MIN
    );

    for (const b of busy) {
      const gapEnd = new Date(b.start.getTime() - SLOT_BUFFER_MIN * 60_000);
      while (cursor.getTime() + durationMs <= gapEnd.getTime()) {
        slots.push({
          start: cursor.toISOString(),
          end: new Date(cursor.getTime() + durationMs).toISOString(),
        });
        if (slots.length >= 3) break;
        cursor = new Date(cursor.getTime() + durationMs);
      }
      if (slots.length >= 3) break;
      cursor = new Date(b.end.getTime() + SLOT_BUFFER_MIN * 60_000);
    }

    // Tail of the day after all busy events
    while (cursor.getTime() + durationMs <= dayEnd.getTime() && slots.length < 3) {
      slots.push({
        start: cursor.toISOString(),
        end: new Date(cursor.getTime() + durationMs).toISOString(),
      });
      cursor = new Date(cursor.getTime() + durationMs);
    }
  }

  return NextResponse.json({
    duration_minutes: durationMinutes,
    slots,
  });
}
