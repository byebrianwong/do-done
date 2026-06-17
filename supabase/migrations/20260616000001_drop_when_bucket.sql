-- ── Drop soft scheduling buckets ─────────────────────────────
-- DoDone no longer has fuzzy "when_bucket" windows — scheduling is always a
-- concrete when_date. Human-friendly labels (Tomorrow, This week, This weekend,
-- Next week) now resolve to real calendar dates in the app instead.
--
-- This migration first preserves existing intent by converting bucketed tasks
-- to concrete dates, then drops the column (which also drops its inline check
-- constraint and the partial index).
--
-- Date conversions mirror the app's resolveQuickSchedule():
--   today      → today
--   tomorrow   → +1 day
--   this_week  → this Friday  (dow 5)
--   next_week  → +7 days
--   later      → cleared (becomes unscheduled)
--   someday    → cleared (becomes unscheduled)
-- Uses current_date (server timezone); a one-time best-effort backfill.

update public.tasks
  set when_date = case when_bucket
    when 'today' then current_date
    when 'tomorrow' then current_date + 1
    when 'this_week' then current_date + ((5 - extract(dow from current_date)::int + 7) % 7)
    when 'next_week' then current_date + 7
    else when_date -- later / someday leave unscheduled
  end
  where when_bucket is not null
    and when_date is null;

-- Partial index on when_bucket would be auto-dropped with the column, but be
-- explicit to keep the intent clear.
drop index if exists public.tasks_when_bucket_idx;

alter table public.tasks
  drop column if exists when_bucket;

comment on column public.tasks.when_date is
  'Specific calendar day the user plans to do this task (Things-3-style "do date"). Distinct from due_date which is a hard deadline.';
