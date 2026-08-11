-- Deleting a task 403s. The policy that hides deleted rows is the thing
-- stopping them from being deleted.
--
-- 20260810000002 narrowed `tasks_select` to `deleted_at is null`, on the stated
-- reasoning that "an UPDATE still reaches a row SELECT cannot see". That is
-- true, and it is the wrong half of the statement: the USING clause is checked
-- against the row as it *was*, and the soft delete's problem is the row as it
-- *becomes*.
--
-- Postgres applies SELECT policies to an UPDATE's result rows whenever the
-- statement carries a RETURNING clause, and PostgREST's UPDATE always does —
-- it wraps the write in a CTE and reads back from it even under
-- `Prefer: return=minimal`, because that is where the affected-row count comes
-- from. So the write went out, produced a row with `deleted_at` set, failed the
-- select policy on the way back, and came home as 42501 → HTTP 403. Every
-- RLS-bound client, which is both apps:
--
--   PATCH /rest/v1/tasks?id=in.(…)&user_id=eq.…   →  403
--
-- The same policy silently disabled the other half of the feature.
-- `purgeDeleted()` finds its rows with `not deleted_at is null`, and it is
-- driven from the apps (web's StatusSyncRunner, mobile's sweeps) over the anon
-- key — so under this policy the retention sweep matched nothing, ever, and
-- "deleted" would have quietly stopped meaning deleted the moment a delete
-- managed to land at all.
--
-- So the row-level filter goes back to the plain owner check, and hiding a
-- deleted task is left to the one mechanism that was always doing the work:
-- `TasksApi.read()`, the private helper every read in the class starts from.
-- That is not a downgrade of the guarantee. The policy was written as a
-- backstop for readers outside `TasksApi`, and there are none it could reach —
-- the calendar routes, the busyness query, the project counts and the pet
-- tallies all carry `.is("deleted_at", null)` themselves, and the ones that
-- don't hold a **service-role** client, which bypasses RLS whatever this policy
-- says. It never covered a real gap, and it broke the two writes that matter.
--
-- If a future backstop is wanted here, it cannot be a select policy: there is
-- no way to write one that hides a deleted row from a read and still lets an
-- UPDATE return it. It would have to be a `security definer` function owning
-- the delete — which then has to answer for `auth.uid()` being null under the
-- service role, i.e. for MCP, which deletes through the same `TasksApi`.

drop policy if exists "tasks_select" on tasks;
create policy "tasks_select" on tasks
  for select to authenticated
  using (user_id = auth.uid());
