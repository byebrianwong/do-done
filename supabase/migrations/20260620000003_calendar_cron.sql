-- Drive the calendar sync worker from the database via pg_cron + pg_net.
--
-- Every tick, Postgres POSTs to the web app's /api/calendar/worker endpoint,
-- which drains the outbox (DoDone → Google) and establishes/renews watch
-- channels (so Google → DoDone stays real-time).
--
-- The worker URL + shared secret are NOT hard-coded here (they differ per
-- environment and the secret must not live in git). Run, once per environment:
--
--   select calendar_sync_configure('https://your-app.example.com', '<CALENDAR_CRON_SECRET>');
--
-- The same secret must be set as CALENDAR_CRON_SECRET in the web app's env.

-- pg_net (HTTP from Postgres) and pg_cron (scheduler). On Supabase these can
-- also be toggled in Dashboard → Database → Extensions if the migration role
-- lacks privileges to create them.
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ── Configuration (worker URL + secret) ────────────────────
--
-- Stored as database-level settings so pg_cron's background sessions can read
-- them via current_setting(). ALTER DATABASE applies to new sessions, which is
-- exactly when cron jobs run.

create or replace function calendar_sync_configure(
  worker_base_url text,
  worker_secret text
)
returns void
language plpgsql
security definer
as $$
begin
  execute format(
    'alter database %I set app.calendar_worker_url = %L',
    current_database(), worker_base_url
  );
  execute format(
    'alter database %I set app.calendar_worker_secret = %L',
    current_database(), worker_secret
  );
end;
$$;

revoke execute on function calendar_sync_configure(text, text)
  from public, anon, authenticated;
grant execute on function calendar_sync_configure(text, text) to service_role;

-- ── The tick: POST the worker endpoint ─────────────────────
--
-- No-ops until calendar_sync_configure() has been run, so the migration is
-- safe to apply before the URL/secret are known.

create or replace function calendar_drain_tick()
returns void
language plpgsql
security definer
as $$
declare
  v_url text := current_setting('app.calendar_worker_url', true);
  v_secret text := current_setting('app.calendar_worker_secret', true);
begin
  if v_url is null or v_url = '' then
    return;
  end if;

  perform net.http_post(
    url := v_url || '/api/calendar/worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-calendar-cron-secret', coalesce(v_secret, '')
    ),
    body := '{}'::jsonb
  );
end;
$$;

-- ── Schedule ───────────────────────────────────────────────
--
-- Every 30s. If this environment's pg_cron predates sub-minute schedules,
-- replace '30 seconds' with '* * * * *' (one minute).

do $$
begin
  -- Idempotent: drop any prior definition before (re)creating.
  begin
    perform cron.unschedule('do-done-calendar-drain');
  exception when others then
    null;
  end;

  perform cron.schedule(
    'do-done-calendar-drain',
    '30 seconds',
    $cron$ select public.calendar_drain_tick(); $cron$
  );
end;
$$;
