# @do-done/api-client

Supabase client wrapper and typed API classes.

## Key Files
- `src/supabase.ts` — Client factories (service role for MCP, anon for apps)
- `src/tasks.ts` — TasksApi: list, create, update, complete, search, getInbox, getToday, getUpcoming, getDatedBetween, getOverdue, listTags, listByTag, suggestionHistory, delete, restore, purgeDeleted
- `src/projects.ts` — ProjectsApi: list, getById, create
- `src/locations.ts` — LocationsApi: list, listAll, create, update, remove, linkTask, unlinkTask, getTaskLocations, listTaskLinks, save, listWithPendingTasks

## Rules
- `getToday`/`getUpcoming` derive "today" from the **process** clock, which is
  UTC on a deployed host. Server-side callers should use `getDatedBetween` /
  `getOverdue` and pass the day they resolved from the user's timezone instead.
- **`completed_at` is owned by `update()`, in both directions.** It stamps on
  the transition into `done` and clears on any status change out of it, so a
  task taken out of done by the editor or an autosave undo does not keep a
  timestamp that the Completed list and the weekly summary read as "finished".
- **`reopen(id, restoreStatus?)` restores the status as well as the state.**
  Callers that know what the task was before it was completed (a completion
  toast's Undo, which captured the row as it was) pass it; a bare uncheck has no
  earlier state and gets `not_started`. `done` is refused, or the Undo button
  would visibly do nothing.
- **Deleting is reversible, and every read has to know.** `delete()` stamps
  `deleted_at` across the subtree and returns the ids it touched; `restore(ids)`
  clears it; `purgeDeleted()` does the real destroying once the retention window
  has passed, clearing the Storage bytes before the rows. That is what lets Undo
  hand back *the same task* — same id, same subtasks, same files — rather than
  creating a new row with the same title. **Every read goes through the private
  `read()` helper**, which carries the `deleted_at is null` filter, and that is
  the only thing hiding a deleted task: `tasks_select` is the plain owner check
  and **must not be narrowed to `deleted_at is null`**, or every delete 403s
  (PostgREST's UPDATE returns its rows, so the select policy is applied to the
  row the write just produced — see `20260811000001`). Reads that live outside
  this class (`BusynessApi`, `ProjectsApi.listWithCounts`, the pet tallies) carry
  the filter explicitly for the same reason.
- **`listTags()` sweeps every task row, and has to.** Tags have no table — a tag
  exists only while some task carries it — so counting them means reading
  `tags, status` off all of them, exactly as `ProjectsApi.listWithCounts` does
  for projects. The rollup itself is `summarizeTags` in `@do-done/shared`, so
  web, mobile, the demo sandbox and MCP cannot disagree about a count.
  `listByTag()` filters server-side via `overlaps` (the GIN index), never by
  paging tasks and filtering in the client.
- **`suggestionHistory()` makes the opposite trade to `listTags()`** — three
  narrow columns, newest-first, bounded. It feeds a guess, not an index, so a row
  it misses barely matters; `listTags` must sweep everything because a tag it
  misses does not exist to the app at all. The rollup is `buildSuggestionIndex`
  in `@do-done/shared`.
- **`getTaskLocations` returns links with the place joined on**, not raw
  `task_locations` rows. The query always embedded `locations(*)`; the declared
  type said otherwise and every caller re-cast it by hand. `listTaskLinks()` is
  the same read for the whole account, so a *list* can badge its rows from one
  query instead of one per row. Both drop a link whose place did not resolve —
  the FK cascades, so that only happens to a read racing a delete.
- **`linkTask` upserts.** The three columns are the primary key, so a plain
  insert answers "remind me here" a second time with a duplicate-key error, for a
  state the user already has.
- Always check `.error` from Supabase responses
- Return `{ data, error }` tuples from all methods
- Use types from `@do-done/shared` for all return types
- Service client (for MCP) passes userId explicitly; browser client relies on RLS
