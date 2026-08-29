# @do-done/mcp-server

Transport-agnostic MCP server for do-done. Owns every tool and resource; the
transports live elsewhere (`apps/mcp` for stdio, `apps/web` for HTTP).

## Key Files
- `src/index.ts` — `createDoDoneServer({ supabase, userId, baseUrl? })`, the
  shared factory, plus `SERVER_INSTRUCTIONS` (sent at initialization)
- `src/icon.ts` — the DoDone mark advertised as the server's `icons`
- `src/tools/index.ts` — 9 task tools (list_tasks, create_task, update_task,
  complete_task, search_tasks, get_agenda, get_focus_tasks, get_weekly_summary,
  organize_tasks) + 2 project tools (list_projects, reorder_projects) +
  list_tags
- `src/tools/pets.ts` — 5 pet tools: get_pet_state, propose_pet_goal,
  accept_pet_goal, narrate_task_completion, get_pet_history
- `src/resources/index.ts` — 4 resources: tasks://inbox, tasks://today,
  tasks://upcoming, tasks://projects
- `src/dates.ts` — pure date rendering + agenda bucketing (tested)
- `src/clock.ts` — resolves the user's calendar day from their timezone pref
- `src/organize.ts` — the `organize_tasks` implementation

Task status/priority enums in the tool schemas reuse `TaskStatus` /
`TaskPriority` from `@do-done/shared` so they can't drift from the canonical
schema.

## Dates

This surface exists to prevent one specific failure: a client is asked "what have
I got on today?", looks for a deadline, finds none, and answers "nothing is
dated" — while the user is looking at a full Today screen. DoDone schedules on
**`scheduled_date`**; `deadline_date` is a rarely-set hard deadline. The columns
used to be named `when_date` / `due_date`, which is what made the mistake so easy
to make; they were renamed in `20260804000001_rename_task_date_fields.sql`, and
the word "due" is deliberately absent from everything this server emits. Four
things enforce the model:

- **`SERVER_INSTRUCTIONS`** states the two-field model at initialization, and
  the `DATE_MODEL` blurb repeats it in every date-touching tool description. A
  client that has already picked a tool has stopped reading descriptions, and
  one that reads only descriptions never sees the instructions — hence both.
- **Every date is emitted with its relative reading** (`"today"`,
  `"in 4 days"`, `overdue`) alongside the user's real `today`, so no caller has
  to compare a bare `2026-08-03` against its own guess at the date.
- **`get_agenda`** is the date query: overdue + one section per day, covering
  both fields. `get_focus_tasks` is an urgency *ranking* and answers a different
  question — its description says so, because it was previously the tool clients
  reached for when asked about today.
- **The field names carry the meaning on their own.** `scheduled_date` and
  `deadline_date` need no gloss. That is what the rename bought: a caller that
  ignores every paragraph above still cannot read one as the other.

`src/clock.ts` resolves "today" through `user_preferences.timezone`, never the
process clock: the hosted transport runs in UTC, so for a user behind UTC every
"today" answer shifted a day for the last few hours of their evening. The
timezone is cached per server instance; the *day* is recomputed per call, since
the stdio process sits through midnight.

Date arithmetic in `src/dates.ts` parses `YYYY-MM-DD` at UTC midnight, so a DST
boundary inside a span can't round a day count off by one.

## Tags

`list_tags` is the only way an agent learns the tags that exist: they are a
bare `text[]` on the task with no table behind them, and **`search_tasks` does
not find them** — the `fts` column covers title and description only. Its
description says both, because a client that guesses `#Work` when the user
writes `#work` gets an empty list and no hint why: matching is exact, right
down through `list_tasks`' `tags` filter to PostgREST's `overlaps`.

`create_task`/`update_task` have always accepted `tags`, so until now the
server could write a facet it could not read back.

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
- `new McpServer({ name, title, version, icons }, { instructions })` for server
  creation
- `server.tool(name, description, zodSchema, handler)` for tool registration
- `server.resource(name, uri, handler)` for resource registration
- Use `console.error()` for logging — never `console.log`, since under stdio
  transport stdout carries the MCP protocol itself
