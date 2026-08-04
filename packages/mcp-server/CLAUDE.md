# @do-done/mcp-server

Transport-agnostic MCP server for do-done. Owns every tool and resource; the
transports live elsewhere (`apps/mcp` for stdio, `apps/web` for HTTP).

## Key Files
- `src/index.ts` — `createDoDoneServer({ supabase, userId, baseUrl? })`, the shared factory
- `src/icon.ts` — the DoDone mark advertised as the server's `icons`
- `src/tools/index.ts` — 8 task tools (list_tasks, create_task, update_task,
  complete_task, search_tasks, get_focus_tasks, get_weekly_summary,
  organize_tasks) + 2 project tools (list_projects, reorder_projects)
- `src/tools/pets.ts` — 5 pet tools: get_pet_state, propose_pet_goal,
  accept_pet_goal, narrate_task_completion, get_pet_history
- `src/resources/index.ts` — 4 resources: tasks://inbox, tasks://today,
  tasks://upcoming, tasks://projects
- `src/organize.ts` — the `organize_tasks` implementation

Task status/priority enums in the tool schemas reuse `TaskStatus` /
`TaskPriority` from `@do-done/shared` so they can't drift from the canonical
schema.

## Scoping

Every registrar takes `(server, supabase, userId)` and constructs its API
objects up front, so a server instance is permanently bound to one user. Hosted
callers therefore build a **new server per authenticated request** rather than
sharing a process-wide instance — cheap, and the only safe thing to do once the
endpoint is multi-user.

## Branding

The `Implementation` block is what a client draws in its connector list, so it
carries more than `name`/`version`:

- `name` stays `do-done` — it is the protocol id clients key their config on.
- `title` is `DoDone`, the brand as humans read it.
- `icons` comes from `src/icon.ts`. Declaring nothing here is why the connector
  used to render a stock star: the client had no artwork and fell back to a
  placeholder. Two entries are offered — the hosted `<baseUrl>/icon.png` (the
  same app icon the site serves; reachable anonymously because the auth proxy's
  matcher excludes `.png`) and a self-contained `data:` SVG, which is all the
  stdio server can offer since it has no public URL.

`baseUrl` is branding-only; the HTTP route passes `getBaseUrl(request)`, stdio
omits it.

## MCP SDK Patterns
- `new McpServer({ name, title, version, icons })` for server creation
- `server.tool(name, description, zodSchema, handler)` for tool registration
- `server.resource(name, uri, handler)` for resource registration
- Use `console.error()` for logging — never `console.log`, since under stdio
  transport stdout carries the MCP protocol itself
