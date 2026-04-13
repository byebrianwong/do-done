# @do-done/mcp

MCP (Model Context Protocol) server for Claude Code integration.

## Key Files
- `src/index.ts` — Entry point. Creates McpServer, connects via StdioServerTransport
- `src/tools/index.ts` — 8 tools: list_tasks, create_task, update_task, complete_task, search_tasks, get_focus_tasks, get_weekly_summary, organize_tasks
- `src/resources/index.ts` — 4 resources: tasks://inbox, tasks://today, tasks://upcoming, tasks://projects

## MCP SDK Patterns
- `new McpServer({ name, version })` for server creation
- `server.tool(name, description, zodSchema, handler)` for tool registration
- `server.resource(name, uri, handler)` for resource registration
- `new StdioServerTransport()` for Claude Code connection
- Use `console.error()` for logging (never `console.log` — stdout is for MCP protocol)

## Environment Variables
- SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — database access (bypasses RLS)
- DO_DONE_USER_ID — which user's tasks to manage

## Claude Desktop Config
```json
{
  "mcpServers": {
    "do-done": {
      "command": "node",
      "args": ["path/to/do-done/apps/mcp/dist/index.js"],
      "env": {
        "SUPABASE_URL": "...",
        "SUPABASE_SERVICE_ROLE_KEY": "...",
        "DO_DONE_USER_ID": "..."
      }
    }
  }
}
```
