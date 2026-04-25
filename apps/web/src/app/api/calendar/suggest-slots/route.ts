import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { TasksApi } from "@do-done/api-client";
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

  // Determine target dates: today + next 4 working days
  const start = body.preferred_date
    ? new Date(`${body.preferred_date}T00:00:00`)
    : new Date();
  const days: Date[] = [];
  for (let i = 0; days.length < 5 && i < 14; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d);
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
      const rangeEnd = new Date(days[days.length - 1]);
      rangeEnd.setHours(23, 59, 59, 999);
      const params: calendar_v3.Params$Resource$Events$List = {
        calendarId: "primary",
        timeMin: days[0].toISOString(),
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

  // Also treat existing scheduled tasks as busy
  const { data: scheduledTasks = [] } = await tasks.list({
    limit: 100,
    offset: 0,
  });
  for (const t of scheduledTasks) {
    if (
      t.due_date &&
      t.due_time &&
      t.duration_minutes &&
      t.status !== "done" &&
      t.status !== "archived" &&
      (!body.task_id || t.id !== body.task_id)
    ) {
      const tStart = new Date(`${t.due_date}T${t.due_time}:00`);
      const tEnd = new Date(tStart.getTime() + t.duration_minutes * 60_000);
      calendarEvents.push({ start: tStart, end: tEnd });
    }
  }

  // Build candidate slots within focus hours, skipping busy windows
  const slots: Slot[] = [];
  const durationMs = durationMinutes * 60_000;

  for (const day of days) {
    if (slots.length >= 3) break;

    const dayStart = new Date(day);
    dayStart.setHours(focusStart, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(focusEnd, 0, 0, 0);

    if (dayEnd.getTime() <= Date.now()) continue;

    const busy = calendarEvents
      .filter((e) => e.start < dayEnd && e.end > dayStart)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    let cursor = new Date(Math.max(dayStart.getTime(), Date.now()));
    // Round cursor up to the next 15-minute boundary
    const minutes = cursor.getMinutes();
    const rem = minutes % 15;
    if (rem !== 0) {
      cursor.setMinutes(minutes + (15 - rem), 0, 0);
    } else {
      cursor.setSeconds(0, 0);
    }

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
