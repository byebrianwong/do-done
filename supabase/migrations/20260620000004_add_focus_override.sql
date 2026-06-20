-- ── Add a user override for Today's Focus section ────────────
-- Focus membership is normally computed by the urgency algorithm
-- (generateFocusList in @do-done/task-engine). This column lets a user edit
-- Focus by dragging tasks in and out of it:
--   'include' → pinned into Focus (force-include, even if low urgency)
--   'exclude' → pushed out of Focus (force-exclude an auto-picked task)
--   null      → defer to the algorithm (the default)
--
-- Nullable, so the inline CHECK passes on NULL. No index: the override is read
-- as part of the user's already-fetched task set and filtered client-side.

alter table public.tasks
  add column focus_override text
    check (focus_override in ('include', 'exclude'));

comment on column public.tasks.focus_override is
  'User override for the Today Focus section: include = pinned in, exclude = forced out, null = algorithm decides.';
