# @do-done/mcp

Thin **stdio** entry point for the do-done MCP server. All tool and resource
registration lives in `packages/mcp-server` so other transports can share it —
see `packages/mcp-server/CLAUDE.md`.

## Key Files
- `src/index.ts` — the whole app: reads env, builds a service-role Supabase
  client, calls `createDoDoneServer()`, connects a `StdioServerTransport`.

Add tools in `packages/mcp-server`, not here.

## Environment Variables
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — database access (bypasses RLS)
- `DO_DONE_USER_ID` — which user's tasks to manage

## Registering with Claude Code

Top-level `mcpServers.do-done` in `~/.claude.json`:

```json
{
  "mcpServers": {
    "do-done": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/do-done/apps/mcp/dist/index.js"],
      "env": {
        "SUPABASE_URL": "...",
        "SUPABASE_SERVICE_ROLE_KEY": "...",
        "DO_DONE_USER_ID": "..."
      }
    }
  }
}
```

> **Do not hand-edit `claude_desktop_config.json`.** Verified on Claude Desktop
> v1.22209.3: the app owns that file, rewrites it on launch, and strips the
> entire `mcpServers` key — a hand-added server silently disappears on the next
> restart. In the unified desktop app the **Chat** tab reads remote *connectors*
> only and cannot see a local stdio server; the **Claude Code** tab is the
> surface where this stdio server works.

**Gotcha:** clients load the compiled `dist/`, not the source. After changing
MCP source you must rebuild (`pnpm --filter "@do-done/mcp..." build`) and
restart the client. `dist/` is gitignored, so it goes stale silently.
