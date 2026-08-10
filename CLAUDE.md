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

## A new task starts in the inbox

`inbox` is the default status — in the Zod schema, in the `tasks.status` column
default, and now at every capture surface. Capture is not triage: the Android
quick-add widget, `dodone://quick-add`, the launcher shortcut and the bars on
Today / Upcoming / All all have *no* view context to infer a status from, and
seeding `not_started` there quietly declared the task triaged, so it never
appeared in the Inbox anyone actually reviews.

**Only a surface whose context genuinely implies triage passes a status**:
the Inbox screens (`inbox`, redundant but self-documenting), the project
screens (`not_started` — filing into a project *is* the triage), and the
group/date composers, which seed whatever axis their section is grouped by
(`seedFromDrop`, `seedFromUpcomingDate`). Everything else omits it and inherits
the default. On mobile that default lives in one place per component —
`defaultStatus` in `QuickAddBar.tsx` and `QuickAddComposer.tsx`; on web,
omitting `status` from the `QuickAddSeed` is what reaches it.

## A guessable facet arrives already filled in

**Where the surface knows what a field should be, the chip shows it before the
user types a word.** Adding on the Finance project page fills the Project chip
with Finance; adding on Today fills the Date chip with today. It was already
*creating* the task that way — the seed has always been merged in at submit —
but silently, so the row you got back was not the row the composer described,
and on Today the seed didn't exist at all: a task typed into the Today bar had
no date and dropped straight out of the list it was typed into.

The rule the chips make legible, on web (`buildCreateInput` +
`contextFacets`, `lib/quick-add.ts`) and mobile (`buildInput`,
`QuickAddFields.tsx`) alike:

| Source | Beats |
| --- | --- |
| An explicit chip pick — including *clearing* one | everything |
| What was typed (`#home`, `p1`, "friday") | the surface's guess |
| The surface's guess (project page, Today, a section) | nothing |

- **A chip shows the value the task would be created with**, so it tracks the
  text as it's typed: `#home` on the Groceries page moves the chip to Home, and
  deleting the token moves it back. `ParsedPreview` is left echoing only what
  the chips can't say (deadline, tags, recurrence) — before this it was the
  *only* place a parsed date or priority showed, and the chips beside it sat
  empty.
- **A typed date now beats a seeded one**, including an Upcoming column's. That
  reversed a rule ("the column IS the date"), which was safe only while the
  seed was invisible: with the chip showing "Fri" as you type, an override the
  user can see is better than one that silently discards what they wrote.
- **Clearing is a real answer, and the only way to say "not in this project"
  on a page that is one.** `applyOverride` deletes a field passed `null`, which
  is why the chip picks are a `QuickAddOverride` (nullable) rather than a
  `Partial<CreateTaskInput>` (absent-only).
- **Touched-ness is state; the values are derived.** `useQuickAddComposer`
  stores only what the user picked, so nothing has to be re-synced when the
  seed changes, and `anyChipSet` — what keeps a surface expanded — means *the
  user set something*, not *a chip has a value*. A project page's bar would
  never collapse again otherwise. A successful create clears the picks, so the
  next task inherits the same context.
- **Only a route that genuinely is one facet seeds one.** `seedFromPathname`
  gives the universal quick-add (sidebar, palette, `q`) the same context the
  page's own bar has — project pages, Today, Inbox — and nothing anywhere else.

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

Three pieces do the work and **must agree**, since the same text is read by all
of them: `parseTaskInput` (`packages/task-engine`) parses a whole quick-add
string at submit, `extractTitleShortcuts` (`packages/shared`) is the live
absorber the title fields run on every keystroke, and **every "+ tag" control**
— the two task editors and mobile's quick-add chip row — classifies the bare
word it is handed. They take the project list as an *optional* argument and
delegate the match to `matchProject` in
`packages/shared/src/project-match.ts`. Omit the list — Storybook, the mobile
widget root, any surface with no projects to hand — and every token is a tag,
exactly as before.

**The "+ tag" field is a `#token` without the `#`**, and reads its word through
`classifyShortcutToken` on the same size → priority → project → tag ladder. It
used to store whatever was typed verbatim, so `#personal` in the title filed the
task into Personal while `personal` typed into the tag box two inches away made
a tag of the same word — and `p1` there made a tag literally named "p1". A
classification rule the user can't see has to be the same rule everywhere it can
be reached, so it is a function both callers share rather than a comment.

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

