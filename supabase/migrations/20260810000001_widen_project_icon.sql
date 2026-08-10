-- projects.icon holds two kinds of value now.
--
-- It was `check (char_length(icon) <= 10)`, sized for one emoji. It now also
-- holds a Phosphor reference — `ph:<name>:<weight>`, e.g. `ph:briefcase:fill` —
-- which the picker writes when a project takes an icon from the drawn set
-- rather than the emoji tab.
--
-- Sixty-four is chosen against the catalogue: the longest name in it is well
-- under thirty characters, so this leaves room for names to grow without ever
-- becoming a field someone stores prose in. `PROJECT_ICON_MAX_LENGTH` in
-- @do-done/shared is the same number and is what ProjectSchema validates with;
-- the two must move together.
--
-- Widening a CHECK can never invalidate an existing row, so this needs no
-- backfill and no data migration: every emoji already stored still passes.

alter table projects drop constraint if exists projects_icon_check;

alter table projects
  add constraint projects_icon_check check (char_length(icon) <= 64);
