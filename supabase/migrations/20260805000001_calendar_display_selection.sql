-- Let the user choose which Google calendars appear inside DoDone.
--
-- Before this, the display reader took whatever Google had flagged `selected`
-- and kept the first 10 in list order. A user with 20+ subscribed calendars
-- (holidays, weather, sports, shared family calendars) had the tail silently
-- dropped, so a calendar created last week could never show up and nothing in
-- the UI said why.
--
-- Stored as the EXCLUSION set rather than the selection: a calendar the user
-- creates tomorrow is not in this array, so it shows by default. NULL means
-- the user has never opened the picker — the reader then falls back to
-- Google's own `selected` flags, so this migration changes nothing on its own.
alter table user_preferences
  add column if not exists hidden_calendar_ids text[];

comment on column user_preferences.hidden_calendar_ids is
  'Google calendar ids hidden from DoDone views. NULL = never configured; fall back to Google''s selected flags. Empty array = show everything.';