That bar is the **only** signal a background refresh gets. `RefreshControl`'s
spinner is the *gesture's*, and every list drives it from `usePullToRefresh`
(`lib/query-client.ts`) rather than from the query's `isRefetching`. The
obvious-looking `refreshing={isRefetching}` was the same `useRefreshOnFocus`
trap one line up: a refetch fires on every tab switch, so the platform drew its
pull-to-refresh circle — a control the user is meant to have *dragged* into
view — unprompted at the top of every list on every tap of the tab bar.

The cache is restored **only for the account that wrote it**, and that check
lives *inside* `restoreClient`, not in the auth listener. Restore and the auth
event resolve independently, so clearing after the fact is a race the previous
user's rows can win.

## Dragging a row (mobile)

**The query cache has to agree with the finger before the write goes out, not
after it.** `SectionedDraggableList` keeps a local copy of the order so a drop
lands instantly, but it re-seeds that copy from `sections` — i.e. from the
cache — on any change to any task in view. So for as long as the cache holds
the pre-drag order, the list is one cache write away from re-laying itself out
into it and back out again.

A cross-section move used to guarantee exactly that. It was
`updateTask(id, patch).then(() => reorderTasks(ids))`, two writes each with
their own optimistic patch and their own `invalidateTasks()`, and only the
second one carried the order. The first patch landed a cache that agreed the
task had moved section and still carried its old `sort_order` — the only thing
that decides a row's place *within* a section (`TasksApi.list` orders by it
alone, and `generateFocusList` breaks its ties by it). So the row appeared in
the wrong slot, the list re-rendered around it, then did it twice more as the
two refetches came back. Three full re-layouts inside about a second, which is
what read as the whole screen flashing.

- **`moveTask(id, input, orderedIds)`** in `lib/task-queries.ts` is the one
  door for a drag that both re-files a task and re-orders its destination: one
  optimistic apply of *both* halves, both writes, one invalidate. All four
  cross-section drag handlers (Today, Upcoming, and both branches of
  `GroupedTaskList`) go through it.
- **`reorderTasks` patches the cache too**, via `patchCachedOrder`, which
  stamps `sort_order` and re-sorts. That reproduces what the refetch will
  return, so the reconcile is a no-op rather than a second opinion.

`lib/task-move.test.ts` asserts on the cache *mid-flight*, with the writes held
open, because the settled state was never the problem.

The other half of a drag's aftermath is the refresh spinner, and that's fixed
one section up: every one of these invalidates used to drop `RefreshControl`'s
circle over the list, landing it on the row the finger had just let go of.

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

## Ticking a task off

The most repeated gesture in the app, and one shape on both surfaces. Timings
and rules live in `@do-done/shared` — the two implementations have nothing else
in common (CSS plus inline styles on web, Reanimated worklets on mobile), so
the constants are the only thing keeping them from drifting.

```
-90 →   0   the ring flinches under the press          anticipation
  0 → 220   the check springs and the ring fills
 20 → 360   a hairline halo rings out and dissolves    anticipation
 40 → 230   the strike-through is drawn, left to right
  0 → 400   sparks, on a completion that earned one    gated
420 → 680   the row slides right as its height closes  exit
```

**Nothing may outlive the 680ms envelope**, which is what keeps
`TASK_COMPLETE_EXIT_MS` governing every list drop and leaves the write path, the
hold, the per-id chaining and the undo window untouched.
`completion-motion.test.ts` asserts the relationships rather than the numbers:
the line finishes with the check (230 against 220 — one is the control
acknowledging the tap, the other the text, and the eye may be on either), and
everything inbound lands before the hold ends.

**The burst has to finish inside the *hold*, not just the envelope.** The row
turns on `overflow: hidden` the moment it starts collapsing, so a particle still
in the air then is sliced off at the row's edge as it shrinks. `SPARK_MS` is 400
against a 420ms hold. The stagger is spent *within* that, never added to it — a
particle that starts late flies for less time — so all ten land on the same
frame; web varies each particle's `animation-duration`, mobile re-bases each one
off the single shared progress value.

