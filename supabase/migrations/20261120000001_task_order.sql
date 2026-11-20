-- Every task gets its own position in one order per user.
--
-- Before this, `tasks.sort_order` was an integer that defaulted to 0. A task
-- only got a distinct value when it was dragged, and a drag re-stamped the
-- whole section it happened in as 1000, 2000, 3000. So most tasks shared 0,
-- and two sections dragged separately reused the same numbers. Postgres
-- returns tied rows in no particular order, so two tasks could swap places
-- between two views, or between two reads of the same view, and paging with
-- LIMIT/OFFSET could skip or repeat rows.
--
-- Now:
--
-- - `sort_order` is a float8 and every row has its own value. The order of a
--   user's tasks is `(sort_order, id)`. `id` only decides a tie, which happens
--   only when two devices place a task into the same gap at the same moment.
-- - A drag writes one row: the moved task gets a key between its new
--   neighbours (`place_task`). Every other task keeps its key, so two tasks
--   keep their relative order until one of them is moved past the other.
-- - Making a sorted view manual (`adopt_task_order`) permutes the shown tasks
--   among the keys they already hold, so tasks the view does not show do not
--   move.
-- - A new row gets its key from `task_place_new`. A top-level task goes first,
--   which is where the demo sandbox already put it. A subtask or a list item
--   goes last, which is where `listSubtasks` and `listItems` put them before,
--   by `created_at`.
--
-- Midpoints between float8 keys run out after about 40 inserts into the same
-- gap. `place_task` then renumbers the user's order once and tries again.
--
-- NUMBERING. Supabase keys `schema_migrations` on the 14-digit prefix alone.
-- This number is past every version in the tree at the time of writing
-- (20261004000001). Re-check `supabase migration list --linked` at merge time,
-- not just the files on this branch.

-- ── The column ─────────────────────────────────────────

alter table tasks alter column sort_order drop default;
alter table tasks alter column sort_order type double precision;

comment on column tasks.sort_order is
  'Position in the user''s single task order. Unique per user in practice; the order is (sort_order, id). Written only by task_place_new, place_task, adopt_task_order and task_order_renumber.';

-- ── Renumber what is there ─────────────────────────────
--
-- Rows that were dragged keep their relative order. Rows that shared a value
-- are put in the order new rows will arrive in from now on:
--
-- - top-level tasks newest first, since a new one goes first;
-- - subtasks and list items oldest first, which is what `listSubtasks` and
--   `listItems` already used, by `created_at`.
--
-- Top-level tasks never had an order among themselves before this. Postgres
-- returned the tied rows in whatever order its sort produced.
--
-- `tasks_updated_at` is off for this one statement. Every row changes, and
-- `PetsApi` reads the newest `updated_at` as the user's last activity, so
-- leaving it on would record a burst of activity nobody did.

alter table tasks disable trigger tasks_updated_at;

update tasks t
   set sort_order = r.rn * 1024
  from (
    select id,
           row_number() over (
             partition by user_id
             order by
               sort_order,
               case
                 when parent_task_id is null and not is_list_item
                   then -extract(epoch from created_at)
                 else extract(epoch from created_at)
               end,
               id
           ) as rn
      from tasks
  ) r
 where t.id = r.id;

alter table tasks enable trigger tasks_updated_at;

-- Every manual-order read is `order by sort_order, id` for one user, and
-- `task_place_new` reads the min or max key for one user.
create index if not exists idx_tasks_user_order
  on tasks (user_id, sort_order, id);

-- ── A key between two others ───────────────────────────
--
-- `rankBetween` in packages/shared/src/task-order.ts is the same arithmetic,
-- for the key a client shows before the server answers. Keep them in step.

create or replace function task_rank_between(
  p_lo double precision,
  p_hi double precision
) returns double precision
language plpgsql
immutable
as $$
declare
  v_mid double precision;
