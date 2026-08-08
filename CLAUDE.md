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

**The quick-add parser is the one place that word is heard rather than
spoken.** `parseTaskInput` sends every date chrono finds to `scheduled_date`
— "buy milk tomorrow", "ship it friday 9am" — and produces a `deadline_date`
only when "due" or "deadline" introduces the date ("submit report due friday").
That's the same ratio argument as above, applied to input: reading "tomorrow"
as a deadline left the task unscheduled and out of every day-based view.
Deliberately narrow — "by friday" is a schedule, because it is also how people
say the day they'll get to something. `DEADLINE_MARKER_PATTERN` in
`packages/task-engine/src/parser.ts` is the rule. Copy that teaches the keyword
(the landing page's "'due friday' — a hard deadline instead") is the sanctioned
exception to the ban: it is quoting an input token, not naming a field.

These were `when_date` / `when_time` / `due_date` / `due_time` until
`supabase/migrations/20260804000001_rename_task_date_fields.sql`. That migration
also recreates both calendar functions, since a plpgsql body is stored as text
and does *not* follow a column rename. Display configs persisted under the old
`sort`/`filter` field names are remapped on read by `parseDisplayConfig` in
`packages/shared/src/display.ts` — they live in localStorage and AsyncStorage as
well as the DB, so SQL alone could not have reached them.

## Status ↔ schedule auto-sync

An opt-in rule (two independent halves, both off by default) that keeps a
task's status and its `scheduled_date` from drifting apart. Settings live on
`user_preferences` (`status_sync_*`); the rules are pure functions in
`packages/shared/src/status-sync.ts`.

- **promote** — a task scheduled on or before the *horizon* moves up to
  `status_sync_status`. Never moves a task backwards, so `in_progress`, `done`
  and `cancelled` are untouched. Overdue counts as inside the horizon.
- **backfill** — a task set to `status_sync_status` *or past it* gets its
  `scheduled_date` set to the horizon, when it had none or had one further out.

The horizon is stored in both representations at once — `_horizon_days` and
`_horizon_key` — with `_horizon_kind` selecting the live one, so switching
modes in the settings UI remembers the other and neither column is ever null.

**Both halves are applied in `TasksApi.create`/`update`**, not in the apps —
that's the one door web, mobile and MCP all write through, and it folds the
rule into the *same* UPDATE rather than chasing it with a second write. The
settings are read once per instance and cached for a minute
(`invalidateStatusSyncCache()` after saving them).

The promote half also has to fire when *no write happens* — a task whose
scheduled day simply arrived. `TasksApi.syncScheduledToStatus()` is that sweep:
one filtered UPDATE, idempotent, a no-op when the feature is off. It's driven
from `StatusSyncRunner` (web app layout), `startStatusSyncSweeps()` (mobile
`_layout`, on resume), and ahead of the MCP read tools.

Two precedence rules that look arbitrary but aren't: an explicit
`scheduled_date` in the same write always beats backfill, and an explicit
`status` does **not** exempt a row from promote. Demoting a near-scheduled task
snaps straight back, which reads as the rule enforcing itself — letting the
write through would only defer it to the next sweep, minutes later and with no
visible cause.

"Today" is resolved through `user_preferences.timezone`, never the process
clock — see the timezone note under Dates above.

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

## The public front (web)

Two routes are reachable without a session, and they're listed in
`PUBLIC_PATHS` in `proxy-helper.ts` — `/` by an **exact** match, since every
other entry there is a `startsWith` test and `"/"` prefixes everything.

| URL | What it is |
| --- | --- |
| `/` | The landing page. Marketing plus the sign-in form; a signed-in visitor gets "Open DoDone" instead. It used to `redirect("/inbox")`, which meant the app's front door was a bare login form. |
| `/demo` | The whole app, running against an in-memory sandbox. |

### The demo sandbox

`tasks.user_id` is a foreign key onto `auth.users`, so anything DB-backed needs
a real user per visitor: either one shared login that any passer-by can wreck
for everyone, or anonymous sign-ins — disabled on the project, and a row per
drive-by crawler. The sandbox has neither problem, needs no env vars, and works
on every preview deploy. It also gives **Claude a way to drive the real UI**,
which the login wall previously made impossible.

- **`lib/demo/mode.ts`** decides demo-ness **from the URL**, not a cookie or a
  context. `getClientTasksApi()` is called from deep inside components that
  know nothing about where they're mounted; the path is the one thing always
  available to them.
- **`lib/demo/api.ts`** holds structural doubles of `TasksApi` / `ProjectsApi` /
  `UserPrefsApi` over a plain array. They are *not* a fake `SupabaseClient`:
  faking the client would mean reimplementing PostgREST — `.or()` filter
  grammar and all — to arrive back at the same array operations. They reach
  callers through a cast, so nothing type-checks them at the call sites;
  `api.test.ts` sweeps both prototypes instead, and a method missing there is a
  runtime `undefined is not a function` that only ever fires in the demo.
- **The seam is `tasks-client.ts` / `projects-client.ts` / `user-prefs-client.ts`.**
  Every web mutation already went through those, so swapping the object out is
  all it takes — not one component knows it might be in a demo. Three
  components used to build `new TasksApi(createClientSupabase(), …)` inline and
  now go through `getTasksApiFor(userId)` / `getProjectsApiFor(userId)`; a
  fourth doing that again would silently bypass the demo.
- **`lib/demo/store.ts`** is the database: one immutable object, mirrored into
  **sessionStorage** (per tab, so a link handed to a room full of people gives
  each of them their own copy) and re-seeded when its `seededFor` day goes
  stale. Replacing the whole object on every write is what stands in for the
  `router.refresh()` the real app leans on — a refresh here re-runs a server
  component with nothing to say.
- **Demo screens render nothing until `useDemoData().ready`.** The seed is
  dated from the reader's calendar day and the server's day is UTC, so anything
  date-shaped rendered server-side is a hydration mismatch waiting to happen.
- `SidebarNav`, `SortableProjectList` and `taskPath()` prefix their links with
  `/demo` when they're inside it. Derived from `usePathname()` rather than
  passed down — a bare `/today` would bounce the visitor to the login wall the
  demo exists to get around. Settings is dropped from the demo nav (there is no
  account behind it), and `AppShell` takes `userEmail={null}`, which is what
  suppresses the Pip panel — Pip reads its state from the database.

## `#` in a title: project first, tag otherwise

A `#token` is classified against the user's own project list, Todoist-style:
`#groceries` files the task into **Groceries** when that project exists, and is
a tag when it doesn't. Precedence inside a token is fixed —
`#xs`…`#xxl` (estimate) → `#p1`…`#p4` (priority) → project → tag — so a project
named "M" loses to the size code rather than shadowing it.

Two pieces do the work and **must agree**, since the same text is read by both:
`parseTaskInput` (`packages/task-engine`) parses a whole quick-add string at
submit, and `extractTitleShortcuts` (`packages/shared`) is the live absorber the
title fields run on every keystroke. Both take the project list as an *optional*
argument and both delegate the match to `matchProject` in
`packages/shared/src/project-match.ts`. Omit the list — Storybook, the mobile
widget root, any surface with no projects to hand — and every token is a tag,
exactly as before.

- **Matching is on a normalised key** (lowercase, alphanumerics only). A token
  is `\w+`, so it can never carry a space; without normalising both sides,
  every multi-word project would be unreachable by typing. `#sideproject` and
  `#side_project` both reach "Side Project". A name that normalises to nothing
  (emoji-only) matches nothing rather than matching everything.
- **The surfaces differ in where the match lands, and each is internally
  consistent.** Mobile's absorber fills the Project *chip*, the same way it
  already fills Priority and Estimate. Web has no absorber in quick-add, so the
  match shows in `ParsedPreview` — an honest echo that updates as the text
  changes — and the chip stays the explicit override, exactly as typed `p1` has
  always behaved there.
- **A typed project beats the section's**, on the same rule as priority: adding
  inside "Work" and typing `#home` means Home. An explicit chip still wins over
  both.
- **The parse needs a project list, so it reads `QuickAddProvider`** on web
  (`useQuickAdd` → `useQuickAddContext`), not a prop — which is why a project
  created inline from the quick-add modal is registered with the provider too,
  or it couldn't be typed by name until the next page load.

`/name` resolves against the same list; unmatched, it stays the bare name it
always was (`parsed.project`), and only `parsed.project_id` ever reaches a task.

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

## Click feedback (web)

**Every route under `(app)` needs a `loading.tsx`, and it is not optional
polish.** These routes are all dynamic server components — auth comes from
cookies, the rows from Supabase — so without a fallback Next.js skips
prefetching them *and* blocks the entire client-side transition until the server
render lands. Clicking a sidebar item changed nothing on screen for a second or
two: not the rows, not even the active pill, because `usePathname()` only
updates once the navigation commits. There was no mechanism producing feedback
at all. The fallback is what lets the transition commit on the click; it also
enables partial prefetching, so most navigations then land instantly.

Feedback is three layers, and each covers what the one before it can't:

1. **`active:` styling** on every sidebar row (`PRESS` in `sidebar-nav.tsx`) —
   CSS-only, fires on pointer-down, before React or the network. Note the
   explicit short duration: Tailwind's default 150ms is tuned for hover and
   reads as lag on a press. Project rows get the background but **not** the
   scale — they're also dnd-kit drag handles, and an inline `transform` can't
   share the property with a utility class.
2. **The active pill moving**, the moment the transition commits — which the
   `loading.tsx` files are what make immediate.
3. **`NavPendingDot`** (`useLinkStatus`) — only for when the shell hasn't
   prefetched and the click really is waiting on the network.

Both 1 and 3, and the skeletons themselves, start invisible and fade in on a
~140ms delay (`.dd-skeleton`, `.dd-link-pending` in `globals.css`): a navigation
faster than that shows no placeholder at all, rather than a flash. The skeletons
carry the **real page title in the real type** and the geometry of a real task
row, so the destination is readable on the first frame and the swap is a fill-in
rather than a jump — which is also why `PageSkeleton` takes `maxWidth`
(`/calendar` is `max-w-7xl`, everything else `max-w-3xl`).

One CSS trap, already paid for: **don't drive the pending dot with a fade-in
animation plus a pulse animation.** Two animations on `opacity` means the later
one wins outright, and a pulse whose `0%`/`100%` frames are implicit resolves
them to the *underlying* opacity — 0 here. The dot pulsed between invisible and
almost invisible. It is one keyframe set whose first quarter is the fade-in.

`app-shell.test.tsx` mocks `next/link`, so that mock has to export
`useLinkStatus` or every test in the file dies on the nav rows.

## Cold start (mobile)

**"Nothing scheduled today" is an answer, and the app must not give it before it
has one.** The mobile query cache is in memory, so every launch began with
`data === undefined` on every list, and every screen rendered its empty state
into that gap — the app opened by telling the user their day was clear, then
quietly filled in. Web never had this: its pages are async server components, so
the rows arrive with the HTML.

Three pieces, all under `apps/mobile`:

- **`lib/query-persist.ts`** writes the query cache to AsyncStorage, restored by
  `PersistQueryClientProvider` in `app/_layout.tsx`. Launch opens on the rows the
  user last saw, refreshed underneath. A snapshot older than `CACHE_MAX_AGE_MS`
  (24h) is dropped rather than shown; `gcTime` in `query-client.ts` is the same
  24h **and has to stay in step**, or a restored list for a tab the user hasn't
  opened is collected before it is ever observed and the next write-out persists
  the cache without it.
- **`lib/list-load-state.ts`** decides skeleton vs. empty vs. error, once, for
  every list screen. `hasData` is `data !== undefined`, **not** `length > 0`: a
  restored empty list is a real answer and gets the empty state, while a cache
  that has never held one gets the skeleton. It stays a plain function over a
  plain input because `apps/mobile` has no renderer to test a hook with.
- **`components/ListPlaceholder.tsx`** draws it: `ListSkeleton`, an
  `UpdatingBar` that self-delays ~350ms (`useRefreshOnFocus` refires every query
  on every tab switch, so a bar bound straight to `isFetching` strobes), and
  `ListError` — without which an offline first launch pulses a skeleton forever.

The cache is restored **only for the account that wrote it**, and that check
lives *inside* `restoreClient`, not in the auth listener. Restore and the auth
event resolve independently, so clearing after the fact is a race the previous
user's rows can win.

## The task editor sheet (mobile)

**Everything under the finger runs on the UI thread.** The sheet's rise, its
drag and the backdrop's dimming are one Reanimated shared value — `translateY`,
in pixels below the sheet's resting place — written by worklet gesture handlers
and read by two `useAnimatedStyle`s. Nothing about the motion crosses into JS
until the sheet is off-screen and there is a close callback to fire.

It was a plain `Animated.Value` on `useNativeDriver: false` with a
`runOnJS(true)` pan, which put every frame of both on the JS thread — the same
thread the editor mounts on. Opening a task fires three requests, lays out a
month grid, and used to mount six nested `Modal`s, all inside the 280ms the open
animation had to run in. The animation lost, every time.

- `lib/sheet-motion.ts` holds the policy as pure worklets, tested in node like
  the rest of `lib/`: when a release dismisses (a *projected* rest position, so
  a short fast flick counts and a flick back up never does), how long the
  closing sweep takes (velocity-matched, so a flicked sheet doesn't decelerate
  the instant the finger leaves), and the backdrop's opacity for a position.
  The `'worklet'` directives are what let those ship to the UI thread;
  `babel-preset-expo` adds `react-native-worklets/plugin` on its own, and under
  vitest the directive is an inert string.
- **`SHEET_HEIGHT_RATIO` and `styles.ghRoot.height` have to stay in step.** The
  slide is measured against the ratio, so a sheet taller than its travel never
  fully leaves the screen.
- **The height a worklet reads is a `SharedValue`, not a ref.** Reanimated
  copies captured values into the UI runtime, so `ref.current` read from the
  memoised gesture is whatever it was on the first render, forever.
- **The backdrop is derived from the sheet, never animated alongside it.** It
  was a flat `rgba(17,24,39,0.4)` under `animationType="none"` — the room went
  dark in a single frame with the sheet still off the bottom of the screen, and
  came back only after it had finished leaving. Deriving it is also what makes
  it follow a *drag*: half dismissed is half lit. The style's colour is opaque
  now; putting the alpha back would multiply the two.
- **The body owns the drag until it has nothing left to scroll.**
  `activeOffsetY(12)` claims downward drags, which is also how you scroll a list
  back up, so the pan samples the ScrollView's offset in `onBegin` and stands
  down unless it was already at the top. Without that the editor lurched toward
  the floor instead of scrolling.

Two render-cost rules, both downstream of the fact that **the editor re-renders
on every keystroke in the title** — autosave holds the task in React state:

- `ScheduleCalendar` and `SubtasksSection` are `React.memo`ed and their props
  kept stable for it. `SubtasksSection` takes `parentId`/`parentDepth` rather
  than the parent `Task` for exactly this reason: a `Task` prop is a new object
  on every keystroke and would defeat the memo on the renders it exists to skip.
- Nested pickers are mounted only while they are up. Six of them lived
  permanently inside every open editor, each rebuilding its option rows per
  keystroke and holding a host view it never showed.

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
there runs `lib/`, `widgets/` and `plugins/` tests in a node environment and
nothing else — query-cache logic, the widget task handler's decisions, and the
XML a config plugin emits, none of which need pixels. Anything
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
- **`widget-task-handler.ts` is registered from `index.js`, the bundle entry, and
  nowhere else.** `registerWidgetTaskHandler` is `AppRegistry.registerHeadlessTask`:
  it names the JS entry point the launcher's widget update runs. That update
  arrives through a headless worker that starts the ReactHost with **no activity
  and no React tree**, so anything registered from a component — or from a module
  only a component pulls in — has not run yet, the task key is unregistered, and
  nothing draws. Expo Router route modules load via `require.context`, whose
  entries are lazy getters, so `app/_layout.tsx` (where this used to live)
  evaluates only when the router renders. The widgets drew only while the app was
  warm, and were blank whenever they were added or updated with it closed. A blank
  widget is an *invisible* one — no crash, no log, just an empty cell.
- Everything reachable from `widget-task-handler.ts`'s **static** imports has to
  load in that cold context before anything can be drawn, so it stays tiny (React
  + the Quick Add tile). Supabase, `@do-done/api-client` and the task engine are
  behind `await import(...)` on the branch that needs them.
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
  module may call a TanStack Query hook, or reach for an API — the widget root has no
  QueryClientProvider. Both the project list (`projects`) and the inline "New
  project" action (`onCreateProject`) are therefore **handed in by the host**, which
  is the only piece that knows what else has to hear about a new project: the in-app
  hosts pass `createProjectOrNull` from `lib/task-queries` and let it invalidate the
  cache, and the widget root reads `ProjectsApi` directly and keeps its own array.
  The widget used to pass neither, which is why its Project chip was simply missing
  and `#groceries` silently became a tag on the one surface where it couldn't be a
  project. A surface that still omits the list gets the old behaviour, which now
  only ever describes the first frame while a list is loading.
- **Every quick-add surface has a door to the full editor**, because the chips will
  never cover notes, subtasks, attachments or the month calendar and a capture
  surface that dead-ends there is one you have to abandon. The rule is the same on
  both platforms: **create the task first, then open the editor on the persisted
  row** — both editors autosave, so neither has anywhere to keep unsaved state. Web
  has "More options →" (modal) and an expand icon (bar, inline composer), all via
  `openEditor` in `use-quick-add-composer.ts`; `allowEmpty` there creates a
  throwaway "New task" that `TaskEditModalV2`'s `draft` prop deletes again if the
  editor closes untouched. Mobile passes `onExpand` to `QuickAddComposer` /
  `QuickAddBar` and **requires a title** — it has no `draft` equivalent, so the
  alternative would be orphan "New task" rows. Where the editor opens is the host's
  call: in place for `QuickAddBar` and `app/quick-add.tsx`, but the widget root
  deep-links `dodone://task/<id>` and dismisses, since a 3400-line sheet wanting the
  router and the query cache has no business in a translucent launcher activity.
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
- The tile paints its squircle **twice** — once as the SVG, once as a
  `backgroundColor` on the `FlexWidget` behind it — and that is deliberate.
  `SvgWidget` hands the string to AndroidSVG and swallows a parse failure with a
  bare `printStackTrace`, so artwork alone has a silent path to fully transparent.
  It's sized to a centred square of `min(width, height)` from `widgetInfo`, not
  `match_parent`: a launcher cell is taller than it is wide, and the square
  artwork would letterbox inside its own background.
- The handler draws the tile for **every** action except `WIDGET_DELETED`. With
  `updatePeriodMillis: 0` there is no update tick, so an action it declines to
  draw for leaves the tile exactly as it was — and for a fresh widget, that's
  blank forever. `_layout.tsx` also calls `repaintQuickAddWidget()` once per
  launch, so opening the app heals a tile whose one render was lost.
- Test the tap flow in a **preview/release** build — `expo-dev-client` intercepts
  launches in debug builds. After changing the widget's size, remove and re-add it
  on the device.
- **None of this has been confirmed on a device yet** — see
  [`docs/android-widget-verification.md`](docs/android-widget-verification.md) for
  the checklist it still needs, the `ImageWidget` fallback if `SvgWidget` turns out
  not to render, and the build gotchas (stale checkouts, APK signing, launcher
  caching) that have already burned three install cycles.

### Launcher quick actions (app shortcuts)
Long-pressing the DoDone icon offers **Add task / Search / Today / Upcoming**,
each pinnable to the home screen with the "+" beside it. These are *not* widgets:
the launcher draws them itself, so a pinned one takes exactly one cell and sits
flush with the app icons around it — which is the point of having them alongside
the 1×1 quick-add widget rather than instead of it.

- `plugins/withAndroidShortcuts.js` writes `res/xml/shortcuts.xml`, the icon
  drawables and the labels, then hangs a `meta-data` tag off MainActivity.
  Static shortcuts, so they exist from install with no native code at runtime.
- **Labels must be `@string/` references.** Android drops a `<shortcut>` whose
  label is a literal, silently — no build error, the row just isn't there.
- **Intents must be explicit** (`targetPackage` + `targetClass`); an implicit
  one never launches. The deep link rides along as the intent's `data`, which is
  what `expo-linking`'s `getInitialURL` reads. Add task targets
  `QuickAddActivity` directly, so it floats the composer over the home screen
  exactly as the widget does; the rest target MainActivity.
- Each icon ships twice: an `<adaptive-icon>` in `drawable-anydpi-v26` so the
  launcher masks it to the same shape as the app icons, and a plain circle
  vector in `drawable/` for API 24-25, which has no mask. The glyph is scaled
  into 24..84 of the 108 viewport — inside the safe zone no mask can clip.
- `plugins/withAndroidShortcuts.test.ts` asserts the generated XML, including
  that every `dodone://` target has a route file. Every failure mode on this
  surface is silent on the device, so the test is the only place they surface.
  It is why `vitest.config.ts` includes `plugins/**` as well as `lib/**`.

### Location reminders (geofencing)
A task can carry reminders at places — "buy milk when I get to Tesco", "post the
letter when I leave the office". `task_locations` links a task to a location with
a `trigger_type` of `enter` or `exit`; a task can have several.

**Surfaces**
- `components/LocationReminderSheet.tsx` — the 📍 row in the task editor. A
  search field over tappable places: the first tap attaches the reminder, and
  direction, radius and whether to keep the place are adjustments made
  afterwards. **This is the only place in the app that prompts for location**,
  and it primes with an explanation first.
- `app/locations.tsx` (Settings → Saved places) — rename, re-radius, delete.
  Also lists any *one-off* place currently holding a region, since those count
  against the cap the warning on that screen is about.
- `lib/location-queries.ts` — query hooks + mutations. Every write ends in a
  geofence sync; the OS holds its own copy of the regions.

**Capture: search first, save never required.** Three rules, and each was a
usability bug before it was a rule:
- **A place doesn't have to be saved.** Attaching writes a location with
  `is_saved = false` — geofenced exactly like a saved one, hidden from the
  pickers, and deleted by a database trigger when its last `task_locations` row
  goes (`20260805000002_one_off_locations.sql`). "Save place" promotes the same
  row, so the task links survive. Client-side cleanup would have leaked rows on
  the paths that don't go through the client — a deleted task, a cascade — and a
  leaked one-off place is invisible by construction, since nothing lists it.
- **A name is never asked for.** `locations.name` stays NOT NULL because it's
  what the notification says; it comes from the search result ("Target") or the
  reverse-geocoded street line, not from the user.
- **Search is type-ahead** (`lib/place-search.ts`), biased towards the last
  known position and labelled with distance so "the closest one" is a thing the
  eye picks. Provider is **Photon** (OSM data, keyless): `expo-location`'s
  `geocodeAsync` returns coordinates with no label, so it can't populate a
  suggestion list at all, and Nominatim's usage policy forbids autocomplete
  outright. `geocodeAsync` stays on as the "look up what I typed" fallback for
  when the provider is unreachable. Reading the position for bias uses
  `getLastKnownPosition()`, which returns null rather than prompting or waiting
  for a fix — opening the sheet must stay free.

`components/MapPreview.tsx` draws the pin, its radius and your own position from
raster tiles (`lib/map-tiles.ts` holds the Web-Mercator projection, tested in
node). Deliberately not `react-native-maps`: that's a native module, so it would
need a fresh dev-client build and a Maps API key before anyone could see a pixel.
The trade is that it can't be panned and the pin can't be dragged.

The sheet tracks the IME height itself and shrinks its list to fit —
`edgeToEdgeEnabled` turns off Android's `adjustResize`, so nothing moves on its
own and a bottom-anchored sheet is simply behind the keyboard. Same approach as
`QuickAddBar`.

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
