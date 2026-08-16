# @do-done/shared

Leaf package — never imports from other workspace packages.

## Key Files
- `src/schemas.ts` — Zod schemas for all entities (Task, Project, Location, etc.) and input types
- `src/constants.ts` — Priority config, status config, focus scores, project colors
- `src/utils.ts` — Pure functions: isOverdue, isDeadlineToday, sortByPriority, formatDuration
- `src/locations.ts` — `TaskLocationLink` (a link with its place joined on), the
  trigger labels, and the phrasing both apps use for a place reminder
- `src/place-search.ts` — Photon type-ahead place search. Plain `fetch`, no
  platform imports, so web and mobile share one search
- `src/map-tiles.ts` — Web-Mercator arithmetic for the raster map preview both
  apps draw. Pass the *shorter* side to `zoomForRadius`, or the region circle
  runs off a letterboxed frame

## Rules
- Every entity schema change here affects ALL consumers (api-client, task-engine, mcp, web, mobile)
- Always export types alongside Zod schemas using `z.infer<>`
- Keep functions pure — no side effects, no external deps beyond Zod
- Use `.js` extension in all imports (ES modules)
