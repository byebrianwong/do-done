import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { wallClockInZone } from "@do-done/shared";
import { createServiceSupabase } from "@/lib/supabase/service";
import { pullCalendarChanges } from "@/lib/google-calendar";

// googleapis needs the Node runtime; never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TIMEZONE = "America/New_York";

interface SyncRow {
  user_id: string;
  google_refresh_token: string;
  calendar_id: string | null;
  last_sync_token: string | null;
  watch_token: string | null;
}

/**
 * Pull changes, transparently recovering from an expired sync token (Google
 * returns 410 GONE, after which a full re-list is required).
 */
async function pullWithRecovery(
  refresh: string,
  syncToken: string | null,
  calendarId: string
) {
  try {
    return await pullCalendarChanges(refresh, syncToken, calendarId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (syncToken && (msg.includes("410") || /sync token/i.test(msg))) {
      return await pullCalendarChanges(refresh, null, calendarId);
    }
    throw e;
  }
}

async function applyChanges(
  supabase: SupabaseClient,
  sync: SyncRow
): Promise<void> {
  const { changes, nextSyncToken } = await pullWithRecovery(
    sync.google_refresh_token,
    sync.last_sync_token,
    sync.calendar_id ?? "primary"
  );

  let timeZone = DEFAULT_TIMEZONE;
  if (changes.some((c) => c.taskId && c.start)) {
    const { data } = await supabase
      .from("user_preferences")
      .select("timezone")
      .eq("user_id", sync.user_id)
      .maybeSingle();
    timeZone = (data?.timezone as string | undefined) ?? DEFAULT_TIMEZONE;
  }

  for (const change of changes) {
    if (!change.taskId) continue;

    if (change.status === "cancelled") {
      await supabase.rpc("calendar_apply_remote_change", {
        p_task_id: change.taskId,
        p_cancelled: true,
        p_due_date: null,
        p_due_time: null,
        p_duration: null,
        p_etag: change.etag,
      });
    } else if (change.allDay && change.date) {
      // All-day event → set the date, clear time and duration.
      await supabase.rpc("calendar_apply_remote_change", {
        p_task_id: change.taskId,
        p_cancelled: false,
        p_due_date: change.date,
        p_due_time: null,
        p_duration: null,
        p_etag: change.etag,
      });
    } else if (change.start) {
      const { date, time } = wallClockInZone(change.start, timeZone);
      const duration = change.end
        ? Math.round((change.end.getTime() - change.start.getTime()) / 60000)
        : null;
      await supabase.rpc("calendar_apply_remote_change", {
        p_task_id: change.taskId,
        p_cancelled: false,
        p_due_date: date,
        p_due_time: time,
        p_duration: duration,
        p_etag: change.etag,
      });
    }
  }

  await supabase
    .from("calendar_sync")
    .update({ last_sync_token: nextSyncToken, synced_at: new Date().toISOString() })
    .eq("user_id", sync.user_id);
}

export async function POST(request: NextRequest) {
  // Google push notifications carry no body — everything is in headers.
  const channelId = request.headers.get("x-goog-channel-id");
  const token = request.headers.get("x-goog-channel-token");
  const state = request.headers.get("x-goog-resource-state");

  // Initial handshake fired when the channel opens.
  if (state === "sync") return new NextResponse(null, { status: 200 });
  if (!channelId) return new NextResponse(null, { status: 200 });

  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("calendar_sync")
    .select(
      "user_id, google_refresh_token, calendar_id, last_sync_token, watch_token"
    )
    .eq("watch_channel_id", channelId)
    .maybeSingle();
  const sync = (data as SyncRow | null) ?? null;

  // Unknown channel or forged token — ack with 200 so Google stops retrying,
  // but do nothing.
  if (!sync || (sync.watch_token && sync.watch_token !== token)) {
    return new NextResponse(null, { status: 200 });
  }

  try {
    await applyChanges(supabase, sync);
  } catch {
    // Swallow: returning non-2xx makes Google retry with backoff, but a
    // persistent failure (e.g. revoked token) would loop. The cron worker and
    // manual sync remain as fallbacks.
  }

  return new NextResponse(null, { status: 200 });
}
