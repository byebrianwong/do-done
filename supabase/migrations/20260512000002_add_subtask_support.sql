-- ── Task input redesign · part 2 of 2 ────────────────────────
-- Subtask support via self-reference on tasks. Subtasks are full tasks
-- with all the same properties — they just have a parent_task_id and a
-- non-zero depth.
--
-- Depth is enforced by trigger: 0 = main, 1 = subtask, 2 = sub-subtask.
-- Sub-subtasks cannot have children. The trigger fires on insert and on
-- any update that changes parent_task_id.
--
-- On delete: deleting a parent cascades to all descendants. RLS continues
-- to scope by user_id (no changes needed; subtasks belong to the same user
-- as their parent — enforced at the API layer).

alter table public.tasks
  add column parent_task_id uuid references public.tasks(id) on delete cascade,
  add column depth integer not null default 0 check (depth between 0 and 2);

create index tasks_parent_idx
  on public.tasks (parent_task_id)
  where parent_task_id is not null;

create index tasks_depth_idx on public.tasks (user_id, depth);

comment on column public.tasks.parent_task_id is
  'Parent task for subtasks. Null for top-level (main) tasks. On delete of parent, descendants are cascaded.';

comment on column public.tasks.depth is
  'Depth in the subtask tree. 0 = main task, 1 = subtask, 2 = sub-subtask. Enforced by tasks_enforce_depth trigger; sub-subtasks cannot have their own children.';

-- ── Depth enforcement trigger ─────────────────────────────────

create or replace function public.tasks_enforce_depth()
returns trigger
language plpgsql
as $$
declare
  parent_depth integer;
begin
  if new.parent_task_id is null then
    new.depth := 0;
    return new;
  end if;

  -- Prevent a task pointing at itself
  if new.parent_task_id = new.id then
    raise exception 'task cannot be its own parent';
  end if;

  select depth into parent_depth
  from public.tasks
  where id = new.parent_task_id;

  if parent_depth is null then
    raise exception 'parent_task_id % not found', new.parent_task_id;
  end if;

  if parent_depth >= 2 then
    raise exception 'cannot nest deeper than 3 levels (parent already at depth %)', parent_depth;
  end if;

  new.depth := parent_depth + 1;
  return new;
end;
$$;

create trigger tasks_enforce_depth_trigger
  before insert or update of parent_task_id
  on public.tasks
  for each row
  execute function public.tasks_enforce_depth();
