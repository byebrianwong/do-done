-- Make the all-day pull converge: clear when_time (but preserve duration).
--
-- 20260629000003 made the all-day pull update ONLY when_date to avoid wiping the
-- estimate. But that means a stale time written during a push→pull race (e.g.
-- a webhook firing mid-conversion while some events were still 9 AM) never gets
-- cleared. An all-day event has no time, so the pull should set when_time = null
-- — leaving duration untouched. This is self-correcting and also handles a user
-- converting a timed event to all-day in Google.

create or replace function calendar_apply_remote_change(
  p_task_id uuid,
  p_cancelled boolean,
  p_due_date date,
  p_due_time time,
  p_duration integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.sync_origin', 'google', true);

  if p_cancelled then
    update tasks set calendar_event_id = null where id = p_task_id;
  elsif p_due_time is null then
    -- All-day event: set the date, clear the time, preserve duration/estimate.
    update tasks
      set when_date = coalesce(p_due_date, when_date),
          when_time = null
      where id = p_task_id;
  else
    update tasks set
      when_date = coalesce(p_due_date, when_date),
      when_time = p_due_time,
      duration_minutes = p_duration
    where id = p_task_id;
  end if;
end;
$$;
