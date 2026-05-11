import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  BusynessApi,
  buildDaysInRange,
  groupTasksByDate,
  type BusyItem,
  type DayBusyness,
} from "@do-done/api-client";
import { calendarClientFor } from "@/lib/google-calendar";
import type { calendar_v3 } from "googleapis";

/**
 * GET /api/calendar/busyness?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Returns DayBusyness[] merging:
 *   - in-app tasks scheduled (when_date) in [start, end]
 *   - Google Calendar events from the user's primary calendar in [start, end]
 *
 * Calendar events use type='event' (hollow dots in UI). Tasks use type='task'
 * (filled, color = priority). If the user hasn't connected Google Calendar,
 * the response contains tasks only.
 */
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!start || !end) {
    return NextResponse.json(
      { error: "missing start or end query param (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  // 1. Tasks via shared BusynessApi.
  const busynessApi = new BusynessApi(supabase, user.id);
  const { data: taskDays, error: tasksErr } = await busynessApi.getTasksRange(
    start,
    end
  );
  if (tasksErr) {
    return NextResponse.json({ error: tasksErr.message }, { status: 500 });
  }

  // 2. Calendar events from Google (best-effort — no failure if not connected).
  const eventsByDate = new Map<string, BusyItem[]>();
  const { data: sync } = await supabase
    .from("calendar_sync")
    .select("google_refresh_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (sync?.google_refresh_token) {
    try {
      const cal = calendarClientFor(sync.google_refresh_token);
      const rangeEnd = new Date(`${end}T23:59:59`);
      const rangeStart = new Date(`${start}T00:00:00`);
      const params: calendar_v3.Params$Resource$Events$List = {
        calendarId: "primary",
        timeMin: rangeStart.toISOString(),
        timeMax: rangeEnd.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
      };
      const { data } = await cal.events.list(params);
      for (const e of data.items ?? []) {
        const startTime = e.start?.dateTime;
        const endTime = e.end?.dateTime;
        if (!startTime || !endTime || !e.id) continue;
        const s = new Date(startTime);
        const eend = new Date(endTime);
        const durMin = Math.max(
          15,
          Math.round((eend.getTime() - s.getTime()) / 60_000)
        );
        const dateStr = s.toISOString().split("T")[0];
        const item: BusyItem = {
          type: "event",
          id: e.id,
          title: e.summary ?? "(untitled)",
          duration_minutes: durMin,
          start_time: startTime,
        };
        const existing = eventsByDate.get(dateStr);
        if (existing) existing.push(item);
        else eventsByDate.set(dateStr, [item]);
      }
    } catch {
      // Calendar fetch failed — fall through with tasks-only.
    }
  }

  // 3. Merge: task days + event days. Re-materialize via buildDaysInRange
  // so the returned array is dense (every day in range, even if empty).
  const merged = new Map<string, BusyItem[]>();
  for (const day of taskDays) merged.set(day.date, [...day.items]);
  for (const [date, items] of eventsByDate) {
    const existing = merged.get(date);
    if (existing) existing.push(...items);
    else merged.set(date, items);
  }
  // Sort events by start_time within each day, tasks come first.
  for (const items of merged.values()) {
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === "task" ? -1 : 1;
      if (a.start_time && b.start_time) {
        return a.start_time.localeCompare(b.start_time);
      }
      return 0;
    });
  }
  const days: DayBusyness[] = buildDaysInRange(start, end, merged);

  return NextResponse.json({ days });
}
