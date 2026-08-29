-- Per-task reminder settings.
--
-- The digests added in 20260815000001 describe a *day*. These describe a
-- *task*: on the day it is scheduled, at the time it is scheduled for.
--
--   notify_task_reminders             — the master switch. Off by default.
--   notify_task_reminder_lead_minutes — fire this many minutes before the
--                                       task's own time. 0 = at the time.
--   notify_day_start_roundup          — one grouped notification naming the
--                                       tasks scheduled for today that have
--                                       no time of day.
--   notify_day_start_time             — when that roundup fires.
--
-- Off by default for the same reason the digests and status_sync_promote are:
-- nobody should find that a deploy started sending them notifications. The
-- settings screen is the only thing that turns it on, and it asks for the OS
-- permission at the moment it does.
--
-- The roundup defaults ON rather than off, because it only ever takes effect
-- while notify_task_reminders is true — which is itself off by default, so no
-- existing row starts notifying. Someone who switches per-task reminders on has
-- asked for their scheduled tasks to be announced, and most tasks in DoDone
-- carry a scheduled_date with no scheduled_time; a roundup defaulting off would
-- silently cover almost none of them.
--
-- Times are wall-clock `HH:MM` **in the user's own timezone**
-- (user_preferences.timezone), never UTC and never the process clock's zone —
-- see CLAUDE.md → Dates and the note in 20260815000001.

alter table public.user_preferences
  add column if not exists notify_task_reminders boolean not null default false,
  add column if not exists notify_task_reminder_lead_minutes integer not null default 0,
  add column if not exists notify_day_start_roundup boolean not null default true,
  add column if not exists notify_day_start_time text not null default '09:00';

-- 24-hour wall clock, zero-padded. Mirrors CLOCK_TIME_PATTERN in
-- packages/shared/src/schemas.ts — the client rejects the same strings, so this
-- only ever catches a hand-written row.
alter table public.user_preferences
  drop constraint if exists user_preferences_notify_day_start_time_check;
alter table public.user_preferences
  add constraint user_preferences_notify_day_start_time_check
  check (notify_day_start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- Bounded rather than free: the lead is offered as a short list of options in
-- the UI (at the time / 5 / 10 / 15 / 30 / 60), and a reminder armed further
-- ahead than a day would collide with the roundup for the day before it.
alter table public.user_preferences
  drop constraint if exists user_preferences_notify_task_reminder_lead_check;
alter table public.user_preferences
  add constraint user_preferences_notify_task_reminder_lead_check
  check (notify_task_reminder_lead_minutes between 0 and 1440);

comment on column public.user_preferences.notify_task_reminders is
  'Announce each scheduled task: timed ones at their time, untimed ones in the day-start roundup.';
comment on column public.user_preferences.notify_task_reminder_lead_minutes is
  'Minutes before a task''s own scheduled_time to fire its reminder. 0 = at the time.';
comment on column public.user_preferences.notify_day_start_roundup is
  'One grouped notification naming today''s scheduled tasks that have no time of day.';