begin
  if p_lo is null and p_hi is null then
    return 0;
  end if;
  if p_lo is null then
    return p_hi - 1024;
  end if;
  if p_hi is null then
    return p_lo + 1024;
  end if;
  if p_lo >= p_hi then
    return null;
  end if;
  v_mid := p_lo + (p_hi - p_lo) / 2;
  -- Adjacent float8 values have no midpoint: the division rounds back onto
  -- one of the bounds.
  if v_mid <= p_lo or v_mid >= p_hi then
    return null;
  end if;
  return v_mid;
end;
$$;

comment on function task_rank_between(double precision, double precision) is
  'A key strictly between p_lo and p_hi, 1024 past an open end, or null when the gap has no float8 between its bounds.';

-- ── Renumbering ────────────────────────────────────────
--
-- Spaces the user's keys 1024 apart again, in the same order. Only called when
-- a gap has run out. Rows whose key is already right are not written, and a
-- key change alone does not enqueue a calendar push (`tasks_calendar_enqueue`
-- compares other columns).

create or replace function task_order_renumber(p_user uuid)
returns void
language sql
as $$
  update tasks t
     set sort_order = r.rn * 1024
    from (
      select id, row_number() over (order by sort_order, id) as rn
        from tasks
       where user_id = p_user
    ) r
   where t.id = r.id
     and t.sort_order <> r.rn * 1024;
$$;

comment on function task_order_renumber(uuid) is
  'Respaces one user''s task keys 1024 apart, keeping their (sort_order, id) order.';

-- ── New rows ───────────────────────────────────────────
--
-- The column has no default, so an insert that names no key arrives here with
-- null and leaves with one. NOT NULL is checked after BEFORE triggers.
--
-- SECURITY DEFINER for the projects lookup, for the same reason as
-- `task_sync_is_list_item`. The min/max read is scoped to the row's own user.

create or replace function task_place_new()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last boolean;
begin
  if new.sort_order is not null then
    return new;
  end if;

  v_last := new.parent_task_id is not null
    or exists (
      select 1 from projects p
       where p.id = new.project_id and p.kind = 'list'
    );

  if v_last then
    new.sort_order := coalesce(
      (select max(sort_order) from tasks where user_id = new.user_id), 0
    ) + 1024;
  else
    new.sort_order := coalesce(
      (select min(sort_order) from tasks where user_id = new.user_id), 0
    ) - 1024;
  end if;
  return new;
end;
$$;

comment on function task_place_new() is
  'BEFORE INSERT on tasks: gives a row with no sort_order a key. Top-level tasks go first; subtasks and list items go last.';

drop trigger if exists tasks_place_new on tasks;
create trigger tasks_place_new
  before insert on tasks
  for each row execute function task_place_new();

-- ── Moving one task ────────────────────────────────────
--
-- The client passes the task's new neighbours as it saw them. The server reads
-- their keys itself, so a client whose cache is behind still lands the task
-- next to the row it was dropped beside.
--
-- With `p_after`, the task goes directly after that row in the user's whole
-- order, and `p_before` is not read. Without it, the task goes directly before
-- `p_before`. "Directly" matters: the client only sees the rows its view
-- shows, and a key computed from those two alone could land among hidden rows
-- on either side of them. This way the task sits next to the row it was
-- dropped beside in every view that shows both.
--
-- Both null means the destination showed nothing else, so there is nothing to
-- be next to and the key is left alone.
--
-- Returns the task's key.

create or replace function place_task(
  p_task uuid,
  p_after uuid default null,
  p_before uuid default null
) returns double precision
language plpgsql
as $$
declare
  v_user uuid;
  v_ref double precision;
  v_lo double precision;
  v_hi double precision;
  v_key double precision;
