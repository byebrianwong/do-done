-- Widen the notes (`description`) limit on tasks: 5,000 → 50,000 characters.
--
-- The old cap was a silent trap. No editor bounded the notes textarea, so the
-- first write past 5,000 chars failed this CHECK — and because the autosave
-- hook diffs against the snapshot the modal opened with, the oversized
-- description stayed in the patch and every *later* save of that task failed
-- too. Title, priority and date edits all stopped persisting, with only a red
-- "Save failed" dot to explain it.
--
-- The inputs now stop at exactly TASK_DESCRIPTION_MAX_LENGTH
-- (packages/shared/src/constants.ts), so this constraint is a backstop for
-- writes that bypass an editor (MCP, raw SQL) rather than something a typing
-- user can hit. Keep the two numbers in step.
--
-- 50,000 chars stays well inside the 1MB ceiling `to_tsvector` imposes on the
-- `fts` generated column, which also reads `description`.

alter table tasks
  drop constraint if exists tasks_description_check;

alter table tasks
  add constraint tasks_description_check
  check (char_length(description) <= 50000);
