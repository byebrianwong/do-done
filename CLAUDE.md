# do-done

AI-native task management app. Turborepo monorepo with Next.js web, React Native/Expo mobile, and custom MCP server.

## Naming

The user-facing brand name is **DoDone** (closed compound, medial capital) — use it in all UI copy, titles, marketing, and user-facing docs. Never `do-done`, `Do Done`, or `dodone`. The lowercase hyphenated `do-done` is reserved for internal identifiers only: the repo, npm package scope (`@do-done/*`), Expo `slug`, and similar. Deep-link scheme (`dodone`), bundle IDs, event names, and storage keys stay as-is.

## Dates: "Scheduled" and "Deadline", never "due"

A task carries two independent date pairs, named the same way from the Postgres
column up through the MCP tool parameters:

| Column | Label | Meaning |
| --- | --- | --- |
| `scheduled_date` / `scheduled_time` | **Scheduled** | The day (and optional time) the user plans to *do* the task. This is what the app schedules by — nearly every dated task has one. |
| `deadline_date` / `deadline_time` | **Deadline** | A hard external cutoff. Rarely set; its absence never means a task is undated. |

**The bare word "due" is banned** from UI copy, tool descriptions, tool output,
labels, comments and identifiers. It is the word an English speaker reaches for
when they mean the *scheduled* day, so every consumer that saw `due_date` — MCP
clients most of all — read the rarely-set deadline as the schedule and reported a
fully planned week as empty. The names now carry the meaning unaided, so nothing
has to be disambiguated in prose. `overdue` is a different word and stays.

These were `when_date` / `when_time` / `due_date` / `due_time` until
`supabase/migrations/20260804000001_rename_task_date_fields.sql`. That migration
also recreates both calendar functions, since a plpgsql body is stored as text
and does *not* follow a column rename. Display configs persisted under the old
`sort`/`filter` field names are remapped on read by `parseDisplayConfig` in
`packages/shared/src/display.ts` — they live in localStorage and AsyncStorage as
well as the DB, so SQL alone could not have reached them.

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
  app. Added in Claude as a **custom connector** pointing at
  `https://<your-app>/api/mcp`.

The HTTP endpoint is stateless: a fresh `createDoDoneServer()` per request, bound
to the authenticated user. That per-request construction is required, not an
optimisation — the tool registrars capture their user id at construction time.

Anything on this surface that touches dates has to say **which** date it means:
DoDone schedules on `scheduled_date` and almost never sets `deadline_date`, so a client
that equates "dated" with "has a deadline" reports a full week as empty. Tools
answer date questions via `get_agenda`, emit every date with its relative
reading, and resolve "today" through the user's timezone rather than the
process clock (UTC when hosted). See `packages/mcp-server/CLAUDE.md` → Dates.

### OAuth

Claude's custom-connector UI speaks **OAuth only** — its form takes a URL and an
optional OAuth client id/secret, with nowhere to put a static token. So the web
app is also an OAuth 2.1 authorization server:

```
/.well-known/oauth-protected-resource[/api/mcp]  RFC 9728 — discovery entry point
/.well-known/oauth-authorization-server          RFC 8414 — endpoint directory
/api/oauth/register                              RFC 7591 — dynamic client registration
/oauth/authorize                                 consent screen (needs a session)
/api/oauth/authorize                             records the consent decision
/api/oauth/token                                 code + refresh grants
/api/oauth/revoke                                RFC 7009
```

Implementation lives in `apps/web/src/lib/oauth/` (`crypto.ts`, `store.ts`,
`config.ts`); state is in the `oauth_*` tables, which are RLS-locked with no
policies (service role only). Load-bearing rules:

- **PKCE S256 is mandatory** — clients are public, so this is what secures the
  code grant. "plain" is rejected.
- **Codes and tokens are stored only as SHA-256 hashes**, and are single-use:
  redemption and refresh rotation are atomic conditional UPDATEs, not
  read-then-write.
- **Redirect URIs match exactly**, with the RFC 8252 loopback-port exception for
  native clients. No prefix matching, ever.
- **A bad `client_id`/`redirect_uri` renders an error, never a redirect** —
  redirecting on an unvalidated URI is how an AS becomes an open redirector.
- `MCP_BEARER_TOKEN` remains an **optional** static fallback (scoped to
  `DO_DONE_USER_ID`) for Claude Code's `--header` flag. Unset it to require OAuth.

