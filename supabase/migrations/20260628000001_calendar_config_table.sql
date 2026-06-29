-- Supabase's postgres role can't run `ALTER DATABASE ... SET`, so the original
-- calendar_sync_configure() (which stored the worker URL/secret as a database
-- setting) fails with "permission denied to set parameter". Store the config in
-- a single-row table instead and read it from the cron tick.

create table calendar_config (
  id integer primary key default 1 check (id = 1),
  worker_url text not null,
  worker_secret text not null,
  updated_at timestamptz not null default now()
);

-- RLS on, no policies: only the service role (bypasses RLS) and the SECURITY
-- DEFINER functions below (owned by the table owner) touch it. The cron secret
-- is never exposed to end users.
alter table calendar_config enable row level security;

-- Upsert the single config row. Replaces the ALTER DATABASE implementation.
create or replace function calendar_sync_configure(
  worker_base_url text,
  worker_secret text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into calendar_config (id, worker_url, worker_secret, updated_at)
  values (1, worker_base_url, worker_secret, now())
  on conflict (id) do update
    set worker_url = excluded.worker_url,
        worker_secret = excluded.worker_secret,
        updated_at = now();
end;
$$;

revoke execute on function calendar_sync_configure(text, text)
  from public, anon, authenticated;
grant execute on function calendar_sync_configure(text, text) to service_role;

-- Read config from the table instead of current_setting(). No-ops (returns
-- early) until calendar_sync_configure() has populated the row.
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
