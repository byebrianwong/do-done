# @do-done/api-client

Supabase client wrapper and typed API classes.

## Key Files
- `src/supabase.ts` — Client factories (service role for MCP, anon for apps)
- `src/tasks.ts` — TasksApi: list, create, update, complete, search, getInbox, getToday, getUpcoming
- `src/projects.ts` — ProjectsApi: list, getById, create
- `src/locations.ts` — LocationsApi: list, create, linkTask, getTaskLocations

## Rules
- Always check `.error` from Supabase responses
- Return `{ data, error }` tuples from all methods
- Use types from `@do-done/shared` for all return types
- Service client (for MCP) passes userId explicitly; browser client relies on RLS
