-- Expand task status enum:
--   todo      → not_started  (the default "active but not yet started")
--   archived  → cancelled    (decided not to do)
--   + new:     next          (up next to work on, ranked above not_started)
--
-- Order matters: drop the old CHECK first, otherwise the UPDATE that
-- rewrites status values would produce rows that violate it.

alter table public.tasks
  drop constraint if exists tasks_status_check;

update public.tasks
  set status = 'not_started'
  where status = 'todo';

update public.tasks
  set status = 'cancelled'
  where status = 'archived';

alter table public.tasks
  add constraint tasks_status_check
  check (status in (
    'inbox',
    'not_started',
    'next',
    'in_progress',
    'done',
    'cancelled'
  ));

alter table public.tasks
  alter column status set default 'inbox';