`APP_URL` pins the OAuth issuer; it must be the URL clients actually reach. The
OAuth paths and `/api/mcp` are in `PUBLIC_PATHS` in `proxy-helper.ts` so the auth
proxy doesn't 307 them to `/login` (`/oauth/authorize` handles its own session
check so it can round-trip through `/login?next=…`).

> Hand-editing `claude_desktop_config.json` does **not** work on Claude Desktop
> v1.22209.3 — the app rewrites that file and strips `mcpServers`. Its Chat tab
> sees remote connectors only. Use the hosted endpoint for Chat, and the Claude
> Code tab for the local stdio server.

## Linking to a task (web)

Every task has an address, and the editor keeps the address bar honest:

| URL | What it is |
| --- | --- |
| `/task/<id>` | Canonical, context-free. What every "Copy link" hands out, and what a recipient opens: a standalone page. |
| `/inbox?task=<id>` | The editor, mirrored onto the view it was opened from. Written while the modal is up, so the address bar is always shareable and Back closes the modal. |

`OpenTaskProvider` (`apps/web/src/lib/open-task.tsx`) owns *the* editor for the
whole authenticated app — mounted once in `(app)/layout.tsx`, not per row. That
placement is load-bearing twice over: a link can open a task with no row on
screen, and a task showing in two lists still opens exactly once.

It writes the URL with the **native History API**, not `router.push`. A router
navigation would re-run the underlying list's server components on every row
click and change nothing — the list is already rendered, the editor is a layer
above it. `popstate` is what keeps state and URL in agreement.

`TaskItem` falls back to its own local modal state when the provider is absent
(Storybook, unit tests), which is why `useOpenTask()` returns null rather than
throwing.

The auth proxy carries the destination through sign-in (`?next=`), so a task
link handed to someone signed out survives the login round-trip; `safeNext` on
the login page is what stops that being an open redirector.

## Attachments

A task can carry files. Two halves that have to stay in agreement:

| Where | What |
| --- | --- |
| `task_attachments` | The metadata row — name, mime type, size. Cascades with the task. |
| `task-attachments` Storage bucket | The bytes, at `{user_id}/{task_id}/{uuid}.{ext}`. |

**The leading `user_id` segment is load-bearing.** Storage RLS can only see an
object's path — it cannot join back to `tasks` — so the owner has to be *in*
the key. `attachmentStoragePath()` in `packages/shared/src/attachments.ts` is
the only thing that builds one. The bucket is private; every read is a
short-lived signed URL from `AttachmentsApi.signedUrls()`.

**Write order is deliberate, both ways.** Upload puts the bytes down before the
row and deletes the object again if the insert fails; remove deletes the bytes
before the row. A row pointing at absent bytes renders as a permanently broken
attachment, whereas bytes with no row are merely invisible — so the failure
mode always lands on the invisible side.

**`TasksApi.delete()` clears the bucket first**, across the task's whole
subtree. The `task_attachments` FK cascades, but a cascade only reaches the
metadata: a Storage object has no foreign key to follow, so without this the
bytes would sit there forever with nothing in the app pointing at them. The
subtree walk is bounded by the depth-2 trigger, and short-circuits to a single
query for a task with no children.

**Rendering is classified once, in `attachmentKind()`** — by extension first,
MIME type second. A `.md` file arrives as `text/plain` from a browser, as
`application/octet-stream` from Android's document picker, and sometimes with
an empty type from a drag-and-drop; the extension is the only signal that
survives all three. SVG is deliberately *not* an inline image: it can carry a
`<script>`, and inlining one would run it in the app's own origin.

Markdown renders on both surfaces but through different machinery, because
React Native has no DOM:

- **web** — `react-markdown` + `remark-gfm`, with `MARKDOWN_COMPONENTS` mapping
  its elements onto the modal's type scale (there's no `@tailwindcss/typography`
  here). `rehype-raw` is deliberately absent: attachment content is untrusted,
  so raw HTML in an uploaded file must stay inert text.
- **mobile** — `parseMarkdown()` from `@do-done/shared` returns a typed block
  tree that `MarkdownView.tsx` draws with `<Text>`/`<View>`. Keeping the parse
  in the shared package is also what makes it testable: `apps/mobile` has no
  renderer in CI.

Mobile uses two pickers because the platforms split them — `expo-image-picker`
for the library and `expo-document-picker` for files — and reads bytes with
`expo-file-system`'s `File(uri).bytes()` (Hermes has no `atob`, and base64
would inflate a 10 MB file by a third in memory). **All three are new native
modules, so mobile attachments need a fresh `eas build`; they will not arrive
over OTA.**

