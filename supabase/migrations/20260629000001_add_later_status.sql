-- Add the "later" task status: a parked / someday bucket for tasks the user
-- wants to track but deliberately keep out of sight for a while. It sits ahead
-- of not_started in the lifecycle (the coldest active status).
--
-- Swap the CHECK constraint to allow the new value. No data rewrite needed —
-- existing rows keep their current status.

alter table public.tasks
  drop constraint if exists tasks_status_check;

alter table public.tasks
  add constraint tasks_status_check
  check (status in (
    'inbox',
    'later',
    'not_started',
    'next',
    'in_progress',
    'done',
    'cancelled'
  ));