**Two platform differences that look like drift and aren't.** Web hangs the
squash off `:active`, so it really is the press, firing on pointer-down ahead of
React; mobile folds it into the completion, because a 22px ring is under the
thumb at exactly the moment a press-driven squash would be visible and
swipe-to-complete has no press at all. And React Native cannot animate
`textDecorationLine`, so `StruckText` draws the rule itself from `onTextLayout`
line rects behind one widening clip, while web uses an inline background
gradient that fragments per line so each rule ends where its line's text does.

**The halo and the burst mark a *moment*, not a state**, and are rendered only
for the frames they run in. Keying either off "is completed" would set every row
in a Completed list going the instant the page painted.

### When the sparks fire

Celebrating every completion is how a delight becomes a tax — by the fortieth
task of the week it is something you wait out, and the next thing anyone asks
for is a switch to turn it off. `sparkReason` is the whole gate, returning
*why* rather than a boolean so tests assert the reason:

| Reason | Fires when |
| --- | --- |
| `project-finished` | the last open task in the project |
| `last-in-section` | the last open task in this list's section |
| `streak` | the first completion of a day whose predecessor also had one |
| `effort` | estimated at two hours or more |
| `priority` | P1 or P2 — `p2`'s label is literally "High" |

Finishing outranks what finished it: the last task in a project being a two-hour
P1 makes the moment the project ending, not the task's size.

**A row cannot know it emptied a section, so its surroundings tell it.** Web
publishes counts through two contexts in `task-row-behavior.tsx` — section and
project are provided at different depths (a project page groups by status, so
the project's last open task is not the last in any group), and one context
would have the inner erase the outer. Mobile passes props, matching the split
already documented on `keepsCompleted`. **A missing count means "this surface
can't tell" and is deliberately distinct from zero**, so the inbox, search and
the drag overlay never fire those rules rather than firing them wrongly. Counts
are read at the tap, not at render: by then the row has already told its list
it is done.

**Streak needed a data model that did not exist** — `tasks.completed_at` is the
only substrate and nothing aggregated it. `packages/shared/src/streak.ts`
buckets timestamps into the reader's *local* days (a task finished at 11pm
belongs to the day the user was living in), and `claimStreakDay()` both answers
and records in one call. One call rather than a read plus a note, because *any*
completion starts the day — splitting them would let a second completion moments
later claim it again. It is claimed only when completing; reopening is a
correction and must not mark a day nobody worked. The history is fetched once
per session — a provider on web, a module singleton on mobile — and read
synchronously, because the row decides inside the tap handler where an `await`
would cost the frame the animation exists to use. Not loaded means `false`: an
unknown history costs a burst rather than inventing one.

**Reduced motion lands on the end state and drops the decorative layers** on
both surfaces. It never simply plays slower.

One trap already paid for: putting the drawn rule on the text means axe stops
measuring that text's contrast (`color-contrast` skips anything with a
background-image), so five pre-existing findings on completed titles went quiet
without the rendering changing. Noted in `globals.css` — that contrast is ours
to watch now, not axe's.

## Swiping a task row (mobile)

Swipe **right** for the single Done/Reopen action, which fires as it opens and
snaps shut. Swipe **left** for Today / Tomorrow / Delete, which are buttons and
wait to be tapped.

**`ReanimatedSwipeable` reports the direction of the *gesture*, not the panel
that opened** — the reverse of the `Swipeable` it replaces, and of how
`onSwipeableWillOpen('left')` reads. `panelForSwipe()` in
`apps/mobile/lib/swipe-actions.ts` is the one place that mapping is written
down, with the library source quoted. Reading it backwards is silent and total:
the row completed the task on the delete gesture, showed "Completed …", and did
nothing at all on the complete gesture — with the Today/Tomorrow/Delete buttons
snapping closed before they could be reached.

**Completion writes are serialized per task id** (`completionChains` in
`lib/task-queries.ts`). Undo is a second write to the same row while the first
is still in the air — the toast goes up as the completion is sent, and the row
is still being held for its collapse animation — so fired concurrently the two
UPDATEs race and the row keeps whichever reached Postgres second. Chaining makes
the last *intent* the last write; the sequence number a call claims before
joining the queue also tells a superseded write to leave the cache alone, or its
`dropFromLists()` fires mid-undo and takes back the row the user just recovered.

The toast waits for the write to land, and a failed undo says so instead of
leaving a button that visibly does nothing. `Toast.undo` is therefore optional:
a message-only toast renders without the button.