## Design System

- Accent: indigo-500 (#6366f1)
- Font: Inter
- Spacing: 4px grid
- Aesthetic: Things 3 cleanliness + Linear speed
- Tokens in `packages/ui/src/theme.ts`

## Testing

Vitest everywhere (`pnpm test` → `turbo run test`). Web component tests run in
jsdom from `apps/web/vitest.config.ts`; the packages run plain node tests.

**Keep every workspace package on one vitest version.** `@testing-library/jest-dom`
is a direct dependent of no package here, so its `/vitest` entry resolves
`vitest` through its own path in the pnpm store and calls `expect.extend()` on
whatever copy it lands on. When `apps/web` was on 4.x and `packages/*` on 3.x it
extended the copy no test ran against, and all 26 `toBeInTheDocument()`
assertions failed with `Invalid Chai property`. Same-version-but-two-physical-
copies does it too, so `@types/node` is pinned to `^20.19.39` across **every**
workspace package, `apps/mobile` included, to stop pnpm peer-splitting the
install.

To check: `ls node_modules/.pnpm | grep '^vitest@'` should print exactly one
line after `pnpm install --frozen-lockfile` (a dirty `node_modules` keeps stale
directories around and will show more). `grep '^@types+node@'` should print one
line too.

**`apps/mobile` tests logic only — there is no renderer.** `vitest.config.ts`
there runs `lib/**/*.test.ts` in a node environment and nothing else. Anything
that draws needs a device or a simulator, and neither exists in CI; a jsdom shim
would only prove things about a React Native that isn't the one that ships. What
the suite is for is the sequencing the eye can't check on a device anyway —
`toggleComplete`'s completion hold, for instance, where the write must go out
before the row leaves and the invalidate must not land during the animation.
Modules that reach for native code (`./supabase`, `./widgets`,
`./query-client`, `./location-queries`) are `vi.mock`ed per test file, so each
test names the seam it stands in for rather than relying on a global setup.

**`react` is pinned the same way, for the same reason.** A package that ships a
hook (`packages/api-client`, whose `useAutoSaveTask` the task editors share)
needs `react` only as a devDependency, but pnpm resolves that copy separately —
and then anything with a `react` peer that the package pulls in (`use-debounce`)
resolves against *it*, not the app's. Render such a hook in a jsdom test and it
runs against a second React whose dispatcher is null:
`Cannot read properties of null (reading 'useRef')`. `packages/api-client` is
therefore pinned to the exact version `apps/web` uses (`19.2.4`, no caret), and
`apps/web/vitest.config.ts` sets `resolve.dedupe: ["react", "react-dom"]` as a
backstop. `apps/mobile` stays on Expo's `19.1.0` — no vitest, nothing to split.

The pre-existing workaround for the old breakage is the `vi.mock` of
`./task-edit-modal-v2` in `task-item.test.tsx` and `draggable-upcoming.test.tsx`;
those isolate the modal for speed too, so they were left alone.

Note `pnpm test -- --force` passes `--force` to vitest, not turbo. To bypass the
turbo cache, call it directly: `./node_modules/.bin/turbo run test --force`.

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
  Todoist-style title + tag/chip card). It dismisses with `BackHandler.exitApp()`,
  which finishes only the quick-add task and returns to the launcher.
- The When / Priority / Project / Estimate chips themselves live in
  `components/QuickAddFields.tsx` (`useQuickAddFields` + `QuickAddChipRow` +
  `QuickAddPickers`), reusing selectors exported from `components/TaskEditModalV2.tsx`.
  Every mobile capture surface shares them: this widget composer, the in-app
  `dodone://quick-add` modal, and `QuickAddBar` above the tab bar (which expands from
  one line to the full chip card on focus, matching the web bar). Nothing in that
  module may call a TanStack Query hook — the widget root has no QueryClientProvider,
  so hosts that have one pass `projects` in and the widget's Project chip hides.
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
- **None of this has been confirmed on a device yet** — see
  [`docs/android-widget-verification.md`](docs/android-widget-verification.md) for
  the checklist it still needs, the `ImageWidget` fallback if `SvgWidget` turns out
  not to render, and the build gotchas (stale checkouts, APK signing, launcher
  caching) that have already burned three install cycles.

### Location reminders (geofencing)
A task can carry reminders at saved places — "buy milk when I get to Tesco",
"post the letter when I leave the office". `task_locations` links a task to a
location with a `trigger_type` of `enter` or `exit`; a task can have several.

