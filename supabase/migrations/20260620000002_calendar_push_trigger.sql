-- DoDone → Google: enqueue calendar work whenever a task changes.
--
-- A task is "syncable" when it has both a date and a duration and is not in a
-- terminal status. The trigger maps task lifecycle transitions to outbox ops:
--   not-syncable → syncable        : upsert (create event)
--   syncable, relevant field moved : upsert (update event)
--   syncable → not-syncable/deleted: delete (remove event)
--
-- Echo-loop guard: when the Google → DoDone path writes a task it sets the
-- transaction-local GUC app.sync_origin = 'google'; this trigger then skips
-- enqueuing so a pulled change never bounces back out to Google.

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
  -- Skip writes that originated from a Google pull.
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
    new.due_date is not null
    and new.duration_minutes is not null
    and new.status not in ('done', 'cancelled');

  if tg_op = 'INSERT' then
    if v_new_syncable then
      insert into calendar_outbox (user_id, task_id, op)
      values (new.user_id, new.id, 'upsert');
    end if;
    return new;
  end if;

  -- UPDATE
  v_old_syncable :=
    old.due_date is not null
    and old.duration_minutes is not null
    and old.status not in ('done', 'cancelled');

  -- Only fields that affect the Google event matter. Notably this excludes
  -- calendar_event_id, so the worker writing the event id back never re-enqueues.
  v_relevant :=
    new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.due_date is distinct from old.due_date
    or new.due_time is distinct from old.due_time
    or new.duration_minutes is distinct from old.duration_minutes
    or new.status is distinct from old.status;

  if v_new_syncable and (v_relevant or not v_old_syncable) then
    -- Collapse any still-pending upsert for this task into the newest one.
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

create trigger tasks_calendar_enqueue
  after insert or update or delete on tasks
  for each row execute function tasks_calendar_enqueue();

-- ── Google → DoDone: apply a pulled change without echoing back ─────────────
--
-- The webhook calls this via RPC. set_config(..., is_local => true) scopes the
-- GUC to this transaction so the enqueue trigger above skips the write.
-- SECURITY DEFINER + grants restrict it to the service role.

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
    -- Event removed in Google: orphan the task (keep it, drop the link).
    update tasks set calendar_event_id = null where id = p_task_id;
  else
    update tasks set
      due_date = coalesce(p_due_date, due_date),
      due_time = p_due_time,
      duration_minutes = coalesce(p_duration, duration_minutes)
    where id = p_task_id;
  end if;
end;
$$;

revoke execute on function calendar_apply_remote_change(uuid, boolean, date, time, integer)
  from public, anon, authenticated;
grant execute on function calendar_apply_remote_change(uuid, boolean, date, time, integer)
  to service_role;

-- ── Backfill: enqueue existing syncable tasks for connected users ───────────

insert into calendar_outbox (user_id, task_id, op)
select t.user_id, t.id, 'upsert'
from tasks t
join calendar_sync cs on cs.user_id = t.user_id
where t.due_date is not null
  and t.duration_minutes is not null
  and t.status not in ('done', 'cancelled');
