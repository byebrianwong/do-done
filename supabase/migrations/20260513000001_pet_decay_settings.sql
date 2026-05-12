-- Adds user-configurable pet decay settings for the positive Pip redesign.
--
-- New mechanics (see packages/shared/src/pet-decay.ts):
--   - Hunger decays by `hunger_daily_decay` once per local midnight.
--   - Happiness decays by `happiness_weekly_decay` once per local week-end-day.
--   - Energy decays 1 pt/hr during waking hours (8a-8p local), no config.
--
-- week_end_day uses the ISO convention 0=Sun..6=Sat. Default 0 (Sunday) matches
-- the spec's "default is end is Sunday".

alter table user_preferences
  add column hunger_daily_decay integer not null default 3
    check (hunger_daily_decay between 0 and 50),
  add column happiness_weekly_decay integer not null default 10
    check (happiness_weekly_decay between 0 and 100),
  add column week_end_day integer not null default 0
    check (week_end_day between 0 and 6);
