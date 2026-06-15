-- ── Task input redesign · when-time ──────────────────────────
-- Adds an optional time-of-day to the "when" (do date) concept:
--   when_time = the clock time the user plans to start this task on when_date
--
-- Paired with when_date — it has no meaning on its own (a bucket or a bare
-- task carries no when_time). Stored as a plain "HH:MM" string to match the
-- existing due_time column; HH:MM validation lives in @do-done/shared (Zod),
-- not the DB, so stale/partial data degrades gracefully instead of failing
-- inserts.
--
-- Backward-compatible: nullable with no default. Existing rows get null and
-- behave exactly as before (a when_date with no specific time).

alter table public.tasks
  add column when_time text; -- "HH:MM", paired with when_date

comment on column public.tasks.when_time is
  'Time of day for the when_date do date, in "HH:MM" format. Paired with when_date; has no meaning without it.';
