# @do-done/api-client

Supabase client wrapper and typed API classes.

## Key Files
- `src/supabase.ts` — Client factories (service role for MCP, anon for apps)
- `src/tasks.ts` — TasksApi: list, create, update, complete, search, getInbox, getToday, getUpcoming, getDatedBetween, getOverdue, listTags, listByTag
- `src/projects.ts` — ProjectsApi: list, getById, create
- `src/locations.ts` — LocationsApi: list, create, update, remove, linkTask, unlinkTask, getTaskLocations, listWithPendingTasks

## Rules
- `getToday`/`getUpcoming` derive "today" from the **process** clock, which is
  UTC on a deployed host. Server-side callers should use `getDatedBetween` /
  `getOverdue` and pass the day they resolved from the user's timezone instead.
- **`completed_at` is owned by `update()`, in both directions.** It stamps on
  the transition into `done` and clears on any status change out of it, so a
  task taken out of done by the editor or an autosave undo doesn't keep a
  timestamp that the Completed list and the weekly summary read as "finished".
- **`reopen(id, restoreStatus?)` — an undo is only an undo if the status comes
  back too.** Callers that know what the task was before it was completed (a
  completion toast's Undo, which captured the row as it was) pass it; a bare
  uncheck has no earlier state and gets `not_started`. `done` is refused, or
  the Undo button would visibly do nothing.
- **`listTags()` sweeps every task row, and has to.** Tags have no table — a
  tag exists only while some task carries it — so counting them means reading
  `tags, status` off all of them, exactly as `ProjectsApi.listWithCounts` does
  for projects. The rollup itself is `summarizeTags` in `@do-done/shared`, so
  web, mobile, the demo sandbox and MCP can't disagree about a count.
  `listByTag()` filters server-side via `overlaps` (the GIN index), never by
  paging tasks and filtering in the client.
- Always check `.error` from Supabase responses
- Return `{ data, error }` tuples from all methods
- Use types from `@do-done/shared` for all return types
- Service client (for MCP) passes userId explicitly; browser client relies on RLS
