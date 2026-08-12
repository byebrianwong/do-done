-- Shopping lists: a project with a `kind`, whose tasks are items.
--
-- A thing you are going to buy genuinely *is* a small task — it gets ticked
-- off, it can carry a note or a photo of the label, it can be moved, and it
-- has to come back when you tap it by mistake while walking. All of that
-- already exists and is already careful, so an item is a `tasks` row.
--
-- A list is *not* a task. A task is finished once; a shopping list is
-- standing — it empties and refills forever. Modelled as a task it would be
-- either a permanently open row cluttering the list or a recurrence pretending
-- Saturday's groceries are the same work as last Saturday's. A project is
-- already the thing that is named, coloured, iconed, ordered, counted, has a
-- page and a sidebar slot — and is already reachable by typing its name, so
-- `milk #groceries` files into a list the day this lands.
--
-- Two columns, and the second one is the whole isolation story.

-- ── projects.kind ──────────────────────────────────────

alter table projects
  add column if not exists kind text not null default 'tasks'
  check (kind in ('tasks', 'list'));

comment on column projects.kind is
  'tasks = an ordinary project. list = a shopping list: its tasks are items, excluded from every task view and counted separately.';

-- Both readers that matter ask for "this user's projects of one kind" — the
-- sidebar splits them into two sections and never wants them interleaved.
create index if not exists idx_projects_user_kind
  on projects(user_id, kind);

-- ── tasks.is_list_item ─────────────────────────────────
--
-- Denormalised from the task's project, and maintained by the two triggers
-- below rather than by any caller.
--
-- The alternative was to filter in the client, which fails the only test that
-- matters here: *a rule you can forget is a rule that shows someone their
-- groceries in Today*. There are fifteen reads in TasksApi, plus the pet
-- tallies, the busyness sweep, the widget, the focus algorithm and the
-- calendar trigger, and PostgREST cannot express "where the project's kind is
-- not 'list'" as a filter — an embedded `projects!inner(kind)` would drop
-- every task with no project at all.
--
-- With the flag on the row, `TasksApi.read()` carries the condition exactly the
-- way it already carries `deleted_at is null`: one door, impossible to miss,
-- and the list page opts in explicitly through a second door.
alter table tasks
  add column if not exists is_list_item boolean not null default false;

comment on column tasks.is_list_item is
  'True when this task belongs to a project with kind = ''list''. Derived — set by trigger, never by a caller. Every read of the task universe filters it out; only the list surfaces ask for it.';

-- The task universe is "not a list item", and it is read constantly. The
-- partial index keeps that the cheap case rather than the flag being a column
-- the planner has to consider.
create index if not exists idx_tasks_user_not_list
  on tasks(user_id)
  where is_list_item = false and deleted_at is null;

create index if not exists idx_tasks_list_items
  on tasks(project_id)
  where is_list_item = true and deleted_at is null;

-- ── Keeping the flag true ──────────────────────────────
--
-- Two directions, because there are two ways a task's list-ness can change:
-- the task moves into or out of a list, and the project itself changes kind.

create or replace function task_sync_is_list_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.is_list_item := coalesce(
    (select p.kind = 'list' from projects p where p.id = new.project_id),
    false
  );
  return new;
end;
$$;

comment on function task_sync_is_list_item() is
  'BEFORE INSERT/UPDATE on tasks: derive is_list_item from the project''s kind. SECURITY DEFINER so the projects lookup is not itself subject to RLS — a shared list belongs to someone else, and an item added by a collaborator must still be flagged.';

drop trigger if exists tasks_sync_is_list_item on tasks;
create trigger tasks_sync_is_list_item
  before insert or update of project_id on tasks
  for each row execute function task_sync_is_list_item();

create or replace function project_cascade_kind()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind is distinct from old.kind then
    update tasks
       set is_list_item = (new.kind = 'list')
     where project_id = new.id
       and is_list_item is distinct from (new.kind = 'list');
  end if;
  return new;
end;
$$;

comment on function project_cascade_kind() is
  'AFTER UPDATE on projects: converting a project to a list (or back) re-flags every task in it. Guarded on the value actually changing, so an ordinary project rename costs nothing.';

drop trigger if exists projects_cascade_kind on projects;
create trigger projects_cascade_kind
  after update of kind on projects
  for each row execute function project_cascade_kind();

-- Backfill. No project has kind = 'list' yet, so this is a no-op today and
-- exists so the column is never wrong on a database that got here another way.
update tasks t
   set is_list_item = true
  from projects p
 where p.id = t.project_id
   and p.kind = 'list'
   and t.is_list_item = false;

-- ── The calendar trigger learns about it ───────────────
--
-- A list item has no business on anyone's Google Calendar. It will normally
-- have no scheduled_date and so never be syncable, but "normally" is not a
-- guarantee: MCP can set one, and re-parenting a dated task into a list would
-- otherwise leave a live calendar event pointing at a tin of tomatoes.
--
-- Recreated whole rather than patched, because a plpgsql body is stored as
-- text — the same reason the date rename had to recreate both calendar
-- functions. Verbatim from 20260810000002 apart from the `is_list_item` clause
-- added to each of the two syncable predicates, and nothing else: the
-- `app.sync_origin` guard and the outbox de-dupe before an upsert are load
-- bearing and easy to lose by retyping the function from memory.
--
-- The trigger itself is unqualified (`after insert or update or delete`), so
-- the cascade below — which writes `is_list_item` and nothing else — still
-- reaches it, and a project converted to a list correctly enqueues a delete
-- for every event its now-items had.
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
    and new.deleted_at is null
    and new.is_list_item = false;

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
    and old.deleted_at is null
    and old.is_list_item = false;

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