**Surfaces**
- `components/LocationReminderSheet.tsx` — the 📍 row in the task editor.
  Toggles Arriving/Leaving per place, and creates places from the current
  position or a geocoded address. **This is the only place in the app that
  prompts for location**, and it primes with an explanation first.
- `app/locations.tsx` (Settings → Saved places) — rename, re-radius, delete.
- `lib/location-queries.ts` — query hooks + mutations. Every write ends in a
  geofence sync; the OS holds its own copy of the regions.

**Engine** (`lib/geofencing.ts`)
- `registerUserGeofences()` **never prompts**. It registers only locations with
  at least one *open* task, so finished work stops waking the device, and a
  user with no location reminders is never asked for location at all.
- `requestGeofencePermissions()` is the prompting path — foreground, then
  background, then notifications (Android 13+ needs POST_NOTIFICATIONS, and a
  location reminder that can't notify does nothing at all).
- Requires both foreground AND background location (the latter shown only
  AFTER foreground is granted, per Android policy). Since Android 11 the
  background grant has no dialog: the OS deep-links to the app's Location
  permission settings screen for "Allow all the time".

**Why it isn't just "notify on enter"** — three rules, tuned in
`packages/shared/src/constants.ts`:
- **Dwell.** An enter fires the moment you clip the boundary, so driving past
  the shop would fire the reminder. Notifications are scheduled
  `GEOFENCE_DWELL_SECONDS` out and cancelled if the opposite transition lands
  first. This is why regions register with `notifyOnEnter` *and*
  `notifyOnExit` even when only one direction has tasks — without the opposite
  event there's nothing to cancel on.
- **Cooldown.** Position drift makes regions flap. Once a task fires for a
  place it stays quiet for `GEOFENCE_COOLDOWN_MINUTES`.
- **Region cap.** iOS silently stops monitoring past 20 regions
  (`GEOFENCE_MAX_REGIONS`), so we trim by open-task count and mark the rest
  "Paused" on the places screen rather than letting them fail invisibly.

Radius presets start at 100 m (`LOCATION_RADIUS_PRESETS`) because a typical
urban fix lands 20-60 m off; tighter regions miss arrivals and emit spurious
exits while you sit still. Default is 200 m.

Dwell/cooldown state lives in AsyncStorage, not module state — the background
task runs in a fresh JS context after the OS kills the app.

> **None of this has run on a device yet.** Geofences, the dwell filter, the
> notification channel and all three permission prompts are unverified outside
> a type-checker — none of them execute in Expo Go or CI. See "Where things
> stand" in [`docs/HANDOFF.md`](docs/HANDOFF.md) for the order to check things
> in; each failure mode here is silent.

## Password-manager autofill

Login fields on **both** surfaces carry explicit autofill metadata — without it
the OS can't classify them and 1Password never offers to fill:

- Mobile (`apps/mobile/app/(auth)/login.tsx`): `autoComplete` (→ Android
  `autofillHints`) + `textContentType` (→ iOS AutoFill) + `importantForAutofill`.
- Web (`apps/web/src/app/(auth)/login/page.tsx`): `name` + `autocomplete`.

Both flip the password field between `current-password` and `new-password`
based on signin/signup mode, so managers offer generation instead of a fill.

**App ↔ site association** is a separate mechanism — it's what makes a saved
`dodone.byebrianwong.com` login match the *app*, rather than the app being its
own vault item. It needs all three of:

1. `ios.associatedDomains: ["webcredentials:dodone.byebrianwong.com"]` in
   `apps/mobile/app.config.ts` (already set; EAS syncs the capability at build).
2. `APPLE_APP_ID` (`<TeamID>.com.beamer408.dodone`) in the web deployment →
   served at `/.well-known/apple-app-site-association`.
3. `ANDROID_CERT_FINGERPRINTS` (comma-separated SHA-256, usually the EAS upload
   key *and* the Play app-signing key) → served at `/.well-known/assetlinks.json`.

Both routes 404 when their env var is unset — a malformed association file is
worse than a missing one, since Apple and Google cache them. `/.well-known` is
in `PUBLIC_PATHS` in `proxy-helper.ts`; Apple's spec forbids a redirect there.

**Neither env var is set yet**, and the iOS entitlement needs a fresh
`eas build` to take effect. Checklist with commands and verification steps:
[`docs/autofill-setup.md`](docs/autofill-setup.md).

> Test autofill in a **preview/release** build, and make sure 1Password is
> selected under Android Settings → Passwords & accounts → Autofill service.
