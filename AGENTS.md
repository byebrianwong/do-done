# Agent Coordination

This monorepo supports parallel development by three specialized agents.

## Agent Roles

### Backend Agent
**Paths**: `packages/shared/`, `packages/api-client/`, `packages/task-engine/`, `apps/mcp/`, `supabase/`
**Focus**: Schemas, API client, task engine logic, MCP server, database migrations

### Web Agent
**Paths**: `apps/web/`, `packages/ui/`
**Focus**: Next.js web app, auth, views, components, design system

### Mobile Agent
**Paths**: `apps/mobile/`
**Focus**: Expo/React Native app, widgets, voice input, geofencing

## Coordination Rules

1. **Types**: All agents import from `@do-done/shared` only. Never duplicate type definitions.
2. **Data access**: Use `@do-done/api-client` for all Supabase queries. Never use raw Supabase calls in apps.
3. **Boundaries**: Stay in your assigned paths. If you need a change in another agent's area, document it as a TODO.
4. **Shared changes**: Changes to `packages/shared/` schemas affect all agents. Coordinate before modifying.
5. **Design tokens**: Use `packages/ui/` theme values. Don't hardcode colors or spacing.
