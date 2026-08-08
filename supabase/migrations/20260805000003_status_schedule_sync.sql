-- Status ↔ schedule auto-sync settings.
--
-- Two independent halves, both off by default (see
-- packages/shared/src/status-sync.ts, which owns the rules):
--
--   status_sync_promote  — a task scheduled on or before the horizon is moved
--                          up to status_sync_status ("anything within 3 days
--                          is Next"). Never moves a task backwards.
--   status_sync_backfill — putting a task at status_sync_status (or past it)
--                          gives it a scheduled date of the horizon, when it
--                          had none or had one further out.
--
-- The horizon is stored in both representations at once — a day count and a
-- weekday-anchored quick-schedule key — with _kind selecting the live one.
-- Flipping between "in 3 days" and "this weekend" in settings then remembers
-- what the other mode was set to, and neither column is ever null.
--
-- Both halves default to false on purpose. The promote half rewrites statuses
-- across the user's whole list as days pass; nobody should find that switched
-- on for them by a deploy.

alter table public.user_preferences
  add column if not exists status_sync_promote boolean not null default false,
  add column if not exists status_sync_backfill boolean not null default false,
  add column if not exists status_sync_status text not null default 'next',
  add column if not exists status_sync_horizon_kind text not null default 'days',
  add column if not exists status_sync_horizon_days integer not null default 3,
  add column if not exists status_sync_horizon_key text not null default 'this_week';

-- The target must be an *active* status. 'inbox' is excluded because promoting
-- into the untriaged pile is backwards; 'done'/'cancelled' because "done in
-- three days" is not a thing the rule could mean.
alter table public.user_preferences
  drop constraint if exists user_preferences_status_sync_status_check;
alter table public.user_preferences
  add constraint user_preferences_status_sync_status_check
  check (status_sync_status in ('later', 'not_started', 'next', 'in_progress'));

alter table public.user_preferences
  drop constraint if exists user_preferences_status_sync_horizon_kind_check;
alter table public.user_preferences
  add constraint user_preferences_status_sync_horizon_kind_check
  check (status_sync_horizon_kind in ('days', 'quick'));

-- 90 days is an arbitrary ceiling, but an unbounded horizon turns the promote
-- half into "move everything to Next", which is the same as having no rule.
alter table public.user_preferences
  drop constraint if exists user_preferences_status_sync_horizon_days_check;
alter table public.user_preferences
  add constraint user_preferences_status_sync_horizon_days_check
  check (status_sync_horizon_days between 0 and 90);

-- Mirrors QUICK_SCHEDULE in packages/shared/src/utils.ts.
alter table public.user_preferences
  drop constraint if exists user_preferences_status_sync_horizon_key_check;
alter table public.user_preferences
  add constraint user_preferences_status_sync_horizon_key_check
  check (status_sync_horizon_key in (
    'today', 'tomorrow', 'this_week', 'this_weekend', 'next_week'
  ));

comment on column public.user_preferences.status_sync_promote is
  'Auto-move a task scheduled within the horizon up to status_sync_status.';
comment on column public.user_preferences.status_sync_backfill is
  'Auto-schedule a task within the horizon when it reaches status_sync_status.';
