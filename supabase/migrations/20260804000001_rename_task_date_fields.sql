-- Rename the task date columns to say what they mean.
--
--   when_date / when_time  →  scheduled_date / scheduled_time   ("Scheduled")
--   due_date  / due_time   →  deadline_date  / deadline_time    ("Deadline")
--
-- The old names were the source of a recurring, expensive confusion: "due" is
-- the word an English speaker reaches for when they mean "the day I'm doing
-- this", but in DoDone `due_date` was the *rarely set* hard deadline and
-- `when_date` was the day everything is actually scheduled on. Every consumer
-- that guessed — MCP clients most of all — read a fully planned week as empty.
-- The new names are unambiguous in isolation, so nothing has to be told twice.
--
-- Renames preserve data, constraints, defaults, RLS policies and index
-- definitions. What does NOT follow a rename is a plpgsql function body — it is
-- stored as text and only resolves column names at execution time — so both
-- calendar functions are recreated below against the new names. Missing that
-- would leave calendar sync failing at runtime, not at migration time.

-- ── 1. The columns ─────────────────────────────────────────

alter table public.tasks rename column when_date to scheduled_date;
alter table public.tasks rename column when_time to scheduled_time;
alter table public.tasks rename column due_date to deadline_date;
alter table public.tasks rename column due_time to deadline_time;

-- ── 2. Indexes (definitions follow the rename; the names do not) ────────────

alter index public.tasks_when_date_idx rename to tasks_scheduled_date_idx;
alter index public.idx_tasks_user_due_date rename to idx_tasks_user_deadline_date;

-- ── 3. Comments ────────────────────────────────────────────

comment on column public.tasks.scheduled_date is
  'The calendar day the user plans to do this task (Things-3-style "do date"). This is what DoDone schedules by — nearly every dated task has one.';
comment on column public.tasks.scheduled_time is
  'Time of day for scheduled_date, in "HH:MM" format. Paired with scheduled_date; has no meaning without it.';
comment on column public.tasks.deadline_date is
  'Hard external deadline. Distinct from scheduled_date and rarely set — its absence does not mean a task is undated.';
comment on column public.tasks.deadline_time is
  'Time of day for deadline_date, in "HH:MM" format. Paired with deadline_date.';

-- ── 4. Calendar push trigger ───────────────────────────────
-- Same logic as 20260629000002, retargeted at scheduled_date/scheduled_time.
-- Calendar sync tracks the scheduled do-date, never the deadline.

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
    new.scheduled_date is not null
    and new.status not in ('done', 'cancelled');

  if tg_op = 'INSERT' then
    if v_new_syncable then
      insert into calendar_outbox (user_id, task_id, op)
      values (new.user_id, new.id, 'upsert');
    end if;
    return new;
  end if;

  v_old_syncable :=
    old.scheduled_date is not null
    and old.status not in ('done', 'cancelled');

  v_relevant :=
    new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.scheduled_date is distinct from old.scheduled_date
    or new.scheduled_time is distinct from old.scheduled_time
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

-- ── 5. Calendar pull RPC ───────────────────────────────────
-- Same logic as 20260702000002 (all-day handling + etag echo guard). The
-- p_due_* parameters were misnamed from the start — they have always written
-- the scheduled do-date — so they are renamed too. Postgres cannot rename an
-- input parameter via CREATE OR REPLACE, hence the drop.

drop function if exists calendar_apply_remote_change(uuid, boolean, date, time, integer, text);

create function calendar_apply_remote_change(
  p_task_id uuid,
  p_cancelled boolean,
  p_scheduled_date date,
  p_scheduled_time time,
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
  elsif p_scheduled_time is null then
    -- All-day event: set date, clear time, preserve duration. The etag guard
    -- skips our own push echo; only a different etag (external edit) applies.
    update tasks
      set scheduled_date = coalesce(p_scheduled_date, scheduled_date),
          scheduled_time = null,
          calendar_event_etag = p_etag
      where id = p_task_id
        and calendar_event_etag is distinct from p_etag;
  else
    update tasks
      set scheduled_date = coalesce(p_scheduled_date, scheduled_date),
          scheduled_time = p_scheduled_time,
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
