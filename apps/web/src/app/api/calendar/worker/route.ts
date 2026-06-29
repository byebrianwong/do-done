import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Task } from "@do-done/shared";
import { createServiceSupabase } from "@/lib/supabase/service";
import {
  pushTaskToCalendar,
  deleteCalendarEvent,
  watchCalendar,
  stopChannel,
} from "@/lib/google-calendar";

// googleapis needs the Node runtime; never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TIMEZONE = "America/New_York";
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 6;
// Renew watch channels this far ahead of expiry.
const RENEW_WINDOW_MS = 24 * 60 * 60 * 1000;

interface OutboxRow {
  id: string;
  user_id: string;
  task_id: string | null;
  op: "upsert" | "delete";
  event_id: string | null;
  attempts: number;
}

interface SyncRow {
  user_id: string;
  google_refresh_token: string;
  calendar_id: string | null;
  watch_channel_id: string | null;
  watch_resource_id: string | null;
  watch_expiration: string | null;
  watch_token: string | null;
}

const SYNC_COLS =
  "user_id, google_refresh_token, calendar_id, watch_channel_id, watch_resource_id, watch_expiration, watch_token";

function backoffMs(attempts: number): number {
  return Math.min(60 * 60 * 1000, 30_000 * 2 ** attempts);
}

/** Per-user context loaded lazily and cached for the duration of one tick. */
class UserContext {
  private syncCache = new Map<string, SyncRow | null>();
  private tzCache = new Map<string, string>();

  constructor(private supabase: SupabaseClient) {}

  async sync(userId: string): Promise<SyncRow | null> {
    if (this.syncCache.has(userId)) return this.syncCache.get(userId)!;
    const { data } = await this.supabase
      .from("calendar_sync")
      .select(SYNC_COLS)
      .eq("user_id", userId)
      .maybeSingle();
    const row = (data as SyncRow | null) ?? null;
    this.syncCache.set(userId, row);
    return row;
  }

  async timezone(userId: string): Promise<string> {
    if (this.tzCache.has(userId)) return this.tzCache.get(userId)!;
    const { data } = await this.supabase
      .from("user_preferences")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle();
    const tz = (data?.timezone as string | undefined) ?? DEFAULT_TIMEZONE;
    this.tzCache.set(userId, tz);
    return tz;
  }
}

async function markProcessed(supabase: SupabaseClient, id: string) {
  await supabase
    .from("calendar_outbox")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", id);
}

async function markFailed(
  supabase: SupabaseClient,
  row: OutboxRow,
  message: string
) {
  await supabase
    .from("calendar_outbox")
    .update({
      attempts: row.attempts + 1,
      last_error: message.slice(0, 1000),
      next_attempt_at: new Date(Date.now() + backoffMs(row.attempts)).toISOString(),
    })
    .eq("id", row.id);
}

function isSyncable(task: Task): boolean {
  // Only a date is required: no time → all-day event; time without an estimate
  // → a default 1h block (handled in taskToEvent).
  return (
    !!task.when_date &&
    task.status !== "done" &&
    task.status !== "cancelled"
  );
}

async function processRow(
  supabase: SupabaseClient,
  ctx: UserContext,
  row: OutboxRow
): Promise<void> {
  const sync = await ctx.sync(row.user_id);
  // User disconnected (or never connected): nothing to push — drop the row.
  if (!sync) {
    await markProcessed(supabase, row.id);
    return;
  }
  const refresh = sync.google_refresh_token;
  const calendarId = sync.calendar_id ?? "primary";

  if (row.op === "delete") {
    const eventId = row.event_id;
    if (eventId) await deleteCalendarEvent(refresh, eventId, calendarId);
    await markProcessed(supabase, row.id);
    return;
  }

  // op === "upsert"
  if (!row.task_id) {
    await markProcessed(supabase, row.id);
    return;
  }
  const { data: taskRow } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", row.task_id)
    .maybeSingle();
  const task = (taskRow as Task | null) ?? null;

  // Task gone or no longer belongs on the calendar — let a queued delete (if
  // any) handle event removal; this upsert has nothing to do.
  if (!task || !isSyncable(task)) {
    await markProcessed(supabase, row.id);
    return;
  }

  const timeZone = await ctx.timezone(row.user_id);
  const eventId = await pushTaskToCalendar(refresh, task, timeZone, calendarId);
  if (eventId && eventId !== task.calendar_event_id) {
    // Writes only calendar_event_id, so the enqueue trigger ignores it.
    await supabase
      .from("tasks")
      .update({ calendar_event_id: eventId })
      .eq("id", task.id);
  }
  await markProcessed(supabase, row.id);
}

async function drainOutbox(
  supabase: SupabaseClient,
  ctx: UserContext
): Promise<{ processed: number; failed: number }> {
  const { data, error } = await supabase
    .from("calendar_outbox")
    .select("id, user_id, task_id, op, event_id, attempts")
    .is("processed_at", null)
    .lt("attempts", MAX_ATTEMPTS)
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error || !data) return { processed: 0, failed: 0 };

  let processed = 0;
  let failed = 0;
  for (const row of data as OutboxRow[]) {
    try {
      await processRow(supabase, ctx, row);
      processed++;
    } catch (e) {
      failed++;
      await markFailed(supabase, row, e instanceof Error ? e.message : "unknown");
    }
  }
  return { processed, failed };
}

/**
 * Establish or renew watch channels. Self-healing: covers freshly connected
 * users (no channel yet, watch_expiration null) and channels within
 * RENEW_WINDOW_MS of expiring.
 */
async function renewWatches(
  supabase: SupabaseClient,
  webhookUrl: string
): Promise<number> {
  const cutoff = new Date(Date.now() + RENEW_WINDOW_MS).toISOString();
  const { data } = await supabase
    .from("calendar_sync")
    .select(SYNC_COLS)
    .or(`watch_expiration.is.null,watch_expiration.lt.${cutoff}`);

  if (!data) return 0;

  let renewed = 0;
  for (const sync of data as SyncRow[]) {
    try {
      const channelId = crypto.randomUUID();
      const token = crypto.randomUUID();
      const { resourceId, expiration } = await watchCalendar(
        sync.google_refresh_token,
        {
          channelId,
          address: webhookUrl,
          token,
          calendarId: sync.calendar_id ?? "primary",
        }
      );
      await supabase
        .from("calendar_sync")
        .update({
          watch_channel_id: channelId,
          watch_resource_id: resourceId,
          watch_expiration: expiration?.toISOString() ?? null,
          watch_token: token,
        })
        .eq("user_id", sync.user_id);

      // Best-effort stop of the old channel.
      if (sync.watch_channel_id && sync.watch_resource_id) {
        await stopChannel(
          sync.google_refresh_token,
          sync.watch_channel_id,
          sync.watch_resource_id
        );
      }
      renewed++;
    } catch {
      // Leave the row; next tick retries. A lapsed channel just means the
      // pull side falls back to the manual "Sync now" path until renewed.
    }
  }
  return renewed;
}

export async function POST(request: NextRequest) {
  const secret = process.env.CALENDAR_CRON_SECRET;
  if (!secret || request.headers.get("x-calendar-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceSupabase();
  const ctx = new UserContext(supabase);

  const drain = await drainOutbox(supabase, ctx);

  const base = process.env.APP_URL ?? new URL(request.url).origin;
  const renewed = await renewWatches(supabase, `${base}/api/calendar/webhook`);

  return NextResponse.json({ ...drain, renewed });
}
