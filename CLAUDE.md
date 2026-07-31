# do-done

AI-native task management app. Turborepo monorepo with Next.js web, React Native/Expo mobile, and custom MCP server.

## Naming

The user-facing brand name is **DoDone** (closed compound, medial capital) — use it in all UI copy, titles, marketing, and user-facing docs. Never `do-done`, `Do Done`, or `dodone`. The lowercase hyphenated `do-done` is reserved for internal identifiers only: the repo, npm package scope (`@do-done/*`), Expo `slug`, and similar. Deep-link scheme (`dodone`), bundle IDs, event names, and storage keys stay as-is.

## Architecture

```
apps/web       — Next.js 16 (App Router, Tailwind); also hosts the MCP endpoint at /api/mcp
apps/mobile    — React Native / Expo (tabs template)
apps/mcp       — Thin stdio entry point for the MCP server (Claude Code)
packages/shared      — Zod schemas, types, constants, utils (leaf package)
packages/api-client  — Supabase client, TasksApi, ProjectsApi, LocationsApi
packages/ui          — Design tokens (colors, spacing, typography)
packages/task-engine — NLP parser, focus algorithm, scheduler, categorizer
packages/mcp-server  — MCP tools + resources, shared by both transports
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

## MCP server

One server implementation (`packages/mcp-server`), two transports:

- **stdio** — `apps/mcp/dist/index.js`, registered in `~/.claude.json` for Claude Code.
- **Streamable HTTP** — `apps/web/src/app/api/mcp/route.ts`, deployed with the web
  app. Add it in Claude as a **custom connector** pointing at
  `https://<your-app>/api/mcp` with the `MCP_BEARER_TOKEN` as a Bearer token.

The HTTP endpoint is stateless (a fresh server per request, no session store) and
single-user: it authenticates a shared secret and scopes everything to
`DO_DONE_USER_ID`. Making it multi-user means replacing that guard with OAuth 2.1
and deriving `userId` from the validated token — the route is structured for it.
`/api/mcp` is in `PUBLIC_PATHS` in `proxy-helper.ts` so the auth proxy doesn't
307 it to `/login`.

> Hand-editing `claude_desktop_config.json` does **not** work on Claude Desktop
> v1.22209.3 — the app rewrites that file and strips `mcpServers`. Its Chat tab
> sees remote connectors only. Use the hosted endpoint for Chat, and the Claude
> Code tab for the local stdio server.

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

Stories cover the main surfaces: TaskItem, TaskEditModalV2, TaskForm, WeekView, TodayView, SidebarNav, ScheduleButton, the pet panel, and more (~18 `*.stories.tsx` files under `apps/web/src/components/`).

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
pnpm --filter mobile start
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

### Quick-add widget (floats over the home screen)
The 1×1 "Quick Add" widget mimics Todoist's add-task widget: tapping it opens a
quick-add sheet over the live home screen without launching the main app.

- The widget (`widgets/QuickAddWidget.tsx`) taps `dodoneadd://open` — a scheme
  distinct from the app's `dodone` scheme so it resolves *only* to the translucent
  activity (no disambiguation chooser; `react-native-android-widget` can't target
  an activity by component, hence the dedicated scheme).
- `plugins/withQuickAddActivity.js` is a config plugin that, on every `expo prebuild`,
  generates a translucent **`QuickAddActivity`** (`QuickAddActivity.kt`), registers it
  in `AndroidManifest.xml` with `Theme.App.QuickAddTranslucent` + the `dodoneadd`
  intent-filter, and adds that style. The activity runs in its own task
  (`taskAffinity=""`, `launchMode="singleTask"`, `excludeFromRecents`) with
  `windowSoftInputMode="adjustResize"` — without that it defaults to pan, and the
  window slides up *underneath* the composer's own keyboard offset.
- `QuickAddActivity` mounts a **second** registered JS root, `"QuickAdd"` (see
  `index.js`, the custom bundle entry that also imports `expo-router/entry` for the
  main `"main"` root). Both roots share one ReactHost / JS bundle, so the Supabase
  session is shared.
- That root is `quick-add-root.tsx` → renders `components/QuickAddComposer.tsx` (the
  Todoist-style title + When/Priority/Estimate chips, reusing selectors exported from
  `components/TaskEditModalV2.tsx`). It dismisses with `BackHandler.exitApp()`, which
  finishes only the quick-add task and returns to the launcher.
- Two composer rules keep the surface from jumping around, both matching Todoist:
  the card rides the IME via Reanimated's `useAnimatedKeyboard` (frame-synced inset,
  not a post-hoc `keyboardDidShow` measurement), and the chips open their options as
  **inline popovers in the same window** — an Android `Modal` opens a new window and
  drops the keyboard. Only the full month grid takes over the screen, and it hands
  focus back to the input on close.
- Widget artwork is inline SVG via `SvgWidget` (`widgets/dodone-mark.ts`). Do **not**
  use `IconWidget`: it renders the icon name as *text* in a typeface the app has to
  ship itself, so `icon="add"` with no `material.ttf` literally drew "add" on the
  home screen.
- Test the tap flow in a **preview/release** build — `expo-dev-client` intercepts
  launches in debug builds. After changing the widget's size, remove and re-add it
  on the device.

### Geofencing setup
- `apps/mobile/lib/geofencing.ts` defines the background TaskManager task
- `registerUserGeofences()` is called automatically after sign-in. It **never
  prompts** — it reads the user's locations first, bails when there are none,
  and only then checks (without asking) that access was already granted. A user
  with no location-based reminders is never asked for location at all.
- `requestGeofencePermissions()` is the prompting path. Call it from the flow
  where the user sets up a location-based reminder, so the ask has context —
  never on launch or sign-in.
- Requires both foreground AND background location permission (the latter
  shown only AFTER foreground is granted, per Android policy). Since Android 11
  the background grant has no dialog at all: the OS deep-links to the app's
  Location permission settings screen for "Allow all the time".
