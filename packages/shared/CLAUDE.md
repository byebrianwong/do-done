# @do-done/shared

Leaf package — never imports from other workspace packages.

## Key Files
- `src/schemas.ts` — Zod schemas for all entities (Task, Project, Location, etc.) and input types
- `src/constants.ts` — Priority config, status config, focus scores, project colors
- `src/utils.ts` — Pure functions: isOverdue, isDueToday, sortByPriority, formatDuration

## Rules
- Every entity schema change here affects ALL consumers (api-client, task-engine, mcp, web, mobile)
- Always export types alongside Zod schemas using `z.infer<>`
- Keep functions pure — no side effects, no external deps beyond Zod
- Use `.js` extension in all imports (ES modules)
