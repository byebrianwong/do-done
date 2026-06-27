-- Two-way Google Calendar sync — foundation schema (no behavior change yet).
--
-- DoDone → Google is driven off the database so a task changed from ANY
-- surface (web, mobile, MCP, raw SQL) propagates: a trigger (added in a later
-- migration) enqueues work into `calendar_outbox`, which a server worker drains.
--
-- Google → DoDone is real-time via push (watch) channels; the per-user channel
-- metadata lives on `calendar_sync`.

-- ── Outbox: pending DoDone → Google operations ─────────────
--
-- Rows are written by the tasks trigger and consumed by /api/calendar/worker.
-- `task_id` is intentionally NOT a foreign key: when a task is hard-deleted we
-- still need its row here to delete the corresponding Google event.

create table calendar_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid,
  op text not null check (op in ('upsert', 'delete')),
  -- Snapshot of the Google event id at enqueue time. Required for deletes
  -- (the task row may be gone); null for upserts (resolved at drain time).
  event_id text,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  -- Backoff: the worker only picks up rows whose next_attempt_at has passed.
  next_attempt_at timestamptz not null default now(),
  processed_at timestamptz
);

-- The worker's hot query: oldest unprocessed rows that are due to retry.
create index idx_calendar_outbox_pending
  on calendar_outbox (next_attempt_at)
  where processed_at is null;

-- Lets the trigger collapse redundant pending upserts for the same task.
create index idx_calendar_outbox_task
  on calendar_outbox (task_id)
  where processed_at is null;

-- RLS on, no policies: only the service role (which bypasses RLS) and the
-- SECURITY DEFINER trigger touch this table. End users never see the outbox.
alter table calendar_outbox enable row level security;

-- ── Watch (push notification) channel metadata ─────────────
--
-- Google calls our webhook when the user's calendar changes. Channels expire
-- (~7 days), so the worker renews them before `watch_expiration`.

alter table calendar_sync
  add column watch_channel_id text,
  add column watch_resource_id text,
  add column watch_expiration timestamptz,
  add column watch_token text;
