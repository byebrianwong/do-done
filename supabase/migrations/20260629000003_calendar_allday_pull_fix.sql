-- Echo-safety for all-day events.
--
-- Every push triggers a watch notification, so we pull back our own events. For
-- an all-day event that pull must update ONLY when_date — never when_time or
-- duration — otherwise our own all-day push echoes back and wipes the task's
-- time/estimate. (This is what turned date-only "Today" tasks into "9 AM": the
-- old push used a 9 AM default and the pull wrote that 9 AM onto the task.)
--
-- All-day is detected by p_due_time IS NULL (timed pulls always carry a time).

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
    -- All-day event: only the date is meaningful. Preserve when_time/duration.
    update tasks
      set when_date = coalesce(p_due_date, when_date)
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
