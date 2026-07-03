-- Show Google Calendar events inside DoDone views (Today, Upcoming, Calendar).
-- Read-only display of the user's real calendar alongside tasks, Todoist-style.
-- Defaults on: connecting the calendar starts showing events immediately, and
-- the Settings toggle lets the user opt out.
alter table user_preferences
  add column if not exists show_calendar_events boolean not null default true;
