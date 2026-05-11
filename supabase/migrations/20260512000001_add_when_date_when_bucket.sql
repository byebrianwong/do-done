-- ── Task input redesign · part 1 of 2 ────────────────────────
-- Adds the new "when" concept (distinct from "due"):
--   when_date    = a specific calendar day the user plans to do this
--   when_bucket  = a fuzzy window (this_week, next_week, later, someday)
-- At most one of when_date/when_bucket is set per task (enforced by Zod
-- in @do-done/shared, not by the DB — we want lookups to ignore stale data
-- gracefully rather than fail on insert during a future schema evolution).
--
-- Backward-compatible: both columns are nullable with no default. Existing
-- rows get nulls and continue to use due_date as before until the new UI
-- starts writing to these fields.

alter table public.tasks
  add column when_date date,
  add column when_bucket text check (
    when_bucket is null or when_bucket in (
      'today', 'tomorrow', 'this_week', 'next_week', 'later', 'someday'
    )
  );

-- Indexes are partial so they only carry rows that have the column set.
-- Existing queries against due_date are unaffected.

create index tasks_when_date_idx
  on public.tasks (user_id, when_date)
  where when_date is not null;

create index tasks_when_bucket_idx
  on public.tasks (user_id, when_bucket)
  where when_bucket is not null;

comment on column public.tasks.when_date is
  'Specific calendar day the user plans to do this task (Things-3-style "do date"). Distinct from due_date which is a hard deadline. Mutually exclusive with when_bucket.';

comment on column public.tasks.when_bucket is
  'Fuzzy scheduling window when the user does not want to pick a specific day. One of today/tomorrow/this_week/next_week/later/someday. Mutually exclusive with when_date.';
