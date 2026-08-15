-- Digest notification settings.
--
-- Two digests, both off by default (see packages/shared/src/notifications.ts,
-- which owns the copy and the rules):
--
--   notify_daily_digest   — each morning, what is on today: the count, the
--                           overdue carry-over, and the first few titles.
--   notify_weekly_digest  — once a week, the seven days ahead shaped by day.
--
-- Off by default for the same reason status_sync_promote is: nobody should
-- find that a deploy started sending them notifications. The settings screen
-- is the only thing that turns either on, and it asks for the OS permission at
-- the moment it does.
--
-- Times are wall-clock `HH:MM` **in the user's own timezone**
-- (user_preferences.timezone), never in UTC and never in the process clock's
-- zone. A digest is a thing that happens at breakfast; resolving it against a
-- host that runs in UTC would deliver it in the middle of the night for most
-- of the world. See CLAUDE.md → Dates.
--
-- Stored as text rather than Postgres `time` deliberately: PostgREST renders a
-- `time` column as "08:00:00", which is a third format for every consumer to
-- normalise, and the two apps and the settings UI all want "08:00".

alter table public.user_preferences
  add column if not exists notify_daily_digest boolean not null default false,
  add column if not exists notify_daily_digest_time text not null default '08:00',
  add column if not exists notify_weekly_digest boolean not null default false,
  add column if not exists notify_weekly_digest_weekday integer not null default 1,
  add column if not exists notify_weekly_digest_time text not null default '08:00';

-- 24-hour wall clock, zero-padded. Mirrors CLOCK_TIME_PATTERN in
-- packages/shared/src/notifications.ts — the client rejects the same strings,
-- so this only ever catches a hand-written row.
alter table public.user_preferences
  drop constraint if exists user_preferences_notify_daily_digest_time_check;
alter table public.user_preferences
  add constraint user_preferences_notify_daily_digest_time_check
  check (notify_daily_digest_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

alter table public.user_preferences
  drop constraint if exists user_preferences_notify_weekly_digest_time_check;
alter table public.user_preferences
  add constraint user_preferences_notify_weekly_digest_time_check
  check (notify_weekly_digest_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- 0 = Sunday, matching Date#getDay and the existing week_end_day column.
-- Monday is the default: a week-ahead digest is worth reading at the start of
-- the working week, not at the end of the weekend.
alter table public.user_preferences
  drop constraint if exists user_preferences_notify_weekly_digest_weekday_check;
alter table public.user_preferences
  add constraint user_preferences_notify_weekly_digest_weekday_check
  check (notify_weekly_digest_weekday between 0 and 6);

comment on column public.user_preferences.notify_daily_digest is
  'Send a daily digest of today''s tasks at notify_daily_digest_time (user timezone).';
comment on column public.user_preferences.notify_weekly_digest is
  'Send a weekly digest of the seven days ahead, on notify_weekly_digest_weekday.';
