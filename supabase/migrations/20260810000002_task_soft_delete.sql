-- Deleting a task stops destroying it.
--
-- Undo used to *recreate*: `TasksApi.create(toCreateInput(task))`, which gave
-- back a new row with a new id and none of the task's subtasks, attachments,
-- location reminders or pet history — those went with the cascade the moment
-- the row was hard-deleted, and nothing the client held could bring them back.
-- The Undo button was therefore quietly lying about what it did, and every
-- /task/<id> link handed out before the delete stayed broken through it.
--
-- So the row survives the delete and only its *visibility* changes.
-- `deleted_at` is the whole mechanism: null means alive, a timestamp means
-- gone. Restoring is one UPDATE setting it back to null, which is why a
-- restored task is not merely equivalent to the one that was deleted — it is
-- the same row, with the same id, and everything that ever pointed at it still
-- does.
--
-- Nothing is kept for long. `TasksApi.purgeDeleted()` hard-deletes anything
-- past TASK_TRASH_RETENTION_MS (@do-done/shared) and clears the attachment
-- bytes as it goes, so "delete" still means delete — it just means it a little
-- later than the click. There is no trash UI and this is not one: the window
-- exists to make Undo honest, not to hoard rows.

-- ── 1. The column ──────────────────────────────────────────

alter table tasks add column if not exists deleted_at timestamptz;

comment on column tasks.deleted_at is
  'When the task was deleted. Null means live. Rows with a value are hidden '
  'from every read and are hard-deleted by the purge sweep once they age past '
  'the retention window.';

-- The only query that ever *wants* deleted rows is the purge sweep, and it
-- wants them by age. Partial, because the alive rows are the overwhelming
-- majority and have no business in this index.
create index if not exists idx_tasks_deleted_at
  on tasks (deleted_at)
  where deleted_at is not null;

-- ── 2. Hide them at the row level ──────────────────────────
--
-- `TasksApi` filters every read itself (see the `read()` helper there), and
-- that is the load-bearing half: the MCP server holds a **service-role**
-- client, which bypasses RLS entirely, so a policy alone would leave every
-- deleted task visible to the one consumer that talks to an agent.
--
-- This is the backstop for everything else — PostgREST from anywhere, a query
-- someone adds later, a client that forgets. Belt and braces on a rule whose
-- failure mode is showing the user a task they deleted.
--
-- Deliberately **only** the select policy. `tasks_update` keeps its plain
-- `user_id = auth.uid()`, and that is what makes restore possible at all: the
-- UPDATE that clears `deleted_at` has to be able to reach a row that SELECT
-- cannot see. (Postgres checks a policy's USING clause per command, so hiding
-- a row from reads does not put it out of an UPDATE's reach.)
drop policy if exists "tasks_select" on tasks;
create policy "tasks_select" on tasks
  for select to authenticated
  using (user_id = auth.uid() and deleted_at is null);

-- ── 3. Calendar sync has to hear about it ──────────────────
--
-- The trigger's DELETE branch is what removed a task's Google Calendar event,
-- and a soft delete is an UPDATE — so without this, deleting a scheduled task
-- would leave its event sitting in the user's calendar with nothing in DoDone
-- pointing at it, and restoring would never put it back.
--
-- One clause in each syncable predicate does the whole job. A soft delete
-- makes `v_new_syncable` false while `v_old_syncable` is true, which is
-- already the "enqueue a delete" branch; a restore makes it true again while
-- the old one is false, which is already the "enqueue an upsert" branch. The
-- lifecycle this trigger was written around turns out to describe deletion too.
--
-- Otherwise identical to 20260804000001, which is itself 20260629000002
-- retargeted at scheduled_date. A plpgsql body is stored as text, so it has to
-- be restated in full to change a line of it.

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
    and new.status not in ('done', 'cancelled')
    and new.deleted_at is null;

  if tg_op = 'INSERT' then
    if v_new_syncable then
      insert into calendar_outbox (user_id, task_id, op)
      values (new.user_id, new.id, 'upsert');
    end if;
    return new;
  end if;

  v_old_syncable :=
    old.scheduled_date is not null
    and old.status not in ('done', 'cancelled')
    and old.deleted_at is null;

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