begin
  select user_id, sort_order into v_user, v_key from tasks where id = p_task;
  if v_user is null then
    raise exception 'place_task: task % not found', p_task using errcode = 'P0002';
  end if;
  if p_after = p_task or p_before = p_task then
    raise exception 'place_task: a task cannot be placed next to itself' using errcode = '22023';
  end if;
  if p_after is null and p_before is null then
    return v_key;
  end if;

  for attempt in 1..2 loop
    if p_after is not null then
      select sort_order into v_ref from tasks where id = p_after and user_id = v_user;
      if not found then
        raise exception 'place_task: task % not found', p_after using errcode = 'P0002';
      end if;
      v_lo := v_ref;
      -- SELECT INTO with no row sets the target to null: placed last.
      select sort_order into v_hi
        from tasks
       where user_id = v_user
         and id <> p_task
         and (sort_order, id) > (v_ref, p_after)
       order by sort_order, id
       limit 1;
    else
      select sort_order into v_ref from tasks where id = p_before and user_id = v_user;
      if not found then
        raise exception 'place_task: task % not found', p_before using errcode = 'P0002';
      end if;
      v_hi := v_ref;
      select sort_order into v_lo
        from tasks
       where user_id = v_user
         and id <> p_task
         and (sort_order, id) < (v_ref, p_before)
       order by sort_order desc, id desc
       limit 1;
    end if;

    v_key := task_rank_between(v_lo, v_hi);
    exit when v_key is not null;
    -- No room: either the gap has run out, or the two neighbours share a key.
    -- Renumbering fixes both, and the loop reads the new keys.
    perform task_order_renumber(v_user);
  end loop;

  if v_key is null then
    raise exception 'place_task: no key after renumbering';
  end if;

  update tasks set sort_order = v_key where id = p_task;
  return v_key;
end;
$$;

comment on function place_task(uuid, uuid, uuid) is
  'Moves one task directly after p_after (or, without it, directly before p_before) in its user''s order. Renumbers once if the gap has run out. Returns the new key.';

-- ── Making a sorted view manual ────────────────────────
--
-- `p_ids` is the order the view showed. The tasks keep the set of keys they
-- already hold and are dealt them in that order, so every task outside the
-- list keeps its place relative to the slots.

create or replace function adopt_task_order(p_ids uuid[])
returns void
language plpgsql
as $$
declare
  v_count int;
  v_found int;
  v_users int;
  v_user uuid;
  v_keys int;
begin
  v_count := coalesce(cardinality(p_ids), 0);
  if v_count = 0 then
    return;
  end if;
  if (select count(distinct x) from unnest(p_ids) as x) <> v_count then
    raise exception 'adopt_task_order: duplicate ids' using errcode = '22023';
  end if;

  select count(*), count(distinct user_id), min(user_id::text)::uuid,
         count(distinct sort_order)
    into v_found, v_users, v_user, v_keys
    from tasks
   where id = any(p_ids);

  if v_found <> v_count then
    raise exception 'adopt_task_order: % of % tasks found', v_found, v_count
      using errcode = 'P0002';
  end if;
  if v_users <> 1 then
    raise exception 'adopt_task_order: tasks belong to more than one user'
      using errcode = '22023';
  end if;
  -- Two tasks sharing a key would keep sharing it, and their order would fall
  -- to the id rather than to the list.
  if v_keys < v_found then
    perform task_order_renumber(v_user);
  end if;

  with slots as (
    select sort_order, row_number() over (order by sort_order, id) as n
      from tasks
     where id = any(p_ids)
  ),
  wanted as (
    select id, n from unnest(p_ids) with ordinality as w(id, n)
  )
  update tasks t
     set sort_order = s.sort_order
    from wanted w
    join slots s on s.n = w.n
   where t.id = w.id
     and t.sort_order <> s.sort_order;
end;
$$;

comment on function adopt_task_order(uuid[]) is
  'Deals the listed tasks the keys they already hold, in the listed order. Tasks not listed keep their keys.';

-- ── Access ─────────────────────────────────────────────
--
-- SECURITY INVOKER throughout, so RLS scopes every read and write to the
-- caller's own rows. The service role (MCP) bypasses RLS, which is why each
-- function scopes by the user of the task it was handed.

revoke execute on function task_order_renumber(uuid) from public, anon;
revoke execute on function place_task(uuid, uuid, uuid) from public, anon;
revoke execute on function adopt_task_order(uuid[]) from public, anon;

grant execute on function task_order_renumber(uuid) to authenticated, service_role;
grant execute on function place_task(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function adopt_task_order(uuid[]) to authenticated, service_role;
