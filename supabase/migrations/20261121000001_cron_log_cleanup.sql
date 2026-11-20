-- Keep the two pg_cron / pg_net log tables small, and stop the calendar tick
-- from calling the worker when it has nothing to do.
--
-- By November 2026 the database was 199 MB, and 184 MB of it was two log
-- tables. Our own data (`public`) was 2.5 MB.
--
--   cron.job_run_details   72 MB   one row per cron run, never deleted
--   net._http_response    112 MB   one row per HTTP call, deleted after 6 hours
--
-- Both come from `do-done-calendar-drain`, which runs every 30 seconds:
-- 2,880 history rows and 2,880 HTTP responses a day.
--
-- pg_net deletes its responses after 6 hours, but the space those rows used
-- was never reused. Autovacuum frees that space, and it had not run on either
-- table since the server restarted on 28 August 2026: Postgres's dead-row
-- counter for both tables read about zero, so autovacuum saw nothing to do.
-- We did not confirm why the counter stays at zero. This migration does not
-- depend on the reason; it runs VACUUM itself.
--
-- This migration does not shrink the tables that already exist. Plain VACUUM
-- makes freed space reusable inside the table but does not give it back to the
-- disk. That needs a one-time `VACUUM FULL`, run by hand (see the PR).

-- ── 1. Delete old cron history, daily ──────────────────────
--
-- Seven days is enough to look back on a failing job. At one run every 30
-- seconds that caps the table at about 20,000 rows, roughly 3 MB.
--
-- The `postgres` role, which owns these jobs, has DELETE and MAINTAIN on both
-- tables (Postgres 17), so the jobs need no SECURITY DEFINER wrapper.

-- ── 2. VACUUM both tables, daily, after the delete ─────────
--
-- A separate job because VACUUM cannot run inside a transaction block, and a
-- cron command with two statements runs as one transaction. VACUUM scans the
-- table whatever the statistics say, so it works even while autovacuum is not
-- firing. Plain VACUUM, not FULL: FULL rewrites the table under an exclusive
-- lock, and once the space is reusable the tables stay flat without it.

do $$
begin
  -- Idempotent: drop any prior definition before (re)creating.
  begin
    perform cron.unschedule('do-done-cron-history-cleanup');
  exception when others then
    null;
  end;
  begin
    perform cron.unschedule('do-done-log-vacuum');
  exception when others then
    null;
  end;

  perform cron.schedule(
    'do-done-cron-history-cleanup',
    '23 4 * * *',
    $cron$ delete from cron.job_run_details where end_time < now() - interval '7 days'; $cron$
  );

  perform cron.schedule(
    'do-done-log-vacuum',
    '38 4 * * *',
    $cron$ vacuum cron.job_run_details, net._http_response; $cron$
  );
end;
$$;

-- ── 3. Only call the worker when there is work ─────────────
--
-- /api/calendar/worker does two jobs, and the tick must call it whenever
-- either one has work:
--
--   - drain the outbox: rows not yet processed, under the attempt limit, and
--     past their backoff time;
--   - renew Google watch channels: a connected calendar with no channel yet,
--     or one that expires within 24 hours.
--
-- Checking only the outbox would let a watch channel expire during a quiet
-- week, and changes made in Google would stop reaching DoDone.
--
-- These conditions copy the worker's own queries: MAX_ATTEMPTS (6) and
-- RENEW_WINDOW_MS (24 hours) in apps/web/src/app/api/calendar/worker/route.ts.
-- If either changes there, change it here. A tick that skips when the worker
-- had work only delays that work until a later tick finds it, so drift here
-- delays syncing rather than losing it, except for watch renewal, where a
-- window shorter than the worker's could let a channel lapse.
--
-- With nothing pending this skips the HTTP call, so no pg_net response row is
-- written and no Vercel function runs. A cron history row is still written
-- every 30 seconds; job 1 above deletes those.

create or replace function calendar_drain_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  select worker_url, worker_secret into v_url, v_secret
  from calendar_config
  where id = 1;

  if v_url is null or v_url = '' then
    return;
  end if;

  if not exists (
       select 1 from calendar_outbox
       where processed_at is null
         and attempts < 6
         and next_attempt_at <= now()
     )
     and not exists (
       select 1 from calendar_sync
       where watch_expiration is null
          or watch_expiration < now() + interval '24 hours'
     )
  then
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
