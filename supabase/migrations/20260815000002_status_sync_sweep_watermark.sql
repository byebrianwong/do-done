-- Status ↔ schedule sync: remember how far the promote sweep has swept.
--
-- The promote half used to be an invariant — every foreground re-promoted every
-- task scheduled inside the horizon. That made a manual demotion impossible:
-- moving a task scheduled for tomorrow from Next back to Not started put it
-- back at Next seconds later, with nothing on screen saying why.
--
-- Promote is now a reaction to a change: a task's date being written inside the
-- horizon (handled at write time, in TasksApi), or a task's day coming near
-- because time passed. This column is what makes the second one a *change*
-- rather than a standing condition — it records the horizon the sweep last ran
-- through, so the next sweep only looks at the days that have newly crossed in.
--
-- Null means "never swept": the first sweep after this migration, and the first
-- after a user turns promote on, applies the rule to the whole list. That is
-- what enabling a setting should do, and it is also the pre-migration
-- behaviour, so nobody's list changes shape on deploy.
--
-- A date, not a timestamp: it is compared against `tasks.scheduled_date`, which
-- is a date resolved in the user's own timezone.

alter table user_preferences
  add column if not exists status_sync_swept_through date;

comment on column user_preferences.status_sync_swept_through is
  'Horizon the status-sync promote sweep last ran through. The sweep promotes only tasks scheduled after this date and on or before the current horizon, so a hand-demoted task is not re-promoted. Null = never swept; the next sweep applies the rule to the whole list.';