Delete is the exception to all of it — a hard delete behind a confirm dialog,
with no undo. `TasksApi.delete()` clears Storage bytes and cascades subtasks;
there is no row left to restore.
## The task row: two coloured slots (mobile)

**The row has exactly two places colour is allowed, and each carries one
variable.** Everything else that used to be a chip is one muted line of prose.

| Slot | Variable | Why that channel |
| --- | --- | --- |
| The **ring** (leading circle) | Project — its colour, and its `icon` emoji when set | Hue is a *nominal* channel: it says which, not how much. A project is a label with no ordering, so colour fits it natively. |
| The **gutter** (10 px, left of the ring) | Urgency — a red dot when overdue, then a bar whose length falls with the rank, nothing for a P4 | Priority is *ordinal*, and the channels that carry order are position and length. Red–orange–yellow only reads as a ranking because traffic lights taught us, and that scale collapses the moment a user picks red for their "Home" project. |

The rules that make it work, all of them load-bearing:

- **P4 draws nothing, and P3 does.** They are not the matched pair the names
  suggest: `tasks.priority` is `not null default 'p4'`, so P4 is what a task
  gets by *not* being triaged — the widget, a deep link and every MCP create
  land there. A mark for P4 would be a mark for absence on very nearly every
  row, and a signal that fires everywhere has stopped being one. P3 is the
  lowest rank someone actually chose, so it is the lowest one worth drawing,
  and it is the only cool mark in the column: slate, so it reads as ranked
  rather than urgent, and deliberately **not** the indigo accent, which means
  *selected* everywhere else in the app.
- **P4 is doing two jobs**, which is why the line falls there rather than
  anywhere tidier: the mobile picker offers it as "No priority" while
  `PRIORITY_CONFIG` labels it "Low". Splitting it into a real `none` would let
  all four ranks draw — a migration plus every priority surface (the check
  constraint, `TaskPriority`, the focus score, the `#p1`–`#p4` parser, display
  grouping/filters, both pickers, the widget, the MCP enums), so until someone
  wants that, this is the honest line.
- **Overdue outranks priority** in the gutter, and is the only thing in that
  column that is ever red. Being late is said in the title's weight too, so it
  reads from further away than a coloured chip did.
- **An unset field takes no space at all** — no placeholder, no empty chip.
  `rowSubline` returns only the parts that exist, and a bare task renders a
  title and nothing else.
