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
pnpm --filter mobile start  # Start Expo dev server (then `a`=android, `i`=ios)
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

## Storybook + Chromatic

Storybook lives in `apps/web/`. It loads `*.stories.tsx` files alongside components and uses `@storybook/nextjs-vite` for fast Vite-based builds with Next.js compatibility.

```bash
pnpm --filter web storybook        # dev server on :6006
pnpm --filter web build-storybook  # static build to storybook-static/
pnpm --filter web chromatic        # publish to Chromatic
```

Stories cover: TaskItem, TaskEditDialog, TaskForm, WeekView, SidebarNav, ScheduleButton.

**Chromatic** publishes Storybook on every push/PR and detects visual regressions:

1. Sign up at https://www.chromatic.com → connect this repo → grab the project token
2. In GitHub repo settings: **Settings → Secrets → Actions → New secret** named `CHROMATIC_PROJECT_TOKEN`
3. The `.github/workflows/chromatic.yml` workflow runs on every push/PR
4. Visual diffs appear as a PR check; approve or reject changes in the Chromatic UI

For local runs, set `CHROMATIC_PROJECT_TOKEN` in your shell and run `pnpm --filter web chromatic`.

## Mobile native builds (EAS)

The mobile app uses native modules (Android home-screen widget, geofencing, voice input) that don't run in Expo Go. To test those, build a custom dev client APK once:

```bash
# One-time: install EAS CLI globally
npm i -g eas-cli

# One-time: log in
eas login

# One-time: link project (creates EAS project on Expo servers and writes
# the projectId back into app.config.ts → extra.eas.projectId)
cd apps/mobile && eas init

# Build the dev client APK (cloud build, ~10-15 min, free tier OK)
eas build --profile development --platform android

# Install the APK on your Android device, then start metro:
pnpm --filter mobile dev
# Open the dev client app, scan the QR code → app loads with native modules
```

Build profiles in `apps/mobile/eas.json`:
- `development` — APK with dev client + debugging tools
- `preview` — APK for internal testing (no dev client)
- `production` — AAB for Play Store

After the dev client is installed, you can iterate on native code without rebuilding — only adding new native modules requires a fresh build.

### Android widget setup
- Widgets are declared in `apps/mobile/app.config.ts` under the `react-native-android-widget` plugin
- Widget JSX components live in `apps/mobile/widgets/`
- Background handler `widget-task-handler.ts` is registered at app launch
- Widgets use AsyncStorage (shared with main app) to read the Supabase session

### Geofencing setup
- `apps/mobile/lib/geofencing.ts` defines the background TaskManager task
- `registerUserGeofences()` is called automatically after sign-in
- Requires both foreground AND background location permission (the latter
  shown only AFTER foreground is granted, per Android policy)
