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

## Writing style

Applies to code comments, commit messages, PR bodies, and docs.

- State the rule or conclusion first, then the reason.
- One idea per sentence. Short sentences, active voice.
- Use concrete words. No metaphor in place of an explanation.
- Keep the reasoning and the caveats. Say when something is untested or a
  trade-off. Plain does not mean leaving things out.

Commit subjects say what changed, not what it means. Write
`fix(mobile): finish the swipe-return animation before completing the task`,
not `the row springs home before it is ticked off`. Bodies stay as detailed as
they are — they carry the reasoning.

**Do not match the surrounding style if it is more elaborate than this.** The
comments next to your edit pull harder than this file does, and copying them is
how the repo drifted the first time. Worked before/after pairs are in
[`CLAUDE.md`](CLAUDE.md) under *Writing style* — read them if you are unsure
what the difference looks like in practice.
