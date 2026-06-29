-- Calendar sync must track the scheduled "do-date" (when_date/when_time), not
-- due_date/due_time, which is a separate hard-deadline concept. The app
-- schedules tasks via when_date, so the original due_date-based trigger never
-- enqueued anything and the RPC wrote the wrong column.

-- Re-point the enqueue trigger at when_date/when_time.
create or replace function tasks_calendar_enqueue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_relevant boolean;
  v_old_syncable boolean;
  v_new_syncable boolean;
begin
  if coalesce(current_setting('app.sync_origin', true), '') = 'google' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.calendar_event_id is not null then
      insert into calendar_outbox (user_id, task_id, op, event_id)
      values (old.user_id, old.id, 'delete', old.calendar_event_id);
    end if;
    return old;
  end if;

  v_new_syncable :=
    new.when_date is not null
    and new.duration_minutes is not null
    and new.status not in ('done', 'cancelled');

  if tg_op = 'INSERT' then
    if v_new_syncable then
      insert into calendar_outbox (user_id, task_id, op)
      values (new.user_id, new.id, 'upsert');
    end if;
    return new;
  end if;

  v_old_syncable :=
    old.when_date is not null
    and old.duration_minutes is not null
    and old.status not in ('done', 'cancelled');

  v_relevant :=
    new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.when_date is distinct from old.when_date
    or new.when_time is distinct from old.when_time
    or new.duration_minutes is distinct from old.duration_minutes
    or new.status is distinct from old.status;

  if v_new_syncable and (v_relevant or not v_old_syncable) then
    delete from calendar_outbox
    where task_id = new.id and op = 'upsert' and processed_at is null;

    insert into calendar_outbox (user_id, task_id, op)
    values (new.user_id, new.id, 'upsert');
  elsif (not v_new_syncable) and v_old_syncable and old.calendar_event_id is not null then
    insert into calendar_outbox (user_id, task_id, op, event_id)
    values (new.user_id, new.id, 'delete', old.calendar_event_id);
  end if;

  return new;
end;
$$;

-- Pull writes the scheduled when_date/when_time. Parameter names are kept
-- (p_due_*) so the signature is unchanged and create-or-replace works without a
-- drop; they map to when_date/when_time.
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
  else
    update tasks set
      when_date = coalesce(p_due_date, when_date),
      when_time = p_due_time,
      duration_minutes = coalesce(p_duration, duration_minutes)
    where id = p_task_id;
  end if;
end;
$$;

-- Re-backfill now that we read the correct column (the original backfill used
-- due_date and found nothing). Skips tasks that already have a pending upsert.
insert into calendar_outbox (user_id, task_id, op)
select t.user_id, t.id, 'upsert'
from tasks t
join calendar_sync cs on cs.user_id = t.user_id
where t.when_date is not null
  and t.duration_minutes is not null
  and t.status not in ('done', 'cancelled')
  and not exists (
    select 1 from calendar_outbox o
    where o.task_id = t.id and o.op = 'upsert' and o.processed_at is null
  );
