-- Echo suppression via etag.
--
-- Every push fires a watch notification, so we pull back our own writes. Store
-- the version (etag) of the event we push; on pull, only APPLY a change whose
-- etag differs from what we last stored (a genuine human edit in Google). A
-- matching etag is our own echo → skip it. This ends the class of bugs where
-- pushed defaults/duplicates leaked back onto tasks (the 9 AM injection, the
-- scrambled dates).

alter table tasks add column calendar_event_etag text;

-- The signature gains p_etag, so drop the 5-arg version before recreating.
drop function if exists calendar_apply_remote_change(uuid, boolean, date, time, integer);

create or replace function calendar_apply_remote_change(
  p_task_id uuid,
  p_cancelled boolean,
  p_due_date date,
  p_due_time time,
  p_duration integer,
  p_etag text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.sync_origin', 'google', true);

  if p_cancelled then
    update tasks
      set calendar_event_id = null, calendar_event_etag = null
      where id = p_task_id;
  elsif p_due_time is null then
    -- All-day event: set date, clear time, preserve duration. The etag guard
    -- skips our own push echo; only a different etag (external edit) applies.
    update tasks
      set when_date = coalesce(p_due_date, when_date),
          when_time = null,
          calendar_event_etag = p_etag
      where id = p_task_id
        and calendar_event_etag is distinct from p_etag;
  else
    update tasks
      set when_date = coalesce(p_due_date, when_date),
          when_time = p_due_time,
          duration_minutes = p_duration,
          calendar_event_etag = p_etag
      where id = p_task_id
        and calendar_event_etag is distinct from p_etag;
  end if;
end;
$$;

revoke execute on function calendar_apply_remote_change(uuid, boolean, date, time, integer, text)
  from public, anon, authenticated;
grant execute on function calendar_apply_remote_change(uuid, boolean, date, time, integer, text)
  to service_role;
