# do-done

AI-native task management app. Turborepo monorepo with Next.js web, React Native/Expo mobile, and custom MCP server.

## Architecture

```
apps/web       — Next.js 15 (App Router, Tailwind)
apps/mobile    — React Native / Expo (tabs template)
apps/mcp       — MCP server for Claude Code integration
packages/shared      — Zod schemas, types, constants, utils (leaf package)
packages/api-client  — Supabase client, TasksApi, ProjectsApi, LocationsApi
packages/ui          — Design tokens (colors, spacing, typography)
packages/task-engine — NLP parser, focus algorithm, scheduler, categorizer
supabase/            — SQL migrations, RLS policies, edge functions
```

## Commands

```bash
pnpm install              # Install all deps
pnpm build                # Build all packages
pnpm dev                  # Start all dev servers
pnpm typecheck            # Type-check all packages
pnpm --filter web dev     # Start web app only
pnpm --filter mobile dev  # Start mobile app only
pnpm --filter @do-done/mcp build  # Build MCP server
```

## Code Style

- Strict TypeScript everywhere. No `any`.
- Use Zod schemas from `@do-done/shared` for all validation
- ES modules (`"type": "module"`) with `.js` extension in imports
- Functional React components with named exports
- Data access only through `@do-done/api-client`, never raw Supabase queries in apps
- All Supabase queries check `.error` — never assume success

## Database

Supabase PostgreSQL with RLS. Migrations in `supabase/migrations/`.
Key tables: tasks, projects, locations, task_locations, calendar_sync, user_preferences.
All tables use UUID PKs and `user_id` for RLS.

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:
- SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
- NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
- POWERSYNC_URL
- GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
- DO_DONE_USER_ID (for MCP server)

## Design System

- Accent: indigo-500 (#6366f1)
- Font: Inter
- Spacing: 4px grid
- Aesthetic: Things 3 cleanliness + Linear speed
- Tokens in `packages/ui/src/theme.ts`