- **"Today" never appears on a row.** A task scheduled today prints its time or
  nothing; the word on every row of the Today screen is a label that has
  stopped carrying information. An overdue task prints its *age* ("3 days
  ago"), which is the actionable form.
- **A project with no emoji is a first-class state**, not a fallback — the ring
  is still its colour. A task with no project gets a deliberate neutral.
- **Completion fills the ring with the project's colour**, the same way for
  every priority. Done is a state, not a rank; the reward must never vary by
  how important the task was.

The decisions are pure functions in `packages/shared/src/task-row.ts`
(`rowGutter` / `rowSubline` / `rowEstimate`), *not* in the component, because
`apps/mobile` has no renderer to test a component with — see Testing below —
and because web will want the same answers when its row follows.
`RECURRENCE_PRESETS` moved there too, so the label a row prints can never drift
from the option the editor's picker set.

**Both surfaces encode it the same way, and only the anchor is shared.** The
two `TaskItem`s are independent (`apps/web` Tailwind, `apps/mobile`
StyleSheet), and they agree on the ring and the gutter — both call `rowGutter`
— but not on what follows the title:

- **Mobile** collapses every chip into `rowSubline`'s single line of prose,
  because nothing in that row was interactive anyway.
- **Web keeps its chips**, because there they are *editors*: priority, project,
  estimate and schedule each open a popover in place. Collapsing them into
  prose would delete four inline affordances to save a line. The project chip
  drops only its colour dot, which the ring now says. Turning them into a
  subline that swaps back to editors on hover is a real option, and a separate
  change.

Web-only detail: the gutter is also the priority editor's button, so a P4 row
has an invisible control. A faint placeholder fades in under the pointer
(`group-hover/row`) to keep it discoverable.

Two follow-ups deliberately left out: dropping the project from the subline
when it repeats the row above (needs list-level context at every call site —
`hideProject` is the prop, and `app/projects/[id].tsx` already passes it), and
the section-header changes (capacity, create-into-group). One divergence worth
revisiting: web still paints an overdue date chip red, so an overdue row there
says it three ways (gutter, weight, chip) where mobile says it two.

One behaviour was removed on purpose: the row's project chip used to open a
picker inline. The chip is gone, and no other element in the row is a natural
target for it, so the picker now lives only in the editor — one tap away.

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

`attachmentKind()` also classifies **audio**, which is what every voice note
comes back as. Playback is `expo-audio` on mobile and a plain `<audio controls>`
on web — the browser's transport is keyboard-accessible and already has a
scrubber, so a hand-rolled one would be a worse version of it. Both surfaces
sign a URL for audio the same way they do for images (`needsSignedUrl`), and
both label a file matching `isVoiceNoteFileName()` as "Voice note" rather than
showing its timestamped storage name.

## Voice notes

**A recording produces two artefacts and DoDone keeps both**: the audio, as an
ordinary attachment, and the transcript, as the task's text. Keeping the audio
is the feature rather than a nicety — a recogniser mishears names and numbers
constantly, so the recording is the record of what was said and the transcript
is a convenience over it.

**One microphone session produces both.** `expo-speech-recognition` will persist
the audio it is already listening to (`recordingOptions: { persist: true }`),
which is why there is no recorder module alongside the recogniser: two things
contending for the mic means one of them silently gets nothing on Android. It
was already a dependency, so the *capture* half needed no new native module.

| Where | What |
| --- | --- |
| `packages/shared/src/voice.ts` | `splitTranscript`, `appendTranscript`, the file naming, the duration cap. Shared so a sentence can't become the title on the phone and the description on the web. |
| `apps/mobile/lib/voice-session.ts` | Pure decisions: transcript accumulation, level normalisation, the completion gate, error copy. |
| `apps/mobile/lib/voice-capture.ts` | `useVoiceCapture` — the native module, lazily required so Expo Go degrades to `supported: false` rather than crashing. |
| `apps/mobile/lib/voice-note.ts` | `attachVoiceNote` — bytes out of the cache, up to Storage, cache file deleted. |
| `apps/mobile/lib/use-voice-quick-add.ts` | The create-then-attach flow both quick-add surfaces share. |
| `apps/mobile/components/VoiceRecorder.tsx` | The card: level meter, clock, live transcript. |

Rules that look arbitrary and aren't:

- **The transcript splits into a title and a description, but only where there
  is no title yet.** Quick-add takes the first believable sentence as the title
  (falling back to a word-boundary cut at `VOICE_TITLE_MAX_CHARS` when the
  recogniser returned no punctuation, which is Android's default); the task
  editor *appends* the whole thing to Notes, because the task already has a
  title. A sentence boundary is only believed after three words — dictation
  punctuates abbreviations too, and "Call Dr." would otherwise title the task
  with half a name.
- **A final result is folded in by prefix, not by appending.** Android's
  continuous mode emits one result per utterance; iOS re-sends everything said
  so far. Appending blindly stutters on iOS, replacing blindly loses every
  Android segment but the last, and the prefix test needs no platform check.
- **A session hands over only once `end` *and* `audioend` have both fired.**
  The file is explicitly unsafe to read before `audioend`, so completing on
  `end` alone ships a truncated WAV — a bug that reproduces on one phone and
  not another. A grace timer covers a recogniser that dies mid-session.
- **The recording is uploaded after the task is created, never before.** An
  attachment row points at a `task_id`, so there is nothing to attach to until
  then; the file waits in the cache across the gap between speaking and
  submitting. A failed upload says so and keeps the task — and keeps the local
  file, since destroying the only copy of what someone said over a transient
  network error is the one unrecoverable outcome here.
- **The name and MIME type come from the URI the recogniser wrote**, not from
  an assumption: Android writes WAV, iOS may write CAF, and neither announces
  which. `attachmentKind` reads the extension before the MIME type, so guessing
  wrong renders the app's own recording as an anonymous download chip.
- **`VOICE_MAX_DURATION_MS` is the attachment size limit wearing a clock's
  face.** 16 kHz mono PCM is ~32 KB/s, so the 10 MB bucket ceiling is a little
  over five minutes; four leaves headroom, and a counter the user can watch is
  kinder than rejecting a five-minute upload after the fact.
- **The recorder is a plain card, not a `Modal`.** Every surface it appears on
  is keyboard-anchored, and an Android `Modal` opens a new window and drops the
  IME — the same reason `QuickAddFields`' chip popovers are inline.

### Getting to it

Four doors, all reaching the same composer:

| Entry | How |
| --- | --- |
| Quick-add bar (above the tab bar) | Mic button |
| `dodone://quick-add?voice=1` | In-app deep link, opens straight into recording |
| `dodoneadd://voice` | The **"Voice task"** launcher shortcut — `QuickAddActivity`, floating over the live home screen |
| Task editor | 🎙 Record, beside Photo and File; transcript appends to Notes |

`QuickAddActivity` answers `dodoneadd://open` and `dodoneadd://voice`, and the
launch URI is the *only* thing that tells them apart — `quick-add-root.tsx`
reads it via `getInitialURL` and `isVoiceLaunch` (`lib/quick-add-launch.ts`)
matches it. That match and the shortcut's `data` URI must stay in step, which
is what `withAndroidShortcuts.test.ts` asserts; a mismatch is silent on the
device, opening the wrong door with no error. The composer does not mount until
the URI has been read, since mounting on the default and correcting afterwards
races a permission dialog over a keyboard that shouldn't have come up.

## Design System

- Accent: indigo-500 (#6366f1)
- Font: Inter
- Spacing: 4px grid
- Aesthetic: Things 3 cleanliness + Linear speed
- Tokens in `packages/ui/src/theme.ts`

### A project's colour and its icon

Both are the *identity* channel on every task row's ring, so both are chosen
from a shared menu rather than typed.

- **`PROJECT_COLOR_OPTIONS`** (`packages/shared/src/constants.ts`) is twelve
  wide and two deep: a bright spectrum, then the same sweep darker finishing on
  four neutrals. The grid is `grid-cols-12`, not a wrapping row — a palette that
  reflows to 11-and-1 loses the pairing that lets two projects both be "the
  green one" and still be told apart at 20 px.
- **`COMPACT_PROJECT_COLORS`** is the old eight, and it is what the *inline*
  "new project" forms use — web's project popover, mobile's quick-add chip.
  Four wrapped rows of dots is fine in a dialog and a wall in a popover over a
  keyboard, and capture is not where a colour gets chosen carefully.
- **`packages/shared/src/project-icons.ts`** is the icon catalogue: ten emoji
  groups plus **Symbols**, which are not emoji at all. `projects.icon` has
  always been a free string rendered as text, so ★ and ◆ work and take the
  row's own text colour — the group exists to say so, since nothing did.
- **Two length budgets, and the catalogue satisfies both.** The column is
  `char_length(icon) <= 10` (code points) and `ProjectSchema` is
  `z.string().max(10)` (UTF-16 units), so a ZWJ family — 7 code points, 11
  units — passes Postgres and is rejected by the client. Rather than let them
  disagree, sequences that long are not offered, and `normalizeProjectIcon`
  drops one rather than truncating it (half a ZWJ sequence renders as two
  unrelated emoji). `firstGrapheme` is the cluster reader, spelled out by hand
  because `Intl.Segmenter` is not dependable on Hermes.

The picker **expands in flow on both surfaces, and never floats**: web's
dialog is `overflow-hidden` (that's what rounds its header and footer), so an
absolutely positioned panel is clipped the moment it passes the footer; on
mobile an Android `Modal` would open a second window and drop the IME. The
form grows and its body scrolls instead.

Mobile has no project *edit* screen at all — only create (`ProjectFormSheet`)
and the detail view — so the full palette and the icon grid reach it there.

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

### An install that's too old to update

**A build stops taking OTAs the moment a published bundle imports a native
module that build doesn't have.** The update downloads, throws on launch,
expo-updates rolls back to the last bundle that started, and — because
`CheckForUpdateProcedure` will not re-offer an update with
`failedLaunchCount > 0` — every check from then on comes back "no update
available". The app sits on an old bundle insisting it is current, and the only
signal is the sha in Settings → App version not moving. Adding
`expo-document-picker` / `expo-image-picker` / `expo-file-system` (attachments)
and `expo-audio` (voice) each drew that line; installs older than them need a
new APK, not an update.

`describeNoUpdate()` in `apps/mobile/lib/update-check.ts` is why that is now
legible: `Updates.checkForUpdateAsync()` returns a `reason` alongside
`isAvailable: false`, and only `noUpdateAvailableOnServer` means you are
current. Reporting all of them as "Up to date" is what hid the above — and an
unrecognised reason deliberately doesn't claim currency either.

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

### The task widgets draw the app's row

Today, Upcoming and the 4×1 **Next up** strip all render the two-slot row
described under *The task row* above — ring for the project, gutter for
urgency, one muted subline for the rest. The row's decisions are **not**
reimplemented here: `rowGutter` / `rowSubline` / `rowEstimate` from
`@do-done/shared` are the same functions the in-app row calls, so a widget and
a list can never disagree about what a task is. Priority used to colour the
checkbox on this surface, which put an ordinal variable in a nominal channel on
the one place in DoDone that never said which project a task belonged to.

Four rules the widget adds on top, all of them about a launcher cell being
small:

- **`loadWidgetTasks` fetches projects as well as tasks**, because the ring
  needs a colour and an emoji. A projects failure returns an empty list rather
  than propagating — every ring falls back to neutral, which is a duller widget
  but still a correct one; letting it take the task list down would turn a
  cosmetic outage into an empty home screen.
- **Fitting spends a height budget, not a row count.** `layoutRows` in
  `widgets/widget-layout.ts` charges 24 dp for a bare row, 34 dp for one
  carrying a subline and 22 dp for a group header, and reserves the "+N more"
  line *before* placing the row that would need it. The old `rowCapacity`
  divided the height by a flat 26 dp, which was wrong in both directions the
  moment rows stopped being uniform — and a "+N more" computed off a wrong
  capacity is a wrong number about the user's own task list, with nothing on
  the home screen to contradict it.
- **Below `COMPACT_BUDGET_DP` the sublines go, all of them.** A subline costs
  42% more row height, which on a 3×2 is the difference between three tasks and
  one — the widget was a group header and a single line. There are exactly two
  densities and no truncated middle ground, and the choice is made inside
  `layoutRows` from the budget, so no caller can get it wrong.
- **A group header owns its day, so the rows beneath it don't repeat it.**
  `WidgetGroup.namesTheDay` drives `rowSubline`'s `hideScheduledDay`, which is
  the date-shaped twin of `projectName: null`. Overdue is deliberately *not* a
  day group: "3 days ago" is the one genuinely actionable thing those rows
  have to say. The project name **stays** in the subline — the ring is a fast
  cue, the name is the readable one, and a project with no emoji would
  otherwise be a colour the user has to have memorised.
- **The card has a dark variant**, via the library's own
  `renderWidget({ light, dark })`. One component tree; a theme is an argument
  to it (`widgets/widget-theme.ts`). A project's colour is **lifted toward
  white, never replaced** — someone who picked green for Home has to find green
  on both cards. The dark card is `#191b22` rather than black, so it keeps an
  edge against an AMOLED wallpaper.

**`widgets/widget-render.ts` is why the two render paths can't drift.** The
launcher's headless handler and the app's own foreground refresh
(`lib/widgets.ts`, called from `invalidateTasks`) both build the light/dark
pair from it. A refresh that passed a single tree would silently drop the dark
card until the next 30-minute tick — a bug that only reproduces on a phone set
to dark.

Two things that can only be checked on a device: an 18 dp ring is well under
Material's 48 dp touch minimum (its tappable box is padded to 26×24, which is
as far as it goes without making every row taller), and `TextWidget` has no
`lineHeight`, so the dp constants in `widget-layout.ts` are padding-and-margin
sums rather than a typographic ideal. **Adding the Next up widget changes
`app.config.ts`, so it needs a fresh `eas build` — it will not arrive over
OTA.** The row redesign itself is pure JS and does ship over an update.

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
Long-pressing the DoDone icon offers **Add task / Voice task / Search / Today /
Upcoming**, each pinnable to the home screen with the "+" beside it. These are *not* widgets:
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
  what `expo-linking`'s `getInitialURL` reads. Add task and Voice task both
  target `QuickAddActivity` directly, so the composer floats over the home
  screen exactly as the widget does; the rest target MainActivity. Those two
  differ *only* in their `data` URI — see Voice notes → Getting to it.
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
