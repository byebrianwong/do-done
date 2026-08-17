# do-done

AI-native task management app. Turborepo monorepo: Next.js web, React Native/Expo
mobile, and a custom MCP server.

## Naming

The user-facing brand name is **DoDone** — one word, capital D twice. Use it in
all UI copy, titles, marketing, and user-facing docs. Never `do-done`,
`Do Done`, or `dodone`.

The lowercase `do-done` is for internal identifiers only: the repo, the npm
scope (`@do-done/*`), the Expo `slug`. The deep-link scheme (`dodone`), bundle
IDs, event names, and storage keys stay as they are.

## Dates: "Scheduled" and "Deadline", never "due"

A task has two independent date pairs, named the same way from the Postgres
column up to the MCP tool parameters:

| Column | Label | Meaning |
| --- | --- | --- |
| `scheduled_date` / `scheduled_time` | **Scheduled** | The day the user plans to *do* the task. This is what the app schedules by. Nearly every dated task has one. |
| `deadline_date` / `deadline_time` | **Deadline** | A hard external cutoff. Rarely set. Its absence does not mean a task is undated. |

**Never use the bare word "due"** — not in UI copy, tool descriptions, tool
output, labels, comments, or identifiers.

Why: "due" is the word an English speaker reaches for when they mean the
*scheduled* day. So every consumer that saw `due_date` — MCP clients most of
all — read the rarely-set deadline as the schedule, and reported a fully
planned week as empty. ("overdue" is a different word and is fine.)

**The quick-add parser is the one place that word is read rather than written.**
`parseTaskInput` sends every date it finds to `scheduled_date` ("buy milk
tomorrow", "ship it friday 9am"). It only produces a `deadline_date` when "due"
or "deadline" introduces the date ("submit report due friday"). Same reasoning
applied to input: reading "tomorrow" as a deadline left the task unscheduled and
out of every day-based view.

This is deliberately narrow. "by friday" is a schedule, because that is also how
people say the day they will get to something. The rule is
`DEADLINE_MARKER_PATTERN` in `packages/task-engine/src/parser.ts`.

One sanctioned exception to the ban: copy that teaches the keyword, like the
landing page's "'due friday' — a hard deadline instead". That quotes an input
token rather than naming a field.

**History.** These columns were `when_date` / `when_time` / `due_date` /
`due_time` until `supabase/migrations/20260804000001_rename_task_date_fields.sql`.
That migration also recreates both calendar functions, because a plpgsql body is
stored as text and does not follow a column rename. Display configs saved under
the old field names are remapped on read by `parseDisplayConfig` in
`packages/shared/src/display.ts` — they live in localStorage and AsyncStorage as
well as the database, so a SQL migration could not reach them.

## New tasks start in the inbox

`inbox` is the default status: in the Zod schema, in the `tasks.status` column
default, and at every capture surface.

**Only pass a status from a surface whose context genuinely implies triage.**
That means the Inbox screens (`inbox` — redundant but self-documenting), the
project screens (`not_started`, because filing into a project *is* triage), and
the group/date composers, which seed whatever axis their section is grouped by
(`seedFromDrop`, `seedFromUpcomingDate`). Everything else omits the status and
inherits the default.

Why: capture is not triage. The Android quick-add widget, `dodone://quick-add`,
the launcher shortcut, and the plus button on Today / Upcoming / All have no
view context to infer a status from. Seeding `not_started` there quietly declared the
task triaged, so it never appeared in the Inbox anyone actually reviews.

On mobile the default lives in `defaultStatus` in `QuickAddComposer.tsx`, and
in what `QuickAddButton.tsx` puts in the URL: only the project screen sends
`status=not_started`, and `app/quick-add.tsx` reads anything else as `inbox`. On
web, omitting `status` from the `QuickAddSeed` is what reaches it.

## Quick-add pre-fills the fields it can guess

**When the surface knows what a field should be, the chip shows that value
before the user types anything.** Adding a task on the Finance project page
fills the Project chip with Finance. Adding on Today fills the Date chip with
today.

The app already *created* tasks this way — the seed was always merged in at
submit — but silently, so the row you got back was not the row the composer
described. On Today the seed didn't exist at all, so a task typed into the Today
bar had no date and dropped straight out of the list it was typed into.

Precedence, on web (`buildCreateInput` + `contextFacets`, `lib/quick-add.ts`)
and mobile (`buildInput`, `QuickAddFields.tsx`) alike:

| Source | Beats |
| --- | --- |
| An explicit chip pick, including *clearing* one | everything |
| What was typed (`#home`, `p1`, "friday") | the surface's guess |
| The surface's guess (project page, Today, a section) | nothing |

- **A chip shows the value the task would be created with**, so it tracks the
  text as you type. Typing `#home` on the Groceries page moves the chip to Home;
  deleting the token moves it back. `ParsedPreview` now echoes only what the
  chips can't show (deadline, tags, recurrence). Before this it was the only
  place a parsed date or priority appeared, while the chips beside it sat empty.
- **A typed date beats a seeded one**, including an Upcoming column's. This
  reversed an earlier rule ("the column IS the date"), which was only safe while
  the seed was invisible. Now that the chip shows "Fri" as you type, an override
  the user can see beats one that silently discards what they wrote.
- **Clearing a chip is a real answer.** It is the only way to say "not in this
  project" on a page that is one. `applyOverride` deletes a field passed `null`,
  which is why chip picks are a `QuickAddOverride` (nullable) rather than a
  `Partial<CreateTaskInput>` (absent-only).
- **Store what the user touched, derive the values.** `useQuickAddComposer`
  stores only the user's picks, so nothing needs re-syncing when the seed
  changes. `anyChipSet` — which keeps a surface expanded — means *the user set
  something*, not *a chip has a value*; otherwise a project page's bar would
  never collapse. A successful create clears the picks so the next task inherits
  the same context.
- **Only seed from a route that genuinely is one facet.** `seedFromPathname`
  gives the universal quick-add (sidebar, palette, `q`) the same context the
  page's own bar has — project pages, Today, Inbox — and nothing else.

### Capture is a button on mobile

Every list screen used to pin a full-width text field above the tab bar. It
could be typed into where it stood — but a tap raised the keyboard and grew the
card into the composer, which is what a button does, and until then the field
spent the width of the screen saying "Add a task…" on top of the tasks it was
covering. So it is a plus button in the bottom-right corner now
(`QuickAddButton.tsx`), and the typing happens where it already happened for
the widget, the launcher shortcut and the deep link: `dodone://quick-add`, a
transparent modal over the list.

- **The screen's context rides along as URL params** — `projectId`,
  `scheduledDate`, `status` — so the chips open pre-filled exactly as the
  table above says, and `useQuickAddFields` takes them through
  `QuickAddComposer`'s new `seed` prop. A deep link arrives with none of them
  and seeds nothing, which is what it always did.
- **One composer, not two.** `QuickAddBar` was a second card with its own
  keyboard tracking, mic, expand button and copy of the create flow, and it was
  the only place two capture surfaces could drift apart. `ParsePreview` moved
  across with it, so the deadline / recurrence echo the deep-linked composer
  never had is now on every surface instead of none.
- **Adding closes the surface**, where the bar stayed open for the next task.
  `app/quick-add.tsx` invalidates before it dismisses, so the new row is in the
  list as the backdrop clears rather than arriving with the focus refetch a
  beat later. Burst capture is still a real need, and it is still served where
  it belongs — a shopping list, whose composer commits without dismissing on
  purpose.
- **A long press dictates.** The mic went with the field it sat in, and a
  gesture nobody is told about is not a replacement for a button; it is one of
  four doors into the same recorder (see *Voice notes → Ways in*), and the
  composer's own mic is one tap further on.

## Subtasks follow their parent's project

A subtask is the same work as its parent, one level down, so it lives in the
parent's project unless someone says otherwise.

All three rules live in `TasksApi` (`packages/api-client/src/tasks.ts`), not in
any UI. That is the one door web, mobile, and MCP all write through; otherwise
the rule would have to be reimplemented at every surface that can create a
subtask.

| When | What happens |
| --- | --- |
| Created under a parent | `create` copies the parent's `project_id`, unless the caller named one |
| Moved under a parent | `update` does the same, on the same terms |
| The parent changes project | `update` cascades to the whole subtree |

- **The cascade compares the *result* against the previous row, not the input.**
  So a project arrived at by re-parenting propagates the same way a typed one
  does, and a write that re-states the project a task already had does nothing.
- **A hand-filed subtask is overwritten when its parent moves.** The parent's
  move is the more recent instruction, and the alternative — remembering which
  subtasks were filed by hand — is state nothing on the row or in the editor
  could show the user. You can still file a subtask elsewhere; it just doesn't
  survive the parent being moved.
- **`subtreeIds` stops at the depth-2 ceiling** the database trigger enforces.
  The cascade is two queries, not an open recursion — and one query for a
  childless task, which is the common case. It is awaited, so a caller's cache
  invalidation lands after the children have moved.
- **The cascade is best-effort.** The parent's own write has already landed and
  there is nothing to roll back to, so a failure leaves the subtree behind
  rather than failing the write the user asked for.
- `apps/web/src/lib/demo/api.ts` mirrors all three by hand.

### Hiding subtasks in lists

Every list is a flat query, so a subtask appears as an ordinary row wearing a
"↳ parent" breadcrumb. That is right for a checklist someone is working
through, and noise for a parent whose six steps bury the rest of the page.
`showSubtasks` on `DisplayConfig` is the switch, next to "Show completed" in
both Display menus.

- **It is a top-level field, not a `filters` clause.** It describes what a list
  *is* by default, not a narrowing the user applied, so it must be able to
  default to *on* without lighting the "Filter · N" badge on every view.
- **It defaults to on**, and `parseDisplayConfig` backfills that for every
  config saved before the field existed. Defaulting it off would silently change
  what every saved view means.
- **One branch in `filterTasks`**, so grouped lists (`applyDisplay`) and the
  curated Today/Upcoming layouts (`filterByConfig`) both get it.

### Every mobile list is a Display view

Inbox, Project, Tag, and Completed used to hand-roll their own list — a
`DraggableFlatList`, or a `SectionList` over an Open/Done split. That is why
they had no Display menu, and so no way to hide subtasks. They now use
`useDisplayConfig` + `GroupedTaskList` like All/Today/Upcoming, reusing web's
`viewKey`s (`inbox`, `project`, `tag`, `completed`) so a preference set on the
laptop is the one the phone opens with.

- **`project` and `tag` each have one config, not one per project or tag** —
  same as web. A per-id key would reset itself every time a tag was coined.
- **Their defaults are web's defaults.** This changed two screens visibly: a
  project page opens grouped by status rather than Open/Done, and neither it nor
  a tag page shows completed tasks until "Show completed" is on. Both were
  previously implicit in the hand-rolled Open/Done split.
- **`GroupedTaskList` gained four props** so those screens didn't each keep
  their own list just to keep their own behaviour:
  - `hideProject` and `openInProject` — the project screen, where every row
    belongs to the title bar's project, and the project's open count answers
    both celebration rules.
  - `sectionCounts={false}` — the tag screen. A tag cuts across projects and
    statuses, so its sections aren't sections of *work*; a count taken from one
    would fire the celebration on a guess.
  - `ListEmptyComponent` — a list that renders nothing when empty is fine for
    All and wrong for Inbox, which has something to say there.
- **`hideEmptyGroups` on the project and tag screens.** `applyDisplay` emits
  every non-terminal status column even when empty, on purpose: they are drop
  targets, so a task can be dragged into a status nothing currently has. That is
  worth it on All and costly on a project page, where a few tasks sat under
  "INBOX (0)" and "LATER (0)". Both screens listed only non-empty sections
  before adopting the engine, so the flag restores that. The trade, on those two
  screens only: you can no longer drag into a status that is empty there. The
  engine and web are unchanged.
- **Completed keeps its day buckets**, using the same curated/override shape as
  Upcoming. The engine has no group key for "the day it was finished"
  (`completed_at` is a sort field), so the view's own grouping renders the
  buckets, and choosing any other grouping hands the list to `GroupedTaskList`.
  Either way `filterByConfig` runs first, which is what gives that screen the
  subtask switch — a parent whose six steps were ticked off together otherwise
  buries the rest of the day.

## Suggestions from your own task history

Below the three precedence tiers above sits a fourth — the history — and it is
the only one that is **offered rather than applied**. As a title is typed, its
words are scored against the user's own task list, and the project (and estimate)
that kind of task has gone to before appears under the composer. Tab takes it.

**The training set is the history and nothing else.** A keyword table mapping
"gym" to "Health" is a guess about a project list we can't see, and it is wrong
for everyone whose projects are named differently — which is everyone.
(`suggestCategories` in `packages/task-engine` is exactly that table and has been
dead since it was written.) What the history says is checkable — "the last four
tasks containing `standup` went to Work" — which is also what makes a suggestion
explainable: `because` carries those words into the pill's tooltip.

**Nothing here reaches `buildCreateInput`.** Accepting a suggestion calls the
same setter the chip's own picker does, so from that instant it *is* an explicit
pick. The failure modes are not symmetrical: an ignored suggestion costs a
glance, while a silently applied one files the task into a project the user never
chose and will not think to look in. Auto-applying above some confidence would be
a fourth tier in `contextFacets` instead — a real option, and a different
decision.

Every threshold in `packages/shared/src/suggest.ts` follows from that asymmetry:
a word must have been seen twice (one coincidence would otherwise score a perfect
1.0), the winner must score a whole vote *and* hold 60% of the evidence, and a
title whose words point two ways resolves to **silence** — that being exactly the
case where the user would have stopped to think, and a confident wrong chip is
what stops them.

- **Each qualifying word splits *one* vote** across the values it has been seen
  with, so a word that always means the same thing carries a whole vote and a
  word meaning four things carries a quarter each. Without that normalisation the
  winner is whichever project simply has the most tasks, which ignores the title.
- **Project and estimate only.** `tasks.priority` is `not null default 'p4'`, so
  the history cannot tell "chose Low" from "never triaged" — the same collapse
  that makes P4 draw nothing in the row gutter — and a frequency model over it
  would suggest `p4` for nearly everything. A date is about *when you are* rather
  than what the words say, and the parser already reads "friday" out of a title
  far better than a count could.
- **It renders below the input, beside `ParsedPreview`, never inside a chip.** A
  chip's one click already means "open the picker", so a ghosted value in one
  would mean two things at once, and the reading that lost would be the one the
  user wanted. `SuggestedFacets` gives each guess its own dashed pill whose only
  job is to be taken.
- **Only into an *empty* chip.** A facet with a value has been answered by
  someone with a better claim than the history.
- **Two calls, because they run at different rates.** `buildSuggestionIndex`
  counts a bounded sweep once per session (`SuggestionProvider`, mounted beside
  `CompletionStreakProvider` in the app shell and `DemoShell` alike);
  `suggestFacets` runs against it per keystroke, off the *parsed* title so a
  `#project` already typed isn't fed back as evidence for the answer it just
  gave. It is state rather than a ref, unlike the streak, because the chips have
  to fill in when the history lands.
- **`TasksApi.suggestionHistory()` selects three narrow columns, newest-first and
  bounded** — unlike `listTags`, which has to sweep everything because a tag it
  misses doesn't exist to the app. A suggestion has no such duty.

**Both platforms share one scorer; the difference is the keyboard.** Web binds
Tab to accept, only when there is something to accept, so it still moves focus
otherwise. A phone has no Tab, so a tap is the whole interaction.

Mobile obeys the rule the rest of `QuickAddFields.tsx` lives under: **it may not
call a query hook or reach for the API**, because the widget root mounts its own
React tree with no `QueryClientProvider`. So the index is handed in by the host
exactly as `projects` is — `useSuggestionIndex()` on the two in-app hosts, a
direct `TasksApi` read in `quick-add-root.tsx`. That read uses the *same* bound
as everywhere else, not a cheaper one tuned for a launcher activity: a shorter
history is a different history, and the widget would then guess differently from
the in-app bar for the same title, which is the drift a shared scorer exists to
prevent.

`suggestionsFor(title)` takes the title rather than holding it, because the hosts
own that state — the same shape as `buildInput(raw)` and `absorbTags(value)`. It
scores the title directly with no parse: mobile's absorber has already stripped
every `#token` on the way in, and a leftover date word costs nothing because the
parser strips those before a task is saved, so no historical title carries one.

**`suggestionKeys` is its own query root, not under `taskKeys`** — the optimistic
`setQueriesData<Task[]>` sweeps rewrite everything under `taskKeys.all`, and this
cache holds a pair of Maps. It is deliberately **not** in `invalidateTasks()`,
which is where it differs from `tagKeys`: a tag count is an index of what exists
and is wrong the moment a task moves, while this is a guess from habit that one
more task changes by about nothing. Refetching the history after every create
would be the most expensive write in the app, in service of a suggestion that
would have been identical.

## Status ↔ schedule auto-sync

An opt-in rule with two independent halves, both off by default, that keeps a
task's status and its `scheduled_date` from drifting apart. Settings live on
`user_preferences` (`status_sync_*`); the rules are pure functions in
`packages/shared/src/status-sync.ts`.

- **promote** — a task whose scheduled date lands on or before the *horizon*
  moves up to `status_sync_status`. It never moves a task backwards, so
  `in_progress`, `done`, and `cancelled` are untouched. Overdue counts as
  inside the horizon. It fires on a *change*, not continuously — see below.
- **backfill** — a task set to `status_sync_status` *or past it* gets its
  `scheduled_date` set to the horizon, if it had none or had one further out.

The horizon is stored in both representations at once (`_horizon_days` and
`_horizon_key`), with `_horizon_kind` selecting the live one. That way switching
modes in the settings UI remembers the other, and neither column is ever null.

**Both halves are applied in `TasksApi.create`/`update`**, not in the apps. That
is the one door web, mobile, and MCP write through, and it folds the rule into
the *same* UPDATE rather than chasing it with a second write. Settings are read
once per instance and cached for a minute; call `invalidateStatusSyncCache()`
after saving them.

The promote half also has to fire when *no write happens* — when a task's
scheduled day simply arrives. `TasksApi.syncScheduledToStatus()` is that sweep:
one filtered UPDATE, run from `StatusSyncRunner` (web app layout),
`startStatusSyncSweeps()` (mobile `_layout`, on resume), and before the MCP
read tools.

### Promote fires on a change; it is not an invariant

**A status the user set by hand always stands.** Promote runs at two moments
and no others: a write that moves a task's `scheduled_date` inside the horizon,
and the day a task's existing date comes near. A write that leaves the date
alone leaves the status alone.

So the rule reads as: *re-dating a task reconsiders where it sits in the queue;
nothing else does.* Move a task scheduled for tomorrow from Next back to Not
started and it stays there. Change its date — to any other day inside the
horizon, or from outside to inside — and it goes back to Next, because the date
is the newer instruction. Demote it again after that and it stays demoted
again.

This replaced an invariant: promote used to re-apply on *every* write and every
sweep, so a demotion sprang back within seconds. It was doing exactly what the
setting said, and it read as the app refusing the edit, because the only
evidence was a field springing back with nothing to explain it. That is the
failure this section exists to prevent repeating — **an automatic change the
user cannot override and is not told about is indistinguishable from a bug.**

Three precedence rules:

- An explicit `scheduled_date` in the same write always beats backfill.
- Promote is gated on the write moving the date (`dateMoved` in
  `statusSyncPatch`). Creating counts, and so does backfill having just
  supplied a date.
- But on a write that *does* move the date, an explicit `status` still does not
  exempt the row. Setting a Not started task to tomorrow moves it to Next even
  though the same write named a status.

**`user_preferences.status_sync_swept_through` is what makes the sweep a
reaction rather than a standing condition.** It records the horizon the sweep
last ran through; `sweepPromoteRange` turns that into the band of days that
have *newly* crossed in, and the sweep promotes only inside it. Without the
lower bound the sweep re-promotes every near task on every foreground, which is
the invariant coming back in through the other door — the write-time fix alone
would not have held.

- **The watermark advances even on an empty run**, and only after the promote
  UPDATE succeeded. Leaving it behind on an empty run reopens the same band
  next pass; advancing it past a band that failed to write skips those days
  forever.
- **Null means never swept**, and the next sweep takes in the whole list.
  That is both the pre-migration behaviour and what turning the setting on
  should do.
- **It is reset by `UserPrefsApi.updateStatusSync`** whenever a field that
  changes *which* tasks promote is written — everything except
  `status_sync_backfill`. Changing the rule re-applies it; off-and-on-again is
  the escape hatch for re-applying it over demotions you've changed your mind
  about.
- **It is deliberately not in `StatusSyncSettingsSchema`.** It is bookkeeping,
  not a setting, and putting it there would make it writable through
  `UpdateStatusSyncInput`.

### Every automatic change says so

The other half of the fix, and the more important one: **the app tells you when
the rule moved something.** Copy lives in `describeStatusSyncNotice` /
`describeStatusSyncSweep` (`packages/shared`), so the phone and the laptop
cannot word the same event differently, and so it is testable in node — which
on mobile is the only place anything is.

- `TasksApi.create`/`update` return an optional `autoSync: { …, notice }`
  alongside `{ data, error }`. Returned rather than inferred: the interesting
  write is the one that sent *only* a date and got a status change too, and a
  caller reconstructing that would have to hold the prior row.
- `syncScheduledToStatus` returns `notice` and the rows it moved.
- **A create only reports when it overrode an opinion the caller had.** Landing
  in Next with no status asked for is the default arriving, not the rule taking
  something away — and a toast on every quick-add is how a feature gets
  switched off.
- **Mobile routes it through `lib/auto-sync-notice.ts`**, a module-level
  notifier the root installs, because `task-queries.ts` and `status-sync.ts`
  are plain modules and cannot call `useUndoToast`.
- **Web announces it on a window event** (`lib/auto-sync-events.ts`), same
  reasoning as `task-delete-events.ts`: there is no single web write door.
  Fifteen components call `getClientTasksApi().update()` directly, so the
  announcement is made by a Proxy in `tasks-client.ts` — the seam they all get
  their API from, and the same seam demo mode hangs on. A Proxy rather than a
  subclass, because `TasksApi`'s methods call each other (`complete` goes
  through `update`) and a subclass would announce one write twice.

"Today" is resolved through `user_preferences.timezone`, never the process
clock. See the timezone note under Dates above.

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
pnpm typecheck            # Type-check all packages (NOTE: skips apps/mobile)
pnpm --filter web dev     # Start web app only
pnpm --filter mobile start  # Start Expo dev server (then `a`=android, `i`=ios)
pnpm --filter @do-done/mcp build  # Build MCP server
```

`pnpm typecheck` does not cover `apps/mobile` — it has no `typecheck` script.
Run `npx tsc --noEmit` there yourself.

### Running the app to look at it

`.claude/launch.json` names the servers an agent starts with `preview_start`
(`web`, `mobile`, `storybook`, `mcp`). **Never launch a dev server with a bare
shell command** — nothing can find it afterwards.

**The `web` entry sets `"autoPort": true` deliberately.** Worktrees are a normal
way to work here, so a second session is often already holding port 3000. Without
the flag the server refuses to start and there is no way to see the change at
all. With it, 3000 is still used whenever it is free; the flag only engages in
the case whose alternative is nothing.

**The cost: connecting Google Calendar only works on port 3000.**
`api/calendar/connect` builds its `redirectUri` from the request origin, and
Google Cloud Console has only `http://localhost:3000/api/calendar/callback`
registered, so any other port returns `redirect_uri_mismatch`. Free 3000 before
testing that flow. Nothing else is port-sensitive: `APP_URL` is pinned to the
deployed URL even locally, so the MCP OAuth issuer doesn't vary with the port,
and the mismatch fails loudly on your *own* origin rather than quietly landing on
another session's server.

`README.md` and `docs/HANDOFF.md` both say `localhost:3000`, so the port the tool
prints can disagree with the docs. The printed one is right.

**Verify against `/demo`, not a login wall.** It needs no session and seeds its
own data — see *The demo sandbox*. Copy `.env.local` and `apps/web/.env.local` in
from the main checkout first: a worktree has neither, and without them the auth
proxy 500s on every route, including `/demo`.

## Code style

- Strict TypeScript everywhere. No `any`.
- Validate with Zod schemas from `@do-done/shared`.
- ES modules (`"type": "module"`); use the `.js` extension in imports.
- Functional React components with named exports.
- Access data only through `@do-done/api-client`. Never write raw Supabase
  queries in an app.
- Check `.error` on every Supabase response. Never assume success.

## Database

Supabase PostgreSQL with row-level security. Migrations live in
`supabase/migrations/`. Key tables: tasks, projects, locations, task_locations,
calendar_sync, user_preferences. All tables use UUID primary keys and a
`user_id` column for RLS.

### Two migrations must never share a version number

Supabase keys `schema_migrations` on the 14-digit prefix alone — not the
filename, not the contents. If two branches both add a migration numbered
`20260815000002`, the first one pushed claims the number and `supabase db push`
then treats the second file as already applied: it skips it and exits 0. The
migration never runs and nothing reports a failure.

This happened. `20260815000002_aisle_memory.sql` and
`20260815000002_status_sync_sweep_watermark.sql` were concurrent PRs, the
watermark reached the ledger first, and `list_term_aisles` was missing from
production while every push reported success. Nothing surfaced it, because
`AisleTermsApi.load()` returns an empty map when the read fails — the feature
degrades to its own fallback by design.

`tools/check-migrations.mjs` fails the build on a duplicate version, and
`.github/workflows/migrations.yml` runs it on every PR. A pull request is
checked out as the merge commit, so both branches' files are in the tree and the
collision is caught before either can be applied. **When you add a migration,
number it past every version already in the ledger** — check `supabase migration
list --linked`, not just the files on your branch.

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

- SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
- NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
- POWERSYNC_URL
- GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
- DO_DONE_USER_ID (for the MCP server)

Mobile reads `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` from
`apps/mobile/.env` — the same project under the names `lib/supabase.ts` reads.

## MCP server

One implementation (`packages/mcp-server`), two transports:

- **stdio** — `apps/mcp/dist/index.js`, registered in `~/.claude.json` for
  Claude Code.
- **Streamable HTTP** — `apps/web/src/app/api/mcp/route.ts`, deployed with the
  web app and added in Claude as a custom connector pointing at
  `https://<your-app>/api/mcp`.

The HTTP endpoint is stateless: it builds a fresh `createDoDoneServer()` per
request, bound to the authenticated user. That per-request construction is
required, not an optimisation — the tool registrars capture their user id when
they are constructed.

**Anything here that touches dates must say which date it means.** DoDone
schedules on `scheduled_date` and almost never sets `deadline_date`, so a client
that treats "dated" as "has a deadline" reports a full week as empty. Tools
answer date questions through `get_agenda`, emit every date with its relative
reading, and resolve "today" through the user's timezone rather than the process
clock (which is UTC when hosted). See `packages/mcp-server/CLAUDE.md` → Dates.

### OAuth

Claude's custom-connector form accepts a URL and an optional OAuth client
id/secret, with nowhere to put a static token. So the web app is also an
OAuth 2.1 authorization server:

```
/.well-known/oauth-protected-resource[/api/mcp]  RFC 9728 — discovery entry point
/.well-known/oauth-authorization-server          RFC 8414 — endpoint directory
/api/oauth/register                              RFC 7591 — dynamic client registration
/oauth/authorize                                 consent screen (needs a session)
/api/oauth/authorize                             records the consent decision
/api/oauth/token                                 code + refresh grants
/api/oauth/revoke                                RFC 7009
```

The implementation is in `apps/web/src/lib/oauth/` (`crypto.ts`, `store.ts`,
`config.ts`). State lives in the `oauth_*` tables, which have RLS enabled and no
policies, so only the service role can reach them.

Rules that must not be relaxed:

- **PKCE S256 is mandatory.** Clients are public, so this is what secures the
  code grant. "plain" is rejected.
- **Codes and tokens are stored only as SHA-256 hashes, and are single-use.**
  Redemption and refresh rotation are atomic conditional UPDATEs, not
  read-then-write.
- **Redirect URIs must match exactly**, with the RFC 8252 loopback-port
  exception for native clients. Never prefix-match.
- **A bad `client_id` or `redirect_uri` renders an error, never a redirect.**
  Redirecting to an unvalidated URI is how an authorization server becomes an
  open redirector.
- `MCP_BEARER_TOKEN` is an optional static fallback (scoped to
  `DO_DONE_USER_ID`) for Claude Code's `--header` flag. Unset it to require
  OAuth.

`APP_URL` pins the OAuth issuer and must be the URL clients actually reach. The
OAuth paths and `/api/mcp` are in `PUBLIC_PATHS` in `proxy-helper.ts` so the auth
proxy doesn't redirect them to `/login`. `/oauth/authorize` handles its own
session check so it can round-trip through `/login?next=…`.

> Hand-editing `claude_desktop_config.json` does not work on Claude Desktop
> v1.22209.3 — the app rewrites that file and strips `mcpServers`. Its Chat tab
> sees remote connectors only. Use the hosted endpoint for Chat, and the Claude
> Code tab for the local stdio server.

## Public routes (web)

Two routes work without a session. Both are listed in `PUBLIC_PATHS` in
`proxy-helper.ts`. `/` is matched **exactly** — every other entry there is a
`startsWith` test, and `"/"` is a prefix of everything.

| URL | What it is |
| --- | --- |
| `/` | The landing page: marketing plus the sign-in form. A signed-in visitor gets "Open DoDone" instead. It used to `redirect("/inbox")`, which made the app's front door a bare login form. |
| `/demo` | The whole app, running against an in-memory sandbox. |

### The demo sandbox

`tasks.user_id` is a foreign key onto `auth.users`, so anything database-backed
needs a real user per visitor. The options were one shared login that any
passer-by could wreck for everyone, or anonymous sign-ins — which are disabled
on the project and would create a row per crawler. The sandbox avoids both,
needs no environment variables, and works on every preview deploy. It also gives
Claude a way to drive the real UI, which the login wall made impossible.

- **`lib/demo/mode.ts` decides demo-ness from the URL**, not from a cookie or a
  context. `getClientTasksApi()` is called from deep inside components that know
  nothing about where they are mounted; the path is the one thing always
  available to them.
- **`lib/demo/api.ts` holds stand-ins for `TasksApi` / `ProjectsApi` /
  `UserPrefsApi` over a plain array.** They are not a fake `SupabaseClient`:
  faking the client would mean reimplementing PostgREST, `.or()` filter grammar
  and all, to arrive back at the same array operations. They reach callers
  through a cast, so nothing type-checks them at the call sites. `api.test.ts`
  sweeps both prototypes instead — a missing method is a runtime `undefined is
  not a function` that only ever fires in the demo.
- **The seam is `tasks-client.ts` / `projects-client.ts` /
  `user-prefs-client.ts`.** Every web mutation already went through those, so
  swapping the object is all it takes and no component knows it might be in a
  demo. Three components used to construct `new TasksApi(createClientSupabase(),
  …)` inline and now go through `getTasksApiFor(userId)` /
  `getProjectsApiFor(userId)`. A fourth doing that would silently bypass the
  demo.
- **`lib/demo/store.ts` is the database**: one immutable object, mirrored into
  **sessionStorage** so a link shared with a room full of people gives each of
  them their own copy, and re-seeded when its `seededFor` day goes stale.
  Replacing the whole object on every write stands in for the `router.refresh()`
  the real app relies on — a refresh here would re-run a server component that
  has nothing to say.
- **Demo screens render nothing until `useDemoData().ready`.** The seed is dated
  from the reader's calendar day and the server's day is UTC, so anything
  date-shaped rendered server-side would be a hydration mismatch.
- **`SidebarNav`, `SortableProjectList`, and `taskPath()` prefix their links
  with `/demo` when inside it**, derived from `usePathname()` rather than passed
  down. A bare `/today` would bounce the visitor to the login wall the demo
  exists to avoid. Settings is dropped from the demo nav (there is no account
  behind it), and `AppShell` takes `userEmail={null}`, which suppresses the Pip
  panel — Pip reads its state from the database.

## `#` in a title: project first, tag otherwise

A `#token` is matched against the user's own project list, Todoist-style.
`#groceries` files the task into **Groceries** if that project exists, and
becomes a tag if it doesn't.

Precedence inside a token is fixed: `#xs`…`#xxl` (estimate) → `#p1`…`#p4`
(priority) → project → tag. So a project named "M" loses to the size code rather
than shadowing it.

Three pieces read the same text and **must agree**:

- `parseTaskInput` (`packages/task-engine`) parses a whole quick-add string at
  submit.
- `extractTitleShortcuts` (`packages/shared`) runs on every keystroke in the
  title fields.
- **Every "+ tag" control** — the two task editors and mobile's quick-add chip
  row — classifies the bare word it is handed.

All three take the project list as an *optional* argument and delegate the match
to `matchProject` in `packages/shared/src/project-match.ts`. Omit the list —
Storybook, the mobile widget root, any surface with no projects available — and
every token is a tag, exactly as before.

**The "+ tag" field is a `#token` without the `#`.** It classifies its word
through `classifyShortcutToken` on the same size → priority → project → tag
ladder. It used to store whatever was typed, so `#personal` in the title filed
the task into Personal while `personal` typed into the tag box two inches away
created a tag of the same word — and `p1` there created a tag literally named
"p1". A classification rule the user can't see must be the same rule everywhere
it can be reached, so it is a shared function rather than a comment.

- **Match on a normalised key** (lowercase, alphanumerics only). A token is
  `\w+` and can never contain a space, so without normalising both sides every
  multi-word project would be unreachable by typing. `#sideproject` and
  `#side_project` both reach "Side Project". A name that normalises to nothing
  (emoji only) matches nothing rather than everything.
- **The surfaces differ in where the match lands.** Mobile's absorber fills the
  Project *chip*, the same way it already fills Priority and Estimate. Web has
  no absorber in quick-add, so the match shows in `ParsedPreview`, which updates
  as the text changes, and the chip stays the explicit override — exactly as
  typed `p1` has always behaved there.
- **A typed project beats the section's**, same as priority: adding inside
  "Work" and typing `#home` means Home. An explicit chip still beats both.
- **The parse needs a project list, so on web it reads `QuickAddProvider`**
  (`useQuickAdd` → `useQuickAddContext`) rather than a prop. That is why a
  project created inline from the quick-add modal is also registered with the
  provider — otherwise it couldn't be typed by name until the next page load.

`/name` resolves against the same list. Unmatched, it stays the bare name it
always was (`parsed.project`); only `parsed.project_id` ever reaches a task.

## Tags: listing them and filtering by one

**A tag is not a row anywhere.** `tasks.tags` is a bare `text[]` — no tag table,
no join table, no per-user registry. So "the user's tags" is a question only the
task list can answer, and a tag exists exactly as long as some task carries it.
Everything below follows from that.

`summarizeTags` in `packages/shared/src/tags.ts` is the single answer: rows in,
one `TagSummary { tag, task_count, open_count }` per distinct tag out, ordered by
open work then alphabetically. Web's index, mobile's, the demo sandbox, and the
MCP tool all call it, so a count can't mean one thing on the phone and another on
the laptop.

| Surface | Where |
| --- | --- |
| Web | `/tags` (sidebar) → `/tags/<tag>`; every tag chip on a row links to the latter |
| Mobile | Projects tab → tag button, and Settings → Tags → `/tags/<tag>` |
| MCP | `list_tags`, plus a `tags` filter on `list_tasks` |

- **Matching is exact, including case.** `#Work` and `#work` are two tags — in
  the column, in `applyDisplay`'s tag filter, and in PostgREST's `overlaps`.
  Folding case in the index alone would make a card's count disagree with the
  list that card opens, which is the one thing an index of counts must never do.
  Normalising tags where they are *written* is a real change and a separate one.
- **Counts come from a sweep of the task rows, not from a loaded list.**
  `TasksApi.listTags()` selects two narrow columns with no `.range()` — the same
  shape and cost as `ProjectsApi.listWithCounts`. The per-view `availableTags`
  that feeds the Display menu's tag pills is a different thing and stays as it
  is: it can only see the slice on screen, which is right for narrowing the list
  in front of you and useless as an index of what exists.
- **`TasksApi.listByTag` uses `overlaps("tags", …)`** — the first caller of the
  `idx_tasks_tags` GIN index, which had been dead since it was created.
  Filtering a fetched page in the client would silently miss everything past the
  limit, which on a tag view is the entire point of the page.
- **A tag view is an ordinary list**, so web hands it to `TaskDisplayView` and
  the whole Display menu works. `viewKey` is the bare `"tag"`: one saved config
  for the surface, not one per tag, or the preference would reset every time a
  new tag was coined.
- **No quick-add on a tag view, on either platform.** Nothing in the composer
  seeds a *tag*, so a task typed there would be created without one and drop
  straight out of the list it was typed into — the bug the Today bar had before
  `contextFacets`.
- **A missing tag is not a 404.** "Never existed" and "nothing carries it any
  more" are the same state, so `/tags/<gone>` renders an empty view that explains
  itself. A link from a task someone just untagged has to land somewhere.
- **The tag chip is the one chip on a web row that navigates rather than
  edits.** Every other chip opens a popover in place, so this is a `Link` that
  stops the click reaching the row — otherwise the editor would open over the
  page it just navigated to. It shows its `#` now that it goes somewhere.
  **Mobile rows show no tags**: that row collapses everything into
  `rowSubline`'s single line of prose by design (see *The task row*), and a
  tappable chip would be the first thing to break that.
- **Mobile's tag summary is its own query root** (`tagKeys`, not under
  `taskKeys`). The optimistic `setQueriesData<Task[]>` sweeps rewrite anything
  under `taskKeys.all`, and this cache holds `TagSummary[]`. `invalidateTasks()`
  invalidates it explicitly, since any write can move a count.
- **MCP can now read what it could already write.** `create_task` and
  `update_task` have always accepted `tags` while nothing could list or filter by
  them, so an agent could only guess at spellings. `search_tasks` still won't
  find a tag — tags are not in the `fts` vector — which is why `list_tags`'
  description says so.

## Linking to a task (web)

Every task has an address, and the editor keeps the address bar accurate:

| URL | What it is |
| --- | --- |
| `/task/<id>` | Canonical and context-free. What "Copy link" hands out, and what a recipient opens: a standalone page. |
| `/inbox?task=<id>` | The editor, mirrored onto the view it was opened from. Written while the modal is up, so the address bar is always shareable and Back closes the modal. |

`OpenTaskProvider` (`apps/web/src/lib/open-task.tsx`) owns *the* editor for the
whole authenticated app. It is mounted once in `(app)/layout.tsx`, not per row,
for two reasons: a link can open a task with no row on screen, and a task showing
in two lists still opens exactly once.

It writes the URL with the **native History API**, not `router.push`. A router
navigation would re-run the underlying list's server components on every row
click and change nothing — the list is already rendered, and the editor is a
layer above it. `popstate` keeps state and URL in agreement.

`TaskItem` falls back to its own local modal state when the provider is absent
(Storybook, unit tests), which is why `useOpenTask()` returns null rather than
throwing.

The auth proxy carries the destination through sign-in (`?next=`), so a task link
handed to someone signed out survives the login round-trip. `safeNext` on the
login page stops that being an open redirector.

## Click feedback (web)

**Every route under `(app)` needs a `loading.tsx`.** This is not optional polish.
These routes are dynamic server components — auth comes from cookies, rows from
Supabase — so without a fallback Next.js skips prefetching them *and* blocks the
entire client-side transition until the server render lands. Clicking a sidebar
item changed nothing on screen for a second or two: not the rows, not even the
active pill, because `usePathname()` only updates once the navigation commits.
Nothing was producing feedback at all. The fallback is what lets the transition
commit on the click, and it enables partial prefetching, so most navigations then
land instantly.

Feedback has three layers, each covering what the one before it can't:

1. **`active:` styling** on every sidebar row (`PRESS` in `sidebar-nav.tsx`).
   CSS only, so it fires on pointer-down, before React or the network. Note the
   explicit short duration: Tailwind's default 150ms is tuned for hover and reads
   as lag on a press. Project rows get the background but **not** the scale —
   they are also dnd-kit drag handles, and an inline `transform` can't share the
   property with a utility class.
2. **The active pill moving**, the moment the transition commits — which the
   `loading.tsx` files make immediate.
3. **`NavPendingDot`** (`useLinkStatus`), only for when the shell hasn't
   prefetched and the click really is waiting on the network.

Layers 1 and 3, and the skeletons, start invisible and fade in after ~140ms
(`.dd-skeleton`, `.dd-link-pending` in `globals.css`), so a navigation faster
than that shows no placeholder rather than a flash. The skeletons carry the real
page title in the real type and the geometry of a real task row, so the
destination is readable on the first frame and the swap is a fill-in rather than
a jump. That is also why `PageSkeleton` takes `maxWidth` (`/calendar` is
`max-w-7xl`, everything else `max-w-3xl`).

**One CSS trap, already paid for: don't drive the pending dot with a fade-in
animation plus a pulse animation.** Two animations on `opacity` means the later
one wins outright, and a pulse whose `0%`/`100%` frames are implicit resolves
them to the *underlying* opacity — 0 here. The dot pulsed between invisible and
almost invisible. It is now one keyframe set whose first quarter is the fade-in.

`app-shell.test.tsx` mocks `next/link`, so that mock must export `useLinkStatus`
or every test in the file dies on the nav rows.

## Cold start (mobile)

**"Nothing scheduled today" is an answer, and the app must not give it before it
has one.** The mobile query cache is in memory, so every launch began with
`data === undefined` on every list, and every screen rendered its empty state
into that gap. The app opened by telling the user their day was clear, then
quietly filled in. Web never had this problem: its pages are async server
components, so the rows arrive with the HTML.

Three pieces, all under `apps/mobile`:

- **`lib/query-persist.ts`** writes the query cache to AsyncStorage, restored by
  `PersistQueryClientProvider` in `app/_layout.tsx`. Launch opens on the rows the
  user last saw, refreshed underneath. A snapshot older than `CACHE_MAX_AGE_MS`
  (24h) is dropped rather than shown. **`gcTime` in `query-client.ts` is the same
  24h and must stay in step** — otherwise a restored list for a tab the user
  hasn't opened is garbage-collected before it is ever observed, and the next
  write-out persists the cache without it.
- **`lib/list-load-state.ts`** decides skeleton vs. empty vs. error, once, for
  every list screen. `hasData` is `data !== undefined`, **not** `length > 0`: a
  restored empty list is a real answer and gets the empty state, while a cache
  that has never held one gets the skeleton. It is a plain function over a plain
  input because `apps/mobile` has no renderer to test a hook with.
- **`components/ListPlaceholder.tsx`** draws it: `ListSkeleton`, an `UpdatingBar`
  that delays itself ~350ms (`useRefreshOnFocus` refires every query on every tab
  switch, so a bar bound straight to `isFetching` strobes), and `ListError`,
  without which an offline first launch pulses a skeleton forever.

**That bar is the only signal a background refresh gets.** `RefreshControl`'s
spinner belongs to the *gesture*, so every list drives it from `usePullToRefresh`
(`lib/query-client.ts`) rather than from the query's `isRefetching`. The
obvious-looking `refreshing={isRefetching}` hits the same `useRefreshOnFocus`
trap: a refetch fires on every tab switch, so the platform drew its
pull-to-refresh circle — a control the user is meant to have *dragged* into view
— unprompted at the top of every list on every tap of the tab bar.

**The cache is restored only for the account that wrote it**, and that check
lives *inside* `restoreClient`, not in the auth listener. Restore and the auth
event resolve independently, so clearing after the fact is a race the previous
user's rows can win.

## Dragging a row (mobile)

**The hold is the drag, and there is no handle.** A row can be asked to do three
things and has one body to ask with, and reordering is the one that *must* be a
hold — `DraggableFlatList` needs the finger still down when `drag()` is called,
so it cannot be a tap. Multi-select used to own the hold, which is why every row
carried a `reorder-three` grab handle: dragging had to be given somewhere else to
live, and that somewhere was ~36px of horizontal space on every row of every
list, spent permanently on the *rarer* of the two actions. The handle is gone and
the hold reorders, matching the projects list, which has long-pressed to reorder
since it was written.

Multi-select is now an explicit mode, armed from **`ListActionsMenu`** — the ⋯
button in each list's top bar — and left with Done on the bulk bar. That is the
right trade for a mode: it is asked for rather than fallen into, and the gesture
it used to occupy was one the finger reached for constantly while trying to move
a task.

- **`lib/row-gesture.ts` holds the rule as two pure functions**, tested in node
  like the rest of `lib/` (there is no renderer here). `rowLongPressAction`
  returns `'drag'` only on a list that can reorder and only while selection is
  *not* armed: a row in selection mode is a target and nothing else, since a drop
  would rewrite the task the user is in the middle of picking — the same reason
  the swipe panels are disabled there.
- **`onLongPress` is `undefined`, not a no-op, when there is nothing to hold
  for.** A `Pressable` carrying an `onLongPress` swallows the press that would
  otherwise have fired `onPress`, so a list that can't reorder (search,
  Completed) would eat a slow tap.
- **`isActive` on `TaskSelectionValue` is its own flag**, no longer
  `selectedIds.size > 0`. The menu arms the mode with nothing picked yet, and
  under the old derivation that state was indistinguishable from "not selecting"
  — the rows would not have become targets and the first tap would have opened
  the editor.
- **`BulkActionBar` appears with the mode, not with the first selection**, since
  it is both the confirmation that the ⋯ item was heard and the only way out. Its
  five buttons are withheld until something is picked; a row of controls that
  would do nothing to nothing invites the tap that proves it.
- **A few top bars got shorter rather than longer.** Today's Completed and
  Settings, and All's Completed, moved into the ⋯ menu: they are destinations
  rather than actions on the list, and five indigo icons beside "Today" was the
  bar competing with the day. The menu opens as a bottom sheet, like every other
  menu in the app — an anchored popover would have to know the height of two
  different kinds of header, and the sheet lands under the thumb.

The cost is discoverability: nothing on the row now says it can be dragged. That
is already true of the projects list, and the alternative was a permanent visual
tax on every row for a hint each user needs once.

**The query cache has to agree with the finger before the write goes out, not
after.** `SectionedDraggableList` keeps a local copy of the order so a drop lands
instantly, but it re-seeds that copy from `sections` — that is, from the cache —
on any change to any task in view. So while the cache holds the pre-drag order,
the list is one cache write away from re-laying itself out into it and back.

A cross-section move used to guarantee exactly that. It was
`updateTask(id, patch).then(() => reorderTasks(ids))`: two writes, each with its
own optimistic patch and its own `invalidateTasks()`, and only the second one
carried the order. The first patch landed a cache that agreed the task had moved
section but still carried its old `sort_order` — the only thing that decides a
row's place *within* a section (`TasksApi.list` orders by it alone, and
`generateFocusList` breaks ties by it). So the row appeared in the wrong slot,
the list re-rendered around it, then did it twice more as the two refetches came
back. Three full re-layouts in about a second, which is what read as the whole
screen flashing.

- **`moveTask(id, input, orderedIds)`** in `lib/task-queries.ts` is the one door
  for a drag that both re-files a task and re-orders its destination: one
  optimistic apply of *both* halves, both writes, one invalidate. All four
  cross-section drag handlers (Today, Upcoming, and both branches of
  `GroupedTaskList`) go through it.
- **`reorderTasks` patches the cache too**, via `patchCachedOrder`, which stamps
  `sort_order` and re-sorts. That reproduces what the refetch will return, so the
  reconcile is a no-op rather than a second opinion.

`lib/task-move.test.ts` asserts on the cache *mid-flight*, with the writes held
open, because the settled state was never the problem.

The other half of a drag's aftermath is the refresh spinner, covered one section
up: every one of these invalidates used to drop `RefreshControl`'s circle over
the list, landing it on the row the finger had just released.

### Every optimistic sweep goes through `patchTaskLists`

**Not every cache under `taskKeys.all` holds a `Task[]`.** `useParentTask`
caches a *single* task under `taskKeys.detail(id)` — the "↳ parent" breadcrumb
on a subtask row — and `{ queryKey: taskKeys.all }` matches it by prefix. Every
optimistic updater in `lib/task-queries.ts` is array-shaped (`old.map`,
`old.filter`, `.sort`), so all of them met it with `is not a function`.

That throw leaves *no trace whatsoever*. It comes out of `setQueriesData`
synchronously — before the `try` that owns the write and before the `finally`
that invalidates — and every caller swallows the rejection. `setQueriesData`
walks the cache in insertion order, so the lists it reached first kept their
optimistic patch. The row left its list, nothing was ever sent, and the task
was still sitting where it started when the next screen was opened. One subtask
row anywhere on screen was enough, and the detail cache then outlived it
(`gcTime` is 24h, and it is persisted), so swipe-to-Tomorrow, delete and every
bulk action stayed dead for the rest of the session.

- **`patchTaskLists(updater, scope?)` is the one door**, and it skips anything
  that isn't an array; `cachedTaskLists()` is the read side. A guard rather
  than a narrower key filter, because the invariant is one any future query can
  break again just by caching a task on its own.
- **`taskKeys.detail` is named beside the list keys** so the exception is
  visible next to the rule it breaks, instead of spelled out inline at the hook.
- **A skipped cache is reconciled by `invalidateTasks()`** like everything else,
  so the breadcrumb still follows a renamed parent.
- **The swipe panel's Today / Tomorrow now says when a write fails.** The row
  leaving the list is the entire feedback that gesture gives, so a silent
  `.catch(() => {})` there made a reschedule that sent nothing at all look
  exactly like one that worked. `lib/task-cache-shape.test.ts` is the
  regression, and it asserts the *write went out*, not just the settled cache.

## The task editor sheet (mobile)

**Everything under the finger runs on the UI thread.** The sheet's rise, its
drag, and the backdrop's dimming are one Reanimated shared value — `translateY`,
in pixels below the sheet's resting place — written by worklet gesture handlers
and read by two `useAnimatedStyle`s. Nothing about the motion crosses into JS
until the sheet is off-screen and there is a close callback to fire.

It used to be a plain `Animated.Value` with `useNativeDriver: false` and a
`runOnJS(true)` pan, which put every frame on the JS thread — the same thread
the editor mounts on. Opening a task fires three requests, lays out a month grid,
and used to mount six nested `Modal`s, all inside the 280ms the open animation
had to run in. The animation lost every time.

- **`lib/sheet-motion.ts` holds the policy as pure worklets**, tested in node
  like the rest of `lib/`: when a release dismisses (a *projected* rest position,
  so a short fast flick counts and a flick back up never does), how long the
  closing sweep takes (velocity-matched, so a flicked sheet doesn't decelerate
  the instant the finger leaves), and the backdrop's opacity for a position. The
  `'worklet'` directives ship those to the UI thread; `babel-preset-expo` adds
  `react-native-worklets/plugin` on its own, and under vitest the directive is an
  inert string.
- **`SHEET_HEIGHT_RATIO` and `styles.ghRoot.height` must stay in step.** The
  slide is measured against the ratio, so a sheet taller than its travel never
  fully leaves the screen.
- **The height a worklet reads must be a `SharedValue`, not a ref.** Reanimated
  copies captured values into the UI runtime, so `ref.current` read from the
  memoised gesture is whatever it was on the first render, forever.
- **The backdrop is derived from the sheet, never animated alongside it.** It was
  a flat `rgba(17,24,39,0.4)` under `animationType="none"`, so the room went dark
  in a single frame while the sheet was still off the bottom of the screen, and
  came back only after it had finished leaving. Deriving it is also what makes it
  follow a *drag*: half dismissed is half lit. The style's colour is opaque now;
  restoring the alpha would multiply the two.
- **The body owns the drag until it has nothing left to scroll.**
  `activeOffsetY(12)` claims downward drags, which is also how you scroll a list
  back up, so the pan samples the ScrollView's offset in `onBegin` and stands
  down unless it was already at the top. Without that the editor lurched toward
  the floor instead of scrolling.

Two render-cost rules, both because **the editor re-renders on every keystroke in
the title** — autosave holds the task in React state:

- `ScheduleCalendar` and `SubtasksSection` are `React.memo`ed and their props
  kept stable. `SubtasksSection` takes `parentId`/`parentDepth` rather than the
  parent `Task` for exactly this reason: a `Task` prop is a new object on every
  keystroke and would defeat the memo on the renders it exists to skip.
- Nested pickers are mounted only while they are open. Six of them used to live
  permanently inside every open editor, each rebuilding its option rows per
  keystroke and holding a host view it never showed.

## Ticking a task off

The most repeated gesture in the app, and one shape on both platforms. Timings
and rules live in `@do-done/shared`, because the two implementations have nothing
else in common (CSS plus inline styles on web, Reanimated worklets on mobile) and
the constants are the only thing keeping them from drifting.

```
-90 →   0   the ring flinches under the press          anticipation
  0 → 220   the check springs and the ring fills
 20 → 360   a hairline halo rings out and dissolves    anticipation
 40 → 230   the strike-through is drawn, left to right
  0 → 400   sparks, on a completion that earned one    gated
420 → 680   the row slides right as its height closes  exit
```

**Nothing may outlive the 680ms envelope.** That keeps `TASK_COMPLETE_EXIT_MS`
governing every list drop and leaves the write path, the hold, the per-id
chaining, and the undo window untouched. `completion-motion.test.ts` asserts the
relationships rather than the numbers: the line finishes with the check (230
against 220 — one is the control acknowledging the tap, the other the text, and
the eye may be on either), and everything inbound lands before the hold ends.

**The spark burst must finish inside the *hold*, not just the envelope.** The row
turns on `overflow: hidden` the moment it starts collapsing, so a particle still
in the air is sliced off at the row's edge as it shrinks. `SPARK_MS` is 400
against a 420ms hold. The stagger is spent *within* that, never added to it — a
particle that starts late flies for less time — so all ten land on the same
frame. Web varies each particle's `animation-duration`; mobile re-bases each one
off the single shared progress value.

**Two platform differences that look like drift and aren't:**

- Web hangs the squash off `:active`, so it really is the press, firing on
  pointer-down ahead of React. Mobile folds it into the completion, because a
  22px ring is under the thumb at exactly the moment a press-driven squash would
  be visible, and swipe-to-complete has no press at all.
- React Native cannot animate `textDecorationLine`, so `StruckText` draws the
  rule itself from `onTextLayout` line rects behind one widening clip. Web uses
  an inline background gradient that fragments per line, so each rule ends where
  its line's text does.

**The halo and the burst mark a *moment*, not a state**, and are rendered only
for the frames they run in. Keying either off "is completed" would set every row
in a Completed list going the instant the page painted.

### When the sparks fire

Celebrating every completion turns a delight into a tax — by the fortieth task of
the week it is something you wait out, and the next request is a switch to turn
it off. `sparkReason` is the gate. It returns *why* rather than a boolean, so
tests can assert the reason:

| Reason | Fires when |
| --- | --- |
| `project-finished` | the last open task in the project |
| `last-in-section` | the last open task in this list's section |
| `streak` | the first completion of a day whose predecessor also had one |
| `effort` | estimated at two hours or more |
| `priority` | P1 or P2 (`p2`'s label is "High") |

Finishing outranks what finished it: the last task in a project being a two-hour
P1 makes the moment the project ending, not the task's size.

**A row cannot know it emptied a section, so its surroundings tell it.** Web
publishes counts through two contexts in `task-row-behavior.tsx`. Section and
project are provided at different depths — a project page groups by status, so
the project's last open task is not the last in any group — and one context would
have the inner erase the outer. Mobile passes props, matching the split already
documented on `keepsCompleted`.

**A missing count means "this surface can't tell" and is deliberately different
from zero**, so the inbox, search, and the drag overlay never fire those rules
rather than firing them wrongly. Counts are read at the tap, not at render: by
then the row has already told its list it is done.

**Streak needed a data model that did not exist.** `tasks.completed_at` is the
only substrate and nothing aggregated it. `packages/shared/src/streak.ts` buckets
timestamps into the reader's *local* days (a task finished at 11pm belongs to the
day the user was living in), and `claimStreakDay()` both answers and records in
one call. One call rather than a read plus a note, because *any* completion
starts the day — splitting them would let a second completion moments later claim
it again. It is claimed only when completing; reopening is a correction and must
not mark a day nobody worked. The history is fetched once per session (a provider
on web, a module singleton on mobile) and read synchronously, because the row
decides inside the tap handler, where an `await` would cost the frame the
animation exists to use. Not loaded means `false`: an unknown history costs a
burst rather than inventing one.

**Reduced motion lands on the end state and drops the decorative layers** on both
platforms. It never simply plays slower.

One trap already paid for: putting the drawn rule on the text means axe stops
measuring that text's contrast (`color-contrast` skips anything with a
background-image), so five pre-existing findings on completed titles went quiet
without the rendering changing. Noted in `globals.css` — that contrast is ours to
watch now, not axe's.

## Shopping lists

A list of things to buy is not a project and not a note. People keep them in
Apple Notes and Google Keep because a task app makes twenty words cost twenty
rows of ceremony — and then pay a different tax, because the grocery list sits
in the same drawer as everything they are trying to think about.

**An item is a task. A list is a project with a `kind`.**

```
projects.kind = 'tasks' | 'list'
tasks.is_list_item        derived from it, by trigger
```

A thing you are going to buy genuinely *is* a small task: it gets ticked off, it
can carry a photo of the label, it can be moved, and it has to come back when
you tap it by mistake while walking. All of that exists and is already careful.
A list is *not* a task — a task is finished once, and a shopping list is
**standing**: it empties and refills forever. As a task it would be a
permanently open row or a recurrence pretending this Saturday's groceries are
last Saturday's work.

`TasksApi` being the one door web, mobile and MCP write through is what decided
it. Undo, the optimistic cache patch, the 680 ms completion gesture, offline
persistence, attachments, the widgets — a `list_items` table doesn't cost a
migration, it costs re-deciding all of those and re-deciding them again each
time one changes. And `matchProject` means `milk #groceries` filed into a list
the day the column landed.

### The isolation is one flag, carried by one door

`tasks.is_list_item` is **derived, never written by a caller**:
`task_sync_is_list_item` sets it from the project on insert and on every
re-parent, and `project_cascade_kind` re-flags a whole project when its kind
changes. Denormalised rather than joined because PostgREST cannot express
"where the project's kind is not 'list'" — an embedded `projects!inner(kind)`
drops every task with no project at all — and because *a rule you can forget is
a rule that shows someone their groceries in Today*.

`TasksApi` grew a third door beside `read()`:

| | Sees |
| --- | --- |
| `base()` | live rows of both kinds. Only the two below may call it. |
| `read()` | the task universe. All fifteen existing reads, unchanged. |
| `readItems()` | shopping-list items. `listItems`, `listCounts`, `clearGot`. |

**Reads by *id* deliberately use `base()`.** The isolation is about lists of
tasks, not about addressing one: an item has a `/task/<id>` link and opens in
the editor, so `getById`, `update`'s prior-state read and `subtreeIds` would
otherwise 404 on rows the app itself had just linked to.

Four rules that aren't in that function:

- **An item never enters the task universe** — not Inbox, Today, Upcoming, All
  or Focus. `filterTasks` carries the same condition as a second lock, and as
  the *first* one for anything that builds a list without the API (the demo
  sandbox reads its store directly). `DisplayContext.includeListItems` is the
  explicit opt-in; it is **not** a `DisplayConfig` field, so it can never light
  the "Filter · N" badge or be persisted into a saved view.
- **A list is one row, never forty.** The only way a list reaches Today is a
  trip you deliberately scheduled.
- **Buying bananas does not celebrate.** `sparkReason` returns null for an item
  — `openInProject === 1` is the last item of *every* grocery run, forever, so
  the most repeated action in the app would become the most celebrated one. The
  gate is inside that function so neither row component can forget it. The
  streak is gated at the two call sites instead, because `claimStreakDay()` has
  a side effect and has to be turned away *before* the call.
- **Lists don't count.** `busyness`, the pet's project and tag tallies and its
  last-activity proxy all carry `is_list_item = false` explicitly, since none of
  them go through `TasksApi.read()`.

The calendar trigger learned the same clause: a dated item re-parented into a
list would otherwise leave a live event pointing at a tin of tomatoes.

### Store hints sort; they never filter

What matters to someone shopping is not partitioning by shop — it is **not
missing an item because it was filed under the shop they aren't standing in**.
Every partition scheme fails that silently, so: one list per *kind of shopping*
(Groceries, Amazon, Hardware — these genuinely differ), and the shop is an
optional per-item hint.

`orderForShop` puts unhinted items and this shop's items together, and sinks
the rest into a collapsed **Better elsewhere** that still shows its count. A
hint records a *preference* ("the bread is better at TJ's"); treating it as a
filter turns a mild preference into a missed item. With no shop known — the
ordinary case — nothing is elsewhere and the list is simply itself, which is
how the feature degrades to a plain list when location is declined or absent.

Hints ride in `tags` under an `at:` prefix (`STORE_TAG_PREFIX`) rather than a
column: tags already round-trip through every capture surface and MCP, and a
column would be nullable on every task in the app to describe a field only
items can have. `sameStore` matches on a normalised key and lets either side
contain the other, because the hint is typed by a person ("trader joes") and
the shop name comes from OpenStreetMap ("Trader Joe's #142").

### Aisles: the one place a built-in lexicon beats learning

An item's aisle is guessed from its name, and the list is grouped by it in
walking order — so a shopping list reads as a **route** rather than an
inventory. `packages/shared/src/food.ts` is the whole thing.

**This looks like the mistake `suggestCategories` already made, and isn't.**
That dead keyword table maps "gym" to "Health", and it is wrong for everyone
whose projects are named differently — which is everyone, because a project
list is personal. Food categories are not: "bananas" is produce in every
household on earth, and the category set is a property of supermarkets rather
than of this user's filing scheme. There is nothing personal to get wrong, only
the language — a much smaller and much more stable problem. It is the one place
in DoDone where shipping a lexicon beats learning from history.

Two rules decide between competing matches:

- **The longest phrase wins.** "ice cream" beats "cream", "chicken stock" beats
  "chicken", "frozen peas" beats "peas".
- **Between equal-length matches, the rightmost wins**, because an English noun
  compound is head-final. That single rule gets *both* "chocolate milk" (dairy)
  and "milk chocolate" (snacks) right, which no first-match scan could.

A word is looked up as written, then singularised, then pluralised — the
lexicon is written the way people write shopping lists, which is not
consistently ("candles" plural, "sourdough" singular).

- **A single-word entry must be unambiguous across aisles.** "wrap" was listed
  under bakery for tortilla wraps and put *Gift wrap* in the Bakery aisle. It's
  gone; a tortilla is reachable by its own name, and the ambiguous phrases
  ("gift wrap", "cling wrap") are listed where they belong so longest-match
  resolves them. Same shape as "toilet roll" vs "rolls" and "dish soap" vs
  "hand soap".
- **Unrecognised is a first-class state, not a failure.** It groups into a
  trailing **Other** — never "Uncategorised", since the user didn't fail to do
  anything, we did.
- **`groupByAisle` collapses to one unlabelled group** when grouping would gain
  nothing: fewer than `AISLE_GROUP_MIN_ITEMS`, everything in one aisle, or
  nothing recognised at all. So a caller renders the result unconditionally and
  gets a flat list exactly when a flat list is right — which is what stops an
  Amazon list of electronics looking like a broken grouped one.
- **A correction is a tag** (`aisle:frozen`, the same mechanism as the store
  hint) and always beats the guess, with no confidence that could overturn it:
  the lexicon guesses about language, and the user is looking at the shelf. It
  survives every future change to the lexicon, which is the point.

#### …and it is remembered

A tag fixes *that row*. A shopping list is standing, so the same words come
back next week on a new row and would be guessed wrong again. `list_term_aisles`
is the lesson that outlives the item: normalised item text → aisle, per user.

**It cannot be learned from history, which is the obvious idea.** "Clear
bought" soft-deletes the items and `purgeDeleted()` destroys them an hour
later, so anything derived by sweeping past items would forget everything the
user taught it by the end of the afternoon. Hence a table rather than a
`suggestFacets`-style sweep — the one place in the app where that shape doesn't
apply.

- **The key is the whole item text, minus a leading quantity**
  (`learnableTerm`) — not a head word. Learning "milk" from a correction to
  "chocolate milk" would be a guess about which word carried the intent, and
  wrong exactly when it mattered: it would quietly re-file every other milk on
  the list. Under-generalising costs one more correction; over-generalising
  costs trust in the grouping. The quantity strip is the one concession,
  because "6 eggs" and "eggs" are obviously the same lesson.
- **The composite primary key `(user_id, term)` is the concurrency story.**
  Teaching is an upsert, so two devices correcting the same word settle on
  last-writer-wins rather than duplicating.
- **`itemAisle` resolves most-specific-first**: this row's own tag, then what
  was taught, then the lexicon.
- **"Automatic" un-teaches**, deleting the row rather than storing a blank —
  a stored "no aisle" would be a third state that has to beat the guess, and
  nothing in the UI means that. It is also why the option is not labelled
  "Other": clearing hands the word back to the lexicon, which usually has an
  opinion, so the row does not land in the Other group.
- **A memory that fails to load is an empty map, never an error.** Without it
  the lexicon still guesses, which is a good answer; a list that refused to
  render because a preference didn't load would be a much worse one. The mobile
  write is best-effort for the same reason — the row is already right.
- Web seeds it server-side (so the first paint is already in the taught groups,
  with no visible re-shuffle) and reloads it client-side after a correction.
  That second read is also the only source the demo sandbox has, which is why
  it isn't a server-prop-only design with a demo special case beside it.
- **The cart is never grouped.** It's a record of what happened, not a route
  through anything, and aisle headers over it would imply something was left to
  walk.
- **One walking order, not one per store.** Every supermarket differs, but they
  differ around this shape, and wrong-but-consistent still beats unordered.
  Per-store ordering is a real follow-up.

Correcting is a `<select>` on web — keyboard-operable and labelled for free,
and the control genuinely is "which of twelve" — revealed on row hover or its
own focus. On mobile it's a long-press, because the row's two tap targets are
already spoken for (see *The row: the circle ticks, the words open*) and a
third visible control would cost mis-ticks.

### The surfaces

Both apps go through `@do-done/shared/lists` — `openItems`, `gotItems`,
`summarizeList`, `listSubline`, `splitProjects` — so a count can't mean one
thing on the laptop and another on the phone. An empty list says **"Nothing on
it"**, not "0 items": empty is a shopping list's resting state, not a number
worth printing.

| | Where |
| --- | --- |
| Web | `Lists` under Projects in the sidebar → `/lists` → `/lists/<id>` |
| Mobile | Projects tab ⟶ cart button → `/lists` → `/lists/<id>` |

Neither list screen uses the app's list machinery — not `TaskDisplayView`, not
`GroupedTaskList`. Every axis those exist to offer (group by status, sort by
deadline, filter by priority) is meaningless on things to buy, and the row they
draw spends its width on a project ring and an urgency gutter a list has no use
for. What is left is a checkbox, a word, and a field that must not lose focus.

**The composer commits without dismissing** — Enter clears the field and keeps
the keyboard, the sheet and the list; a running "N added" is the receipt.
Capture here is a burst, not one item, which is the one place a list composer
must diverge from the task composer. On mobile that is `blurOnSubmit={false}`
plus `submitBehavior="submit"`.

**Clear bought soft-deletes**, which is what makes a list standing rather than
disposable: the list survives, its history doesn't pile up in it, and the ids
it returns are an undo token `TasksApi.restore` takes directly.

**The sidebar section and the mobile cart button appear only once a list
exists.** A permanent heading for an unused feature is exactly the ambient
clutter this design is arguing against.

#### The row: the circle ticks, the words open

An item is a task, so it has everything a task has — notes, a photo of the
label, a store hint, a deadline. The row is the only way in to any of that, so
its two halves do two different things:

- **The circle ticks it off.** Nothing else does. On mobile the ring is 21px
  and the thumb is not, so its `hitSlop` stretches the target to the full
  height of the row and past its left edge — a walking tap still lands without
  looking.
- **The words open the item's editor** — web's app-wide `OpenTaskProvider`
  modal, mobile's `TaskEditModalV2` sheet.

The whole row used to tick. A click meant for "what did I write here" bought
the thing instead, and the only sign was a row moving into the cart.
`list-view.test.tsx` is the regression on web; there is no renderer on mobile,
so that half is verified on the simulator.

**A list's own name, icon and colour are editable from the list.** Web's
`ProjectActions` — the same Edit button a project page has, since the form
behind it already knows how to say "Edit list" — sits in the header of
`/lists/<id>`. Mobile's `ProjectFormSheet` grew an edit mode beside its create
mode (prefill, Save, and a Delete behind a confirm), opened from the pencil in
the list's title bar. That sheet is also mobile's only way to delete a list.

**Two cache bugs came out of the same root**, and both are worth not
re-introducing. A list's items live under `listKeys`, not `taskKeys`:

- The optimistic sweeps in `task-queries.ts` are scoped to `taskKeys.all`, so
  ticking an item wrote to Supabase and left the row exactly where it was until
  the screen was left and re-entered — on the one surface where the tick *is*
  the feedback. `TASK_LIST_ROOTS` is now the list of roots holding a `Task[]`,
  and every sweep walks all of them. Only `listKeys.items()` is in it:
  `index()` caches `Project[]`, which is an array and would sail through an
  `Array.isArray` guard into an updater written for tasks.
- `createProject` invalidates the project caches, which the lists index is not
  among, so a list created on the phone left the screen saying "No lists yet".
  `ProjectFormSheet` invalidates lists explicitly after every write.

`listKeys` is therefore *defined* in `task-queries.ts` beside `tagKeys` and
re-exported from `list-queries.ts`, because the reverse import would be a
cycle.

### Traps already paid for

- **A write built from a filtered getter destroys what the filter hid.** The
  demo sandbox's `create`/`update`/`reopen` did `write([...this.tasks, task])`,
  and `write` replaces the whole array — which already quietly made the previous
  delete un-undoable, and would have wiped every list item. They build from
  `allTasks` now.
- **An optimistic append plus a parent re-sync is a race**, and which side wins
  differs by surface: against Supabase the append lands first, but the demo's
  write is synchronous so its re-render arrives *before* the append and the row
  showed twice. Both composers dedupe by id.
- **`Project.kind` and `Task.is_list_item` are optional on read**, and default
  to `tasks`/`false` through `projectKind()`. A deploy that lands ahead of its
  migration must not fail to parse, and defaulting either the other way would
  hide a whole project's tasks from the app.

## Deleting a task

The other way a row leaves a list, and until recently the only one with no
gesture at all: the row was there, the list came back one shorter, and nothing on
screen said which. **Deletion is the completion gesture's opposite number**, not a
red repaint of it, and the two must not be confusable at a glance:

```
completion   hold at full height reading as done, then slide RIGHT   filed
deletion     dim and tint where it stands, then slide LEFT           removed
```

```
  0 → 200   the row dims to 50% under a red wash    hold
200 → 440   height closes as it slides 36px left    collapse
```

**Direction carries it.** Rightward continues mobile's swipe-right-to-complete;
leftward continues the swipe that reveals Delete. A tap inherits each vector for
free, and neither reads as the other even peripherally. The deletion is also
*shorter* than the completion's 680ms and travels further: that hold is a beat to
enjoy, this one only has to be long enough to see which row is going, and
lingering would be the app savouring the one action nobody wants to repeat.

Constants and their rationale live beside the completion's in
`packages/shared/src/constants.ts`. `delete-motion.test.ts` asserts the
relationships rather than the numbers: leftward against rightward, shorter
against longer, and both envelopes comfortably inside the undo window.

- **The row hears about its own deletion through a window event**
  (`lib/task-delete-events.ts` on web). A completion is started by a control *in*
  the row, so the row can animate itself; nothing about a deletion is. It comes
  from the right-click menu, the editor modal (which may be open over a different
  page entirely), the bulk bar, and a keyboard shortcut — none of which own a row,
  and two of which act on rows that aren't mounted. The fan-out is free with it: a
  task showing in two lists is two rows, and both are leaving.
- **`useDeleteTasks` is the one door**, and it fixes the sequence at the door
  rather than at four call sites: announce, write, toast, then refresh once the
  envelope is spent, so the removal lands on an already-invisible row. Two of
  those call sites used to show an undo toast, one showed nothing at all, and
  deleting from the editor modal was a permanent delete with nothing offering it
  back.
- **The condemned wash outranks selection and hover both.** A row that is going
  has nothing useful left to say about being picked or pointed at, and this is the
  only moment red means "leaving" rather than "overdue".
- **The dim holds its value through the collapse.** Letting it lapse there
  multiplies a row fading to zero by one fading back to full, and the row visibly
  *brightens* on its way out — which is why the travel layer carries two
  transition durations, one per property.
- **Mobile has no confirm dialog either.** It had one, and its stated reason was
  the absence of an undo; that reason is gone. Asking first *and* offering an undo
  afterwards is asking twice. `deleteTask` takes a `holdMs` so the optimistic
  cache patch waits for the animation, exactly as `toggleComplete` does.

### Undo gives back the same task

**Nothing is destroyed when you delete.** `tasks.deleted_at` is stamped, the row
is hidden from every read, and `restore()` clears the column again. So the task
that comes back is the same row: same id, same subtasks, same attachments, same
location links, same pet history — and every `/task/<id>` link handed out before
the delete still works.

It used to recreate from a client-side snapshot (`create(toCreateInput(task))`),
which gave back a *new* row wearing the old title. Its subtasks and files had gone
with the cascade the moment the hard delete landed, and nothing the client held
could bring them back. The Undo button was quietly lying about what it did.

| Method | What it does |
| --- | --- |
| `TasksApi.delete(id)` | Stamps `deleted_at` across the subtree. Returns the ids it touched. |
| `TasksApi.restore(ids)` | Clears it again. One UPDATE, idempotent. |
| `TasksApi.purgeDeleted()` | Hard-deletes anything past `TASK_TRASH_RETENTION_MS`, clearing the Storage bytes first. |

- **The returned ids are the undo token.** They were computed against the *live*
  tree, so a subtask deleted separately five minutes ago isn't among them and the
  parent's undo correctly leaves it deleted. They also cover rows the caller never
  knew about — a task's subtasks are not on screen, so undo can't work off what
  the list handed it.
- **Every read filters, and there is one place to forget it.** `TasksApi.read()`
  is the private helper all fifteen reads start from, and it is the *whole*
  mechanism: **`tasks_select` is the plain `user_id = auth.uid()` and must stay
  that way.** Reads outside `TasksApi` — busyness, project counts, the pet
  tallies, the calendar re-push routes — each carry the filter explicitly, because
  a deleted task that still counts against its project makes the sidebar disagree
  with the list it opens.
- **A select policy may not hide a deleted row, and this was tried.**
  `20260810000002` added `and deleted_at is null` to `tasks_select` as a backstop,
  and it made deleting impossible. Postgres applies SELECT policies to an UPDATE's
  *result* rows when the statement has a RETURNING clause, and PostgREST's UPDATE
  always has one — it reads the count back out of a CTE even under
  `Prefer: return=minimal`. The write landed, the resulting row had `deleted_at`
  set, the policy rejected it on the way back, and every delete on both apps came
  home 403. (The USING clause being checked against the row as it *was* is true,
  and is the other half of the sentence.) It also killed `purgeDeleted()`, whose
  `not deleted_at is null` lookup runs over the anon key from the apps and matched
  nothing. `20260811000001` reverts it; the reasoning is written out there.
- **`restore()` never reads the rows it restores.** It is one UPDATE by id, which
  is what makes it idempotent and lets it run without the caller holding anything
  but the ids `delete()` returned.
- **The calendar trigger knows about it.** A soft delete is an UPDATE, so the
  trigger's DELETE branch never fires and a deleted task's Google Calendar event
  would sit there forever. One clause — `deleted_at is null` — in each syncable
  predicate turns a delete into the existing "enqueue a delete" branch and a
  restore into the existing "enqueue an upsert" one. `isSyncable` in the calendar
  worker carries the same clause and **must stay in step**, or an upsert queued
  from before the delete re-creates the event.
- **This is not a trash can.** Nothing in either app lists deleted tasks or offers
  a way to reach them, and `TASK_TRASH_RETENTION_MS` is an hour — close to the
  undo window rather than comfortably past it, because "deleted" has to keep
  meaning deleted. The window is slack for the purge sweep, not a feature.
- **The purge is driven from the apps**, riding along with the status-sync sweep
  on both platforms (web's `StatusSyncRunner`, mobile's `sweepStatusSync`). Same
  shape, same reasoning: one filtered read that finds nothing in the ordinary
  case, and no infrastructure a preview deploy won't have. It never triggers a
  refresh — the rows it destroys have been invisible since they were deleted.
- **The demo sandbox soft-deletes too**, and needs the filter in *two* places:
  `DemoTasksApi`'s `tasks` getter, and `useDemoData`. The demo screens read the
  store directly rather than calling `list()`, so without the second one a deleted
  task simply stayed on screen. The real app has no equivalent gap; its lists are
  server components that go through `TasksApi` like everything else.

### The undo window

`UNDO_TOAST_TTL_MS` is **9 seconds**, up from six, and both platforms read it from
`@do-done/shared` so the promise can't differ by platform. Six was measured
against the wrong thing: the time it takes to *read* the toast, not the time it
takes to notice the list is wrong, work out which row went, decide that wasn't
what you meant, and get the pointer down there.

The toast is the only way back from a deletion, so it stops being a white card on
a white page:

- **Dark on both themes**, outside the page's palette entirely. It is the only
  element on screen that is temporary and irreversible if missed.
- **Undo is a filled control**, not a text link beside a message.
- **The window is drawn draining** — a hairline bar under the button, linear
  because it reports a fact rather than expressing a feeling. That is the
  difference between "there is an Undo" and "there is an Undo *and you have
  time*", which is the point of widening it. Web sets the CSS animation's duration
  from the constant; mobile drives an `Animated.Value` from the same mount as the
  dismiss timer. Either way the bar and the timer can't disagree.
- **⌘Z takes it back** (web), bound only while a toast with an undo is up, and
  never when the event target is an input, textarea, or contenteditable. The
  shortcut is a convenience over the button and must never be the reason a
  half-typed title loses its last word. The binding is advertised on the button,
  since one nobody is told about is one nobody presses.

## Swiping a task row (mobile)

Swipe **right** for the single Done/Reopen action, which the row plays itself
and then closes. Swipe **left** for Today / Tomorrow / Delete, which are buttons
and wait to be tapped.

### The row comes home before it is ticked off

**A swipe past the threshold says two things, and they are sequential**: the row
is let go of, and *then* the task is done. Both used to fire on the release
frame, so the check had sprung, the halo had rung out and the strike-through was
drawn while the row was still 90px to the right and travelling. The travel then
read as the row catching up with something that had already happened — which is
what made a return that really was animating feel like a snap back to the edge.

Two constants in `apps/mobile/lib/swipe-actions.ts`, derived from each other and
tested together:

- **`SWIPE_RETURN_SPRING`** is handed to `ReanimatedSwipeable`'s
  `animationOptions`, because **the library's default is not a spring you can
  see**. It ships `{ mass: 2, damping: 1000, stiffness: 700, overshootClamping:
  true }`, and Reanimated has no overdamped solution — anything with a damping
  ratio at or above 1 is integrated as *critically* damped, here at ~19 rad/s.
  Ours is deliberately underdamped (ζ ≈ 0.81) with clamping off, so the row
  decelerates into its resting place instead of arriving there. The overshoot
  that buys is ~1.4%, and that is the point: past the row's own edge there is
  only the list background, so a bounce big enough to *see* would read as a gap
  opening beside the row. The curve carries the physics, not the rebound.
- **`SWIPE_RETURN_MS`** is how long the completion waits, matched to that
  spring's envelope (~3% of the distance left, the frame the row visibly lands
  on). It is a delay in front of the completion, not an extension of it: the
  680ms exit envelope, the hold the write waits out, and the undo window are all
  downstream and untouched.

The wait is a timer, not the library's `onSwipeableClose`. That event fires when
the spring is *numerically* at rest — later than the frame the eye reads as
landed, and never at all if anything interrupts it, and a swipe that silently
failed to complete the task is far worse than one that completes a frame early.
`handleToggle` cancels any pending timer, so a ring tap during the return can't
be undone by the swipe that was still owed. Reduce motion skips the wait: there
is no travel to wait for.

**`ReanimatedSwipeable` reports the direction of the *gesture*, not the panel
that opened** — the reverse of the `Swipeable` it replaces, and of how
`onSwipeableWillOpen('left')` reads. `panelForSwipe()` in
`apps/mobile/lib/swipe-actions.ts` is the one place that mapping is written down,
with the library source quoted. Reading it backwards fails silently and
completely: the row completed the task on the delete gesture, showed
"Completed …", and did nothing at all on the complete gesture — with the
Today/Tomorrow/Delete buttons snapping closed before they could be reached.

**Completion writes are serialized per task id** (`completionChains` in
`lib/task-queries.ts`). Undo is a second write to the same row while the first is
still in the air — the toast goes up as the completion is sent, and the row is
still being held for its collapse animation — so fired concurrently the two
UPDATEs race and the row keeps whichever reached Postgres second. Chaining makes
the last *intent* the last write. The sequence number a call claims before
joining the queue also tells a superseded write to leave the cache alone;
otherwise its `dropFromLists()` fires mid-undo and takes back the row the user
just recovered.

The toast waits for the write to land, and a failed undo says so instead of
leaving a button that visibly does nothing. `Toast.undo` is therefore optional: a
message-only toast renders without the button.

Delete is the exception to all of it — a hard delete behind a confirm dialog,
with no undo. `TasksApi.delete()` clears Storage bytes and cascades subtasks;
there is no row left to restore.

## The task row: two coloured slots (mobile)

**The row has exactly two places colour is allowed, and each carries one
variable.** Everything else that used to be a chip is one muted line of prose.

| Slot | Variable | Why that channel |
| --- | --- | --- |
| The **ring** (leading circle) | Project — its colour, and its `icon` when set | Hue is a *nominal* channel: it says which, not how much. A project is a label with no ordering, so colour fits it. |
| The **gutter** (10px, left of the ring) | Urgency — a red dot when overdue, then a bar whose length falls with the rank, nothing for a P4 | Priority is *ordinal*, and the channels that carry order are position and length. Red–orange–yellow only reads as a ranking because traffic lights taught us, and that breaks the moment a user picks red for their "Home" project. |

Rules, all of which matter:

- **P4 draws nothing; P3 does.** They are not the matched pair the names
  suggest. `tasks.priority` is `not null default 'p4'`, so P4 is what a task gets
  by *not* being triaged — the widget, a deep link, and every MCP create land
  there. A mark for P4 would be a mark for absence on nearly every row, and a
  signal that fires everywhere has stopped being one. P3 is the lowest rank
  someone actually chose, so it is the lowest one worth drawing. It is the only
  cool mark in the column: slate, so it reads as ranked rather than urgent, and
  deliberately not the indigo accent, which means *selected* everywhere else.
- **A task cannot *not* have a priority.** The column is `not null default
  'p4'` — no null, no `none`, and no surface offers one. So P4 does two jobs
  indistinguishably: it is the rank called "Low", and it is what a task carries
  when nobody chose. That is why the line falls there rather than somewhere
  tidier. Separating them would let all four ranks draw, but it means a migration
  plus every priority surface (the check constraint, `TaskPriority`, the focus
  score, the `#p1`–`#p4` parser, display grouping and filters, both pickers, the
  widget, the MCP enums). Until someone wants that, this is the honest line.
- **"Low" is the only name that rank has**, on both platforms, in the editor,
  the context menu, and the quick-add chip. Mobile's composer briefly offered a
  fifth row reading "No priority", which set the draft to null and so created a
  P4 — the same task the Low row makes, under a name for a state that does not
  exist. Re-tapping the selected rank still clears the chip, and that is also a
  P4; it just reads as undoing a choice rather than as a fifth rank.
- **Overdue outranks priority** in the gutter, and is the only thing in that
  column that is ever red. Being late is also said in the title's weight, so it
  reads from further away than a coloured chip did.
- **An unset field takes no space at all** — no placeholder, no empty chip.
  `rowSubline` returns only the parts that exist, so a bare task renders a title
  and nothing else.
- **The surface hides a day, never the value.** A row prints its scheduled day
  like any other fact, "Today" included; `hideScheduledDay` is how a caller says
  *I have already named this day* — a section header reading "Today" or
  "Tomorrow", an Upcoming day column, or the Today screen, which sets it per row
  so a Focus task scheduled Friday still says Friday. This used to be decided by
  the value: `schedulePart` swallowed "Today" wherever it appeared, on the
  Today-screen reasoning above, and so on Inbox, All, a project, a tag and search
  a task scheduled today rendered exactly like an undated one — while tomorrow's
  said "Tomorrow". The one day a list most needs to point out was the one day it
  didn't. An overdue task ignores the flag and prints its *age* ("3 days ago"),
  which is the actionable form, and which no header ever repeats: "Overdue" is
  not a day.
- **A project with no icon is a first-class state**, not a fallback — the ring is
  still its colour. A task with no project gets a deliberate neutral.
- **Completion fills the ring with the project's colour**, the same way for every
  priority. Done is a state, not a rank; the reward must never vary by how
  important the task was.

The decisions are pure functions in `packages/shared/src/task-row.ts`
(`rowGutter` / `rowSubline` / `rowEstimate`), not in the component, because
`apps/mobile` has no renderer to test a component with (see Testing) and because
web will want the same answers when its row follows. `RECURRENCE_PRESETS` moved
there too, so the label a row prints can never drift from the option the editor's
picker set.

**Both platforms encode it the same way, and only the anchor is shared.** The two
`TaskItem`s are independent (`apps/web` Tailwind, `apps/mobile` StyleSheet). They
agree on the ring and the gutter — both call `rowGutter` — but not on what
follows the title:

- **Mobile** collapses every chip into `rowSubline`'s single line of prose,
  because nothing in that row was interactive anyway.
- **Web keeps its chips**, because there they are *editors*: priority, project,
  estimate, and schedule each open a popover in place. Collapsing them into prose
  would delete four inline controls to save a line. The project chip drops only
  its colour dot, which the ring now carries. Turning them into a subline that
  swaps back to editors on hover is a real option, and a separate change.

**Web-only detail:** the gutter is also the priority editor's button, so a P4 row
has an invisible control. A faint placeholder fades in under the pointer
(`group-hover/row`) to keep it discoverable.

**A title with no `flex` of its own.** `styles.title` must not set `flex: 1`. The
text is handed to `StruckText`, which wraps it in a View — a *column* container —
so `flex: 1` there means `flexBasis: 0` on the **vertical** axis and collapses
the title to height 0. Filling the row is `StruckText`'s root's job. When this
was wrong, every row without a ★ rendered no title at all, on every screen; only
focused rows survived, because the star gave the row a height to centre against.

Two follow-ups deliberately left out: dropping the project from the subline when
it repeats the row above (needs list-level context at every call site —
`hideProject` is the prop, and `app/projects/[id].tsx` already passes it), and
the section-header changes (capacity, create-into-group). One divergence worth
revisiting: web still paints an overdue date chip red, so an overdue row there
says it three ways (gutter, weight, chip) where mobile says it two.

One behaviour was removed on purpose: the row's project chip used to open a
picker inline. The chip is gone and no other element in the row is a natural
target, so the picker now lives only in the editor, one tap away.

## Attachments

A task can carry files. Two halves that must stay in agreement:

| Where | What |
| --- | --- |
| `task_attachments` | The metadata row — name, mime type, size. Cascades with the task. |
| `task-attachments` Storage bucket | The bytes, at `{user_id}/{task_id}/{uuid}.{ext}`. |

**The leading `user_id` segment is required.** Storage RLS can only see an
object's path — it cannot join back to `tasks` — so the owner has to be *in* the
key. `attachmentStoragePath()` in `packages/shared/src/attachments.ts` is the
only thing that builds one. The bucket is private; every read is a short-lived
signed URL from `AttachmentsApi.signedUrls()`.

**Write order is deliberate in both directions.** Upload puts the bytes down
before the row, and deletes the object again if the insert fails. Remove deletes
the bytes before the row. A row pointing at absent bytes renders as a permanently
broken attachment, whereas bytes with no row are merely invisible — so the
failure always lands on the invisible side.

**`TasksApi.delete()` clears the bucket first**, across the task's whole subtree.
The `task_attachments` foreign key cascades, but a cascade only reaches the
metadata: a Storage object has no foreign key to follow, so without this the
bytes would sit there forever with nothing pointing at them. The subtree walk is
bounded by the depth-2 trigger and short-circuits to a single query for a task
with no children.

**Rendering is classified once, in `attachmentKind()`** — by extension first,
MIME type second. A `.md` file arrives as `text/plain` from a browser, as
`application/octet-stream` from Android's document picker, and sometimes with an
empty type from a drag-and-drop; the extension is the only signal that survives
all three. SVG is deliberately not an inline image: it can carry a `<script>`,
and inlining one would run it in the app's own origin.

Markdown renders on both platforms but through different machinery, because React
Native has no DOM:

- **Web** — `react-markdown` + `remark-gfm`, with `MARKDOWN_COMPONENTS` mapping
  its elements onto the modal's type scale (there is no
  `@tailwindcss/typography` here). `rehype-raw` is deliberately absent:
  attachment content is untrusted, so raw HTML in an uploaded file must stay
  inert text.
- **Mobile** — `parseMarkdown()` from `@do-done/shared` returns a typed block
  tree that `MarkdownView.tsx` draws with `<Text>`/`<View>`. Keeping the parse in
  the shared package is also what makes it testable, since `apps/mobile` has no
  renderer in CI.

Mobile uses two pickers because the platforms split them — `expo-image-picker`
for the library, `expo-document-picker` for files — and reads bytes with
`expo-file-system`'s `File(uri).bytes()` (Hermes has no `atob`, and base64 would
inflate a 10 MB file by a third in memory). **All three are native modules, so
mobile attachments need a fresh `eas build`. They will not arrive over OTA.**

`attachmentKind()` also classifies **audio**, which is what every voice note is.
Playback is `expo-audio` on mobile and a plain `<audio controls>` on web — the
browser's transport is keyboard-accessible and already has a scrubber, so a
hand-rolled one would be worse. Both platforms sign a URL for audio the same way
they do for images (`needsSignedUrl`), and both label a file matching
`isVoiceNoteFileName()` as "Voice note" rather than showing its timestamped
storage name.

## Voice notes

**A recording produces two artefacts and DoDone keeps both**: the audio, as an
ordinary attachment, and the transcript, as the task's text. Keeping the audio is
the feature, not a nicety — a recogniser mishears names and numbers constantly,
so the recording is the record of what was said and the transcript is a
convenience over it.

**One microphone session produces both.** `expo-speech-recognition` will persist
the audio it is already listening to (`recordingOptions: { persist: true }`),
which is why there is no separate recorder module: two things contending for the
mic means one of them silently gets nothing on Android. It was already a
dependency, so the capture half needed no new native module.

| Where | What |
| --- | --- |
| `packages/shared/src/voice.ts` | `splitTranscript`, `appendTranscript`, file naming, the duration cap. Shared so a sentence can't become the title on the phone and the description on the web. |
| `apps/mobile/lib/voice-session.ts` | Pure decisions: transcript accumulation, level normalisation, the completion gate, error copy. |
| `apps/mobile/lib/voice-capture.ts` | `useVoiceCapture` — the native module, lazily required so Expo Go degrades to `supported: false` rather than crashing. |
| `apps/mobile/lib/voice-note.ts` | `attachVoiceNote` — bytes out of the cache, up to Storage, cache file deleted. |
| `apps/mobile/lib/use-voice-quick-add.ts` | The create-then-attach flow both quick-add surfaces share. |
| `apps/mobile/components/VoiceRecorder.tsx` | The card: level meter, clock, live transcript. |

Rules that look arbitrary and aren't:

- **The transcript splits into a title and a description, but only where there is
  no title yet.** Quick-add takes the first believable sentence as the title,
  falling back to a word-boundary cut at `VOICE_TITLE_MAX_CHARS` when the
  recogniser returned no punctuation (Android's default). The task editor
  *appends* the whole thing to Notes, because the task already has a title. A
  sentence boundary is only believed after three words — dictation punctuates
  abbreviations too, and "Call Dr." would otherwise title the task with half a
  name.
- **A final result is folded in by prefix, not by appending.** Android's
  continuous mode emits one result per utterance; iOS re-sends everything said so
  far. Appending blindly stutters on iOS, replacing blindly loses every Android
  segment but the last, and the prefix test needs no platform check.
- **A session hands over only once `end` *and* `audioend` have both fired.** The
  file is explicitly unsafe to read before `audioend`, so completing on `end`
  alone ships a truncated WAV — a bug that reproduces on one phone and not
  another. A grace timer covers a recogniser that dies mid-session.
- **The recording is uploaded after the task is created, never before.** An
  attachment row points at a `task_id`, so there is nothing to attach to until
  then; the file waits in the cache across the gap between speaking and
  submitting. A failed upload says so and keeps the task — and keeps the local
  file, since destroying the only copy of what someone said over a transient
  network error is the one unrecoverable outcome here.
- **The name and MIME type come from the URI the recogniser wrote**, not from an
  assumption: Android writes WAV, iOS may write CAF, and neither announces which.
  `attachmentKind` reads the extension before the MIME type, so guessing wrong
  renders the app's own recording as an anonymous download chip.
- **`VOICE_MAX_DURATION_MS` is the attachment size limit expressed as a clock.**
  16 kHz mono PCM is about 32 KB/s, so the 10 MB bucket ceiling is a little over
  five minutes. Four leaves headroom, and a counter the user can watch is kinder
  than rejecting a five-minute upload after the fact.
- **The recorder is a plain card, not a `Modal`.** Every surface it appears on is
  keyboard-anchored, and an Android `Modal` opens a new window and drops the IME
  — the same reason `QuickAddFields`' chip popovers are inline.

### Ways in

Four entry points, all reaching the same composer:

| Entry | How |
| --- | --- |
| The plus button on a list screen | Long press |
| `dodone://quick-add?voice=1` | In-app deep link, opens straight into recording |
| `dodoneadd://voice` | The "Voice task" launcher shortcut — `QuickAddActivity`, floating over the live home screen |
| Task editor | 🎙 Record, beside Photo and File; transcript appends to Notes |

`QuickAddActivity` answers both `dodoneadd://open` and `dodoneadd://voice`, and
the launch URI is the *only* thing that tells them apart. `quick-add-root.tsx`
reads it via `getInitialURL`, and `isVoiceLaunch` (`lib/quick-add-launch.ts`)
matches it. **That match and the shortcut's `data` URI must stay in step**, which
is what `withAndroidShortcuts.test.ts` asserts; a mismatch is silent on the
device and opens the wrong door with no error. The composer does not mount until
the URI has been read, because mounting on the default and correcting afterwards
races a permission dialog over a keyboard that shouldn't have appeared.

## Design system

- Accent: indigo-500 (#6366f1)
- Font: Inter
- Spacing: 4px grid
- Aesthetic: Things 3 cleanliness, Linear speed
- Tokens in `packages/ui/src/theme.ts`

### A project's colour and its icon

Both are the identity channel on every task row's ring, so both are chosen from a
menu rather than typed.

- **`PROJECT_COLOR_OPTIONS`** (`packages/shared/src/constants.ts`) is twelve wide
  and two deep: a bright spectrum, then the same sweep darker, ending on four
  neutrals. The grid is `grid-cols-12`, not a wrapping row — a palette that
  reflows to 11-and-1 loses the pairing that lets two projects both be "the green
  one" and still be told apart at 20px.
- **`COMPACT_PROJECT_COLORS`** is the older set of eight, used by the *inline*
  "new project" forms: web's project popover and mobile's quick-add chip. Four
  wrapped rows of dots is fine in a dialog and a wall in a popover over a
  keyboard, and capture is not where a colour gets chosen carefully.
- **`packages/shared/src/project-icons.ts`** is the emoji catalogue: ten groups
  plus **Symbols**, which are not emoji at all. `projects.icon` has always
  accepted a free string rendered as text, so ★ and ◆ work and take the row's own
  text colour. The group exists to say so, since nothing did.
- **Two length budgets, and the catalogue satisfies both.** Postgres counts code
  points and `ProjectSchema` counts UTF-16 units, so a ZWJ family (7 and 11)
  passes the column and is rejected by the client. Sequences that long are not
  offered, and `normalizeProjectIcon` drops one rather than truncating it, since
  half a ZWJ sequence renders as two unrelated emoji. `firstGrapheme` is the
  cluster reader, written by hand because `Intl.Segmenter` is not dependable on
  Hermes. That budget is `PROJECT_EMOJI_MAX_LENGTH` (10) and is about the glyph;
  `PROJECT_ICON_MAX_LENGTH` (64) is the column. Different numbers for different
  reasons.

### `projects.icon` holds two kinds of value

The picker has an **Icons** tab (a curated Phosphor set, MIT) beside the emoji
one, and the column stores whichever was chosen:

**409 icons across the same 11 groups the emoji tab uses**, out of Phosphor's
~1,500. It is curated rather than complete because the path data ships in the
mobile JS bundle with no code splitting: 409 icons in three weights is 697 KB,
and the whole library would be about 2.2 MB for a picker most people open once
per project. Search is what makes a set this size usable, so an icon carries
keywords as well as a label.

**An icon appears in exactly one group.** The picker drops its group headers as
soon as a search or a group filter narrows the list, and keys the cells by icon
name alone — so the same name in two groups collides on a React key in the view
people actually use. Where two groups both want a reading, each takes a sibling
icon: Work has `buildings` and Travel has `city`, Nature has `snowflake` and
Food has `jar`. `phosphor.test.ts` asserts it.

| Stored value | What it is |
| --- | --- |
| `🚀` | A character. Printed as text. |
| `ph:briefcase:fill` | A Phosphor icon, drawn from `PHOSPHOR_PATHS`. |

**`parseProjectIcon` in `packages/shared/src/phosphor.ts` is the only thing
allowed to decide which**, and every surface in both apps and the widget goes
through it. Guessing fails loudly: a row that mistakes a token for a glyph
renders the literal text `ph:briefcase:fill` inside a 20px ring. The few places
that genuinely need a `string` — a chip label, a menu row — call
`projectIconText`, which yields the character or nothing.

- **An unknown name is `none`, not an emoji.** A token this build has no paths
  for (a trimmed catalogue, an older client, a hand-written row) draws a bare
  coloured ring, which is the only failure here that still looks deliberate.
- **The weight rides in the token**, so it belongs to the project rather than to
  a setting elsewhere. That lets the picker offer it beside the grid, where the
  choice is being made, and means a row needs no second read to draw itself. The
  app names the three weights for what they are — Phosphor's `bold` is
  **Outline**, `fill` is **Fill**, `duotone` is **Light fill** — because "Bold"
  beside "Fill" reads as two points on one scale.
- **Fill is the default.** The glyph in the ring is 11–12px and Phosphor draws on
  a 256px grid, so a line weight lands under a device pixel while a solid shape
  survives.
- **`phosphor-data.generated.ts` is generated, ~697 KB, and shared by all three
  renderers.** Web builds `<svg>` elements, mobile builds `react-native-svg`
  ones, and the widget takes **markup** from `phosphorSvgMarkup`, because the
  launcher's host draws none of React Native — the same reason the Quick Add tile
  ships as a string. Regenerate with `tools/phosphor/emit.mjs` against
  `@phosphor-icons/core`; the curated list is `tools/phosphor/catalogue.mjs`.
- **`react-native-svg` is a native module.** Mobile draws nothing for a Phosphor
  icon until a fresh `eas build` is installed. It will not arrive over OTA, the
  same way attachments and voice didn't. Emoji are unaffected.

The picker **expands in flow on both platforms and never floats.** Web's dialog
is `overflow-hidden` (which is what rounds its header and footer), so an
absolutely positioned panel is clipped the moment it passes the footer. On mobile
an Android `Modal` would open a second window and drop the IME. The form grows
and its body scrolls instead.

Mobile has no project *edit* screen — only create (`ProjectFormSheet`) and the
detail view — so the full palette and both icon tabs are reachable there.

## Testing

Vitest everywhere (`pnpm test` → `turbo run test`). Web component tests run in
jsdom from `apps/web/vitest.config.ts`; the packages run plain node tests.

**Keep every workspace package on one vitest version.** No package here depends
on `@testing-library/jest-dom` directly, so its `/vitest` entry resolves `vitest`
through its own path in the pnpm store and calls `expect.extend()` on whatever
copy it lands on. When `apps/web` was on 4.x and `packages/*` on 3.x, it extended
the copy no test ran against, and all 26 `toBeInTheDocument()` assertions failed
with `Invalid Chai property`. Same version but two physical copies does it too,
which is why `@types/node` is pinned to `^20.19.39` across **every** workspace
package, `apps/mobile` included, to stop pnpm peer-splitting the install.

To check: after `pnpm install --frozen-lockfile`,
`ls node_modules/.pnpm | grep '^vitest@'` should print exactly one line (a dirty
`node_modules` keeps stale directories and will show more). `grep '^@types+node@'`
should print one line too.

**`react` is pinned the same way, for the same reason.** A package that ships a
hook (`packages/api-client`, whose `useAutoSaveTask` the task editors share)
needs `react` only as a devDependency, but pnpm resolves that copy separately —
and anything with a `react` peer that the package pulls in (`use-debounce`) then
resolves against *it*, not the app's. Render such a hook in a jsdom test and it
runs against a second React whose dispatcher is null: `Cannot read properties of
null (reading 'useRef')`. So `packages/api-client` is pinned to the exact version
`apps/web` uses (`19.2.4`, no caret), and `apps/web/vitest.config.ts` sets
`resolve.dedupe: ["react", "react-dom"]` as a backstop. `apps/mobile` stays on
Expo's `19.1.0` — no vitest there, nothing to split.

**`apps/mobile` tests logic only — there is no renderer.** Its `vitest.config.ts`
runs `lib/`, `widgets/`, and `plugins/` tests in a node environment and nothing
else: query-cache logic, the widget task handler's decisions, and the XML a
config plugin emits, none of which need pixels. Anything that draws needs a
device or a simulator, and neither exists in CI; a jsdom shim would only prove
things about a React Native that isn't the one that ships. What the suite is for
is sequencing the eye can't check on a device anyway — `toggleComplete`'s
completion hold, for instance, where the write must go out before the row leaves
and the invalidate must not land during the animation.

Modules that reach for native code (`./supabase`, `./widgets`, `./query-client`,
`./location-queries`) are `vi.mock`ed per test file, so each test names the seam
it stands in for rather than relying on a global setup.

**The gap this leaves is real.** Component and screen bugs cannot fail here.
A missing task title shipped to main and over OTA because nothing in CI can
render a row — see *Running mobile on the iOS simulator* below.

The pre-existing workaround for the old React breakage is the `vi.mock` of
`./task-edit-modal-v2` in `task-item.test.tsx` and `draggable-upcoming.test.tsx`.
Those isolate the modal for speed too, so they were left alone.

Note that `pnpm test -- --force` passes `--force` to vitest, not turbo. To bypass
the turbo cache, call it directly:
`./node_modules/.bin/turbo run test --force`.

## Storybook and Chromatic

Storybook lives in `apps/web/`. It loads `*.stories.tsx` files alongside
components and uses `@storybook/nextjs-vite`.

```bash
pnpm --filter web storybook        # dev server on :6006
pnpm --filter web build-storybook  # static build to storybook-static/
pnpm --filter web chromatic        # publish to Chromatic
```

Stories cover the main surfaces: TaskItem, TaskEditModalV2, TaskForm, WeekView,
TodayView, SidebarNav, ScheduleButton, the pet panel, and more (~18
`*.stories.tsx` files under `apps/web/src/components/`).

Chromatic publishes Storybook on every push and PR and detects visual
regressions. Setup: sign up at chromatic.com, connect the repo, add the project
token as the `CHROMATIC_PROJECT_TOKEN` GitHub Actions secret. The
`.github/workflows/chromatic.yml` workflow does the rest. Visual diffs appear as
a PR check; accept or reject them in the Chromatic UI. For local runs, set
`CHROMATIC_PROJECT_TOKEN` in your shell and run `pnpm --filter web chromatic`.

**The "UI Tests" check is required on main**, so pending visual diffs block a
merge until the baselines are accepted.

## Running mobile on the iOS simulator

This is the only way to see the mobile UI — CI cannot render it. Two traps, both
of which cost a cycle the first time:

- **`npx expo run:ios` does not work on this Mac.** It fails with
  `CommandError: No code signing certificates are available`, even with no
  `--device` flag, because its device probe hits a broken `devicectl` and
  concludes you are building for a physical iPhone. Build for the simulator SDK
  directly instead, from `apps/mobile/ios`:

  ```bash
  xcodebuild -workspace DoDone.xcworkspace -scheme DoDone -configuration Debug \
    -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
    -derivedDataPath build CODE_SIGNING_ALLOWED=NO
  ```

  The `.app` lands at `ios/build/Build/Products/Debug-iphonesimulator/DoDone.app`.
  Install it on a booted simulator (bundle id `com.beamer408.dodone`) and run
  `npx expo start --dev-client` alongside it — a Debug build needs Metro on
  :8081. Fast Refresh means JS edits need no rebuild.

- **`pod install` needs `export LANG=en_US.UTF-8`** or CocoaPods warns and can
  misbehave.

Setup in a fresh worktree: `pnpm install`, build the workspace packages, copy in
`apps/mobile/.env`, then `npx expo prebuild -p ios --no-install` and
`pod install`. **Prebuild rewrites the `ios`/`android` npm scripts** to
`expo run:*` — revert that. `ios/` and `android/` are gitignored.

`expo-notifications` throws `getRegistrationInfoAsync` on launch because a
simulator cannot issue a push token. It is harmless and does not happen on a
device.

iOS shows nothing about the Android-only surfaces: the home-screen widget, the
launcher shortcuts, `QuickAddActivity`, and geofencing. Those have no
verification path — there is no Android SDK, JDK, or emulator on this machine.

## Mobile native builds (EAS)

The mobile app uses native modules (the Android home-screen widget, geofencing,
voice input) that don't run in Expo Go. To test those, build a custom dev client
APK once:

```bash
npm i -g eas-cli                  # one-time
eas login                         # one-time
cd apps/mobile && eas init        # one-time: writes projectId into app.config.ts
eas build --profile development --platform android   # cloud build, ~10-15 min
```

Install the APK on the device, run `pnpm --filter mobile start`, open the dev
client, and scan the QR code.

Build profiles in `apps/mobile/eas.json`:

- `development` — APK with dev client and debugging tools
- `preview` — APK for internal testing (no dev client)
- `production` — AAB for the Play Store

After the dev client is installed you can iterate on JS without rebuilding. Only
adding a new native module requires a fresh build.

### How the two halves fit together

A React Native app is two artifacts with a contract between them, and most rules
in this file follow from it:

- **The native app** — compiled Swift/Objective-C/Kotlin, containing Hermes and
  every native library. Built once, slowly.
- **The JS bundle** — your `.ts`/`.tsx`, bundled. Rebuilt constantly, fast.

The JS can only call native libraries that were compiled into the native app.

`runtimeVersion: { policy: "appVersion" }` in `app.config.ts` names that contract.
`eas update` publishes a JS bundle stamped with that version to a channel
(`development` / `preview` / `production`), and an installed app accepts only
bundles whose version matches its own. Merging to main publishes to `preview`.

**Practical rule:** if you changed only `.ts`/`.tsx`, never rebuild — it ships
over OTA. If you added a native module or changed `app.config.ts`, rebuild, and
bump the version if it is going out over OTA.

### An install that's too old to update

**A build stops accepting OTA updates the moment a published bundle imports a
native module that build doesn't have.** The update downloads, throws on launch,
expo-updates rolls back to the last bundle that started, and — because
`CheckForUpdateProcedure` will not re-offer an update with `failedLaunchCount >
0` — every check from then on returns "no update available". The app sits on an
old bundle insisting it is current, and the only signal is the sha in
Settings → App version not moving.

Adding `expo-document-picker` / `expo-image-picker` / `expo-file-system`
(attachments) and `expo-audio` (voice) each drew that line. Installs older than
those need a new APK, not an update.

`describeNoUpdate()` in `apps/mobile/lib/update-check.ts` makes this legible:
`Updates.checkForUpdateAsync()` returns a `reason` alongside `isAvailable: false`,
and only `noUpdateAvailableOnServer` means you are current. Reporting every
reason as "Up to date" is what hid the problem, so an unrecognised reason
deliberately doesn't claim currency either.

### Android widget setup

- Widgets are declared in `apps/mobile/app.config.ts` under the
  `react-native-android-widget` plugin. Widget JSX lives in
  `apps/mobile/widgets/`.
- **`widget-task-handler.ts` is registered from `index.js`, the bundle entry, and
  nowhere else.** `registerWidgetTaskHandler` is
  `AppRegistry.registerHeadlessTask`: it names the JS entry point the launcher's
  widget update runs. That update arrives through a headless worker that starts
  the ReactHost with **no activity and no React tree**, so anything registered
  from a component — or from a module only a component pulls in — has not run
  yet, the task key is unregistered, and nothing draws. Expo Router route modules
  load via `require.context`, whose entries are lazy getters, so
  `app/_layout.tsx` (where this used to live) evaluates only when the router
  renders. The widgets drew only while the app was warm, and were blank whenever
  they were added or updated with it closed. A blank widget is an *invisible*
  one: no crash, no log, just an empty cell.
- **Everything reachable from `widget-task-handler.ts`'s static imports must load
  in that cold context**, so it stays tiny (React plus the Quick Add tile).
  Supabase, `@do-done/api-client`, and the task engine are behind
  `await import(...)` on the branch that needs them.
- Widgets read the Supabase session from AsyncStorage, shared with the main app.

### The task widgets draw the app's row

Today, Upcoming, and the 4×1 **Next up** strip all render the two-slot row
described under *The task row*: ring for the project, gutter for urgency, one
muted subline for the rest. The row's decisions are **not** reimplemented here —
`rowGutter` / `rowSubline` / `rowEstimate` from `@do-done/shared` are the same
functions the in-app row calls, so a widget and a list can never disagree about
what a task is. Priority used to colour the checkbox here, which put an ordinal
variable in a nominal channel on the one surface that never said which project a
task belonged to.

Four rules the widget adds, all about a launcher cell being small:

- **`loadWidgetTasks` fetches projects as well as tasks**, because the ring needs
  a colour and an icon. A projects failure returns an empty list rather than
  propagating: every ring falls back to neutral, which is a duller widget but
  still a correct one. Letting it take the task list down would turn a cosmetic
  outage into an empty home screen.
- **Fitting spends a height budget, not a row count.** `layoutRows` in
  `widgets/widget-layout.ts` charges 24 dp for a bare row, 34 dp for one with a
  subline, and 22 dp for a group header, and reserves the "+N more" line *before*
  placing the row that would need it. The old `rowCapacity` divided the height by
  a flat 26 dp, which was wrong in both directions as soon as rows stopped being
  uniform — and a "+N more" computed off a wrong capacity is a wrong number about
  the user's own task list, with nothing on the home screen to contradict it.
- **Below `COMPACT_BUDGET_DP` the sublines all go.** A subline costs 42% more row
  height, which on a 3×2 is the difference between three tasks and one — the
  widget was a group header and a single line. There are exactly two densities
  and no truncated middle ground, and the choice is made inside `layoutRows` from
  the budget, so no caller can get it wrong.
- **A group header owns its day, so the rows beneath don't repeat it.**
  `WidgetGroup.namesTheDay` drives `rowSubline`'s `hideScheduledDay`, the
  date-shaped twin of `projectName: null`. Overdue is deliberately *not* a day
  group: "3 days ago" is the one genuinely actionable thing those rows say. The
  project name **stays** in the subline — the ring is a fast cue, the name is the
  readable one, and a project with no icon would otherwise be a colour the user
  has to have memorised.
- **The card has a dark variant**, via the library's own
  `renderWidget({ light, dark })`. One component tree; a theme is an argument to
  it (`widgets/widget-theme.ts`). A project's colour is **lifted toward white,
  never replaced** — someone who picked green for Home has to find green on both
  cards. The dark card is `#191b22` rather than black, so it keeps an edge
  against an AMOLED wallpaper.

**`widgets/widget-render.ts` is why the two render paths can't drift.** The
launcher's headless handler and the app's own foreground refresh
(`lib/widgets.ts`, called from `invalidateTasks`) both build the light/dark pair
from it. A refresh that passed a single tree would silently drop the dark card
until the next 30-minute tick — a bug that only reproduces on a phone set to
dark.

Two things that can only be checked on a device: an 18 dp ring is well under
Material's 48 dp touch minimum (its tappable box is padded to 26×24, as far as it
goes without making every row taller), and `TextWidget` has no `lineHeight`, so
the dp constants in `widget-layout.ts` are padding-and-margin sums rather than a
typographic ideal.

**Adding the Next up widget changes `app.config.ts`, so it needs a fresh
`eas build`.** The row redesign itself is pure JS and ships over an update.

### Quick-add widget (floats over the home screen)

The 1×1 "Quick Add" widget mimics Todoist's: tapping it opens a quick-add sheet
over the live home screen without launching the main app.

- The widget (`widgets/QuickAddWidget.tsx`) opens `dodoneadd://open` — a scheme
  distinct from the app's `dodone` scheme so it resolves *only* to the
  translucent activity, with no disambiguation chooser.
  `react-native-android-widget` can't target an activity by component, hence the
  dedicated scheme.
- **`plugins/withQuickAddActivity.js`** is a config plugin that, on every
  `expo prebuild`, generates a translucent `QuickAddActivity` (`.kt`), registers
  it in `AndroidManifest.xml` with `Theme.App.QuickAddTranslucent` and the
  `dodoneadd` intent-filter, and adds that style. The activity runs in its own
  task (`taskAffinity=""`, `launchMode="singleTask"`, `excludeFromRecents`) with
  `windowSoftInputMode="adjustResize"` — without that it defaults to pan, and the
  window slides up *underneath* the composer's own keyboard offset.
- **`QuickAddActivity` mounts a second registered JS root, `"QuickAdd"`** (see
  `index.js`, the custom bundle entry that also imports `expo-router/entry` for
  the main `"main"` root). Both roots share one ReactHost and JS bundle, so the
  Supabase session is shared.
- That root is `quick-add-root.tsx`, which renders
  `components/QuickAddComposer.tsx`. It dismisses with `BackHandler.exitApp()`,
  which finishes only the quick-add task and returns to the launcher.
- **The When / Priority / Project / Estimate chips live in
  `components/QuickAddFields.tsx`** (`useQuickAddFields` + `QuickAddChipRow` +
  `QuickAddPickers`), reusing selectors exported from
  `components/TaskEditModalV2.tsx`. Every mobile capture surface shares them:
  this widget composer and the in-app `dodone://quick-add` modal, which is
  where every list screen's plus button lands too (see *Capture is a button on
  mobile*).

  **Nothing in that module may call a TanStack Query hook or reach for an API** —
  the widget root has no QueryClientProvider. Both the project list (`projects`)
  and the inline "New project" action (`onCreateProject`) are handed in by the
  host, which is the only piece that knows what else has to hear about a new
  project: the in-app hosts pass `createProjectOrNull` from `lib/task-queries`
  and let it invalidate the cache, while the widget root reads `ProjectsApi`
  directly and keeps its own array. The widget used to pass neither, which is why
  its Project chip was missing and `#groceries` silently became a tag on the one
  surface where it couldn't be a project. A surface that omits the list still
  gets that behaviour, which now only describes the first frame while a list
  loads.
- **Every quick-add surface has a door to the full editor**, because the chips
  will never cover notes, subtasks, attachments, or the month calendar, and a
  capture surface that dead-ends there is one you have to abandon. The rule is
  the same on both platforms: **create the task first, then open the editor on
  the persisted row** — both editors autosave, so neither has anywhere to keep
  unsaved state. Web has "More options →" (modal) and an expand icon (bar, inline
  composer), both via `openEditor` in `use-quick-add-composer.ts`; `allowEmpty`
  there creates a throwaway "New task" that `TaskEditModalV2`'s `draft` prop
  deletes again if the editor closes untouched. Mobile passes `onExpand` to
  `QuickAddComposer` and **requires a title**, since it has no `draft`
  equivalent and the alternative would be orphan "New task" rows. Where the
  editor opens is the host's call: in place for `app/quick-add.tsx`, but the
  widget root deep-links `dodone://task/<id>` and dismisses, since a 3400-line sheet wanting the router and the query cache has
  no business in a translucent launcher activity.
- **Two composer rules keep the surface from jumping around**, both matching
  Todoist: the card rides the IME via Reanimated's `useAnimatedKeyboard`
  (frame-synced inset, not a post-hoc `keyboardDidShow` measurement), and the
  chips open their options as **inline popovers in the same window**, because an
  Android `Modal` opens a new window and drops the keyboard. Only the full month
  grid takes over the screen, and it hands focus back to the input on close.
- **Widget artwork is inline SVG via `SvgWidget`** (`widgets/dodone-mark.ts`). Do
  **not** use `IconWidget`: it renders the icon name as *text* in a typeface the
  app has to ship itself, so `icon="add"` with no `material.ttf` literally drew
  "add" on the home screen.
- **The tile paints its squircle twice** — once as the SVG, once as a
  `backgroundColor` on the `FlexWidget` behind it — deliberately. `SvgWidget`
  hands the string to AndroidSVG and swallows a parse failure with a bare
  `printStackTrace`, so artwork alone has a silent path to fully transparent. It
  is sized to a centred square of `min(width, height)` from `widgetInfo`, not
  `match_parent`: a launcher cell is taller than it is wide, and square artwork
  would letterbox inside its own background.
- **The handler draws the tile for every action except `WIDGET_DELETED`.** With
  `updatePeriodMillis: 0` there is no update tick, so an action it declines to
  draw for leaves the tile exactly as it was — and for a fresh widget, that is
  blank forever. `_layout.tsx` also calls `repaintQuickAddWidget()` once per
  launch, so opening the app heals a tile whose one render was lost.
- **Test the tap flow in a preview/release build** — `expo-dev-client` intercepts
  launches in debug builds. After changing the widget's size, remove and re-add
  it on the device.
- **None of this has been confirmed on a device.** See
  [`docs/android-widget-verification.md`](docs/android-widget-verification.md)
  for the checklist it still needs, the `ImageWidget` fallback if `SvgWidget`
  turns out not to render, and the build problems (stale checkouts, APK signing,
  launcher caching) that have already cost three install cycles.

### Launcher quick actions (app shortcuts)

Long-pressing the DoDone icon offers **Add task / Voice task / Search / Today /
Upcoming**, each pinnable to the home screen. These are not widgets: the launcher
draws them, so a pinned one takes exactly one cell and sits flush with the app
icons around it. That is the point of having them alongside the 1×1 quick-add
widget rather than instead of it.

- `plugins/withAndroidShortcuts.js` writes `res/xml/shortcuts.xml`, the icon
  drawables, and the labels, then hangs a `meta-data` tag off MainActivity. They
  are static shortcuts, so they exist from install with no runtime native code.
- **Labels must be `@string/` references.** Android silently drops a `<shortcut>`
  whose label is a literal — no build error, the row just isn't there.
- **Intents must be explicit** (`targetPackage` + `targetClass`); an implicit one
  never launches. The deep link rides along as the intent's `data`, which is what
  `expo-linking`'s `getInitialURL` reads. Add task and Voice task both target
  `QuickAddActivity` directly, so the composer floats over the home screen
  exactly as the widget does; the rest target MainActivity. Those two differ
  *only* in their `data` URI — see Voice notes → Ways in.
- **Each icon ships twice**: an `<adaptive-icon>` in `drawable-anydpi-v26` so the
  launcher masks it to the same shape as the app icons, and a plain circle vector
  in `drawable/` for API 24-25, which has no mask. The glyph is scaled into 24..84
  of the 108 viewport, inside the safe zone no mask can clip.
- `plugins/withAndroidShortcuts.test.ts` asserts the generated XML, including
  that every `dodone://` target has a route file. Every failure mode here is
  silent on the device, so the test is the only place they surface. It is why
  `vitest.config.ts` includes `plugins/**` as well as `lib/**`.

### Location reminders (geofencing)

A task can carry reminders at places — "buy milk when I get to Tesco", "post the
letter when I leave the office". `task_locations` links a task to a location with
a `trigger_type` of `enter` or `exit`; a task can have several.

**Surfaces (mobile)**

- `components/LocationReminderSheet.tsx` — the 📍 row in the task editor. A
  search field over tappable places: the first tap attaches the reminder, and
  direction, radius, and whether to keep the place are adjusted afterwards.
  **This is the only place in the app that prompts for location**, and it
  explains itself before asking.
- `app/locations.tsx` (Settings → Saved places) — rename, re-radius, delete. Also
  lists any *one-off* place currently holding a region, since those count against
  the cap the warning on that screen is about.
- `lib/location-queries.ts` — query hooks and mutations. Every write ends in a
  geofence sync; the OS holds its own copy of the regions.

**Surfaces (web) — reads and writes everything, fires nothing.**

Web had no awareness of locations at all, so a task set up on the phone showed
no date and read as one nobody had planned. It now edits the same rows through
the same `LocationsApi`; only the geofence stays on the phone, because no
browser can wake an app when you walk into a shop. Each web surface says so.

| Where | What |
| --- | --- |
| `components/task-locations.tsx` | `LocationSection`, the **Places** block in the task editor. Same flow as the sheet: search, one click attaches, then direction / radius / "Save place" / remove. |
| `components/map-preview.tsx` | The web twin of mobile's `MapPreview`, same tiles from the same projection. |
| `app/(app)/places/` | The **Places** view: every place, and the open tasks waiting at each. Mobile's screen shows a count; web lists and links the tasks, since it has the width. |
| `lib/task-locations-context.tsx` | One `listTaskLinks()` read for the whole app, so a row can show a place chip without a query per row. |
| `lib/supabase/locations-client.ts` | `getLocationsApiFor` / `getClientLocationsApi` — the demo seam, mirroring `attachments-client.ts`. |

- **Places is in the sidebar, not under Settings** — the reverse of mobile, and
  the same split web already makes for Tags. A phone's nav is scarce; a laptop
  is where you sit down and ask what is waiting for you where. **The row appears
  only once a place exists**, like the Lists section, and Settings links to the
  page until then. `hasPlaces` comes from a `listAll()` in `(app)/layout.tsx`.
- **The row chip states, it doesn't edit.** Every other chip on a web row opens
  a popover; a place needs a search field, a direction, a radius and a map,
  which is a panel. So the chip names the place and the row's own click opens
  the editor. `locationRowLabel` in `@do-done/shared` is deliberately shorter
  than `locationReminderLabel`, which the editor's card uses.
- **The editor announces its writes on a window event**
  (`lib/task-location-events.ts`), because the badge provider and the editor sit
  at opposite ends of the tree — the same shape as `task-delete-events.ts`.
- **Never prompt for location on open.** `positionIfAlreadyAllowed()` asks the
  Permissions API whether geolocation is *already* granted and reads a position
  only then. This is web's version of `getLastKnownPosition()`. "Use where I am
  now" is the one control that prompts, because the user pressed it.
- **The demo sandbox implements locations for real** (`DemoLocationsApiImpl`),
  unlike attachments, which are inert there. An attachment needs a Storage
  bucket the demo has no session for; a place is four numbers and a name, and
  place search is a keyless public geocoder. The seed ships three places, and
  the stub mirrors the one-off prune trigger and the delete cascade by hand.

**Shared, so the two can't drift:** `place-search.ts` and `map-tiles.ts` moved
out of `apps/mobile/lib` into `@do-done/shared` unchanged, and
`shared/src/locations.ts` holds `TaskLocationLink`, the trigger labels, and the
phrasing both editors use. `LocationsApi.getTaskLocations` now returns links
with the place joined on — it always embedded `locations(*)` and every caller
re-cast it by hand — and `listTaskLinks()` is the batch read the row chips need.

**Capture: search first, saving never required.** Three rules, each of which was
a usability bug first:

- **A place doesn't have to be saved.** Attaching writes a location with
  `is_saved = false` — geofenced exactly like a saved one, hidden from the
  pickers, and deleted by a database trigger when its last `task_locations` row
  goes (`20260805000002_one_off_locations.sql`). "Save place" promotes the same
  row, so the task links survive. Client-side cleanup would have leaked rows on
  the paths that don't go through the client (a deleted task, a cascade), and a
  leaked one-off place is invisible by construction, since nothing lists it.
- **A name is never asked for.** `locations.name` stays NOT NULL because it is
  what the notification says, but it comes from the search result ("Target") or
  the reverse-geocoded street line, not from the user.
- **Search is type-ahead** (`lib/place-search.ts`), biased toward the last known
  position and labelled with distance so "the closest one" is easy to pick. The
  provider is **Photon** (OSM data, keyless): `expo-location`'s `geocodeAsync`
  returns coordinates with no label, so it can't populate a suggestion list at
  all, and Nominatim's usage policy forbids autocomplete. `geocodeAsync` stays as
  the "look up what I typed" fallback when Photon is unreachable. Reading the
  position for bias uses `getLastKnownPosition()`, which returns null rather than
  prompting or waiting for a fix, so opening the sheet stays free.

`components/MapPreview.tsx` draws the pin, its radius, and your own position from
raster tiles (`lib/map-tiles.ts` holds the Web-Mercator projection, tested in
node). Deliberately not `react-native-maps`: that is a native module, so it would
need a fresh dev-client build and a Maps API key before anyone could see a pixel.
The trade is that it can't be panned and the pin can't be dragged.

The sheet tracks the IME height itself and shrinks its list to fit, because
`edgeToEdgeEnabled` turns off Android's `adjustResize`, so nothing moves on its
own and a bottom-anchored sheet is simply behind the keyboard. Same problem
`QuickAddComposer` solves by riding `useAnimatedKeyboard`; this sheet needs the
number rather than a transform, because it resizes its list instead of moving.

**Engine** (`lib/geofencing.ts`)

- **`registerUserGeofences()` never prompts.** It registers only locations with at
  least one *open* task, so finished work stops waking the device, and a user
  with no location reminders is never asked for location at all.
- **`requestGeofencePermissions()` is the prompting path** — foreground, then
  background, then notifications (Android 13+ needs POST_NOTIFICATIONS, and a
  location reminder that can't notify does nothing).
- Requires both foreground and background location, the latter shown only after
  foreground is granted, per Android policy. Since Android 11 the background
  grant has no dialog: the OS deep-links to the app's Location settings screen
  for "Allow all the time".

**Why it isn't just "notify on enter"** — three rules, tuned in
`packages/shared/src/constants.ts`:

- **Dwell.** An enter fires the moment you clip the boundary, so driving past the
  shop would fire the reminder. Notifications are scheduled
  `GEOFENCE_DWELL_SECONDS` out and cancelled if the opposite transition lands
  first. This is why regions register with `notifyOnEnter` *and* `notifyOnExit`
  even when only one direction has tasks — without the opposite event there is
  nothing to cancel on.
- **Cooldown.** Position drift makes regions flap. Once a task fires for a place
  it stays quiet for `GEOFENCE_COOLDOWN_MINUTES`.
- **Region cap.** iOS silently stops monitoring past 20 regions
  (`GEOFENCE_MAX_REGIONS`), so we trim by open-task count and mark the rest
  "Paused" on the places screen rather than letting them fail invisibly.

Radius presets start at 100 m (`LOCATION_RADIUS_PRESETS`) because a typical urban
fix lands 20-60 m off; tighter regions miss arrivals and emit spurious exits
while you sit still. The default is 200 m.

Dwell and cooldown state live in AsyncStorage, not module state — the background
task runs in a fresh JS context after the OS kills the app.

> **The firing half has never run on a device.** Geofences, the dwell filter,
> the notification channel, and all three permission prompts are unverified
> outside a type-checker; none of them execute in Expo Go or CI. See "Where
> things stand" in [`docs/HANDOFF.md`](docs/HANDOFF.md) for the order to check
> them in. Each failure mode here is silent.
>
> The *editing* half is verified, on web: the task editor's Places block and
> the Places view were driven in a browser against `/demo`, including live
> Photon search and real OSM tiles.

## Notifications

Everything the app posts is a **local** notification, scheduled on the device.
There is no push server: no FCM/APNs credentials, no token table, no cron, no
edge function. Two kinds, on two Android channels:

| Kind | Channel | Fired by |
| --- | --- | --- |
| Location reminder | `location-reminders` (HIGH) | `lib/geofence-task.ts`, from the OS geofence event |
| Daily / weekly digest | `digests` (DEFAULT) | `lib/digests.ts`, armed ahead of time |

**Two channels, not one.** Android lets a user silence a channel without
silencing the app, and "a reminder because I walked into a shop" and "a summary
of my morning" are genuinely different subscriptions. One shared channel would
make muting the digest also mute the thing you are standing in front of. The
digest channel is DEFAULT rather than HIGH on the same logic: a heads-up banner
every single morning is what gets a channel muted.

`lib/notifications.ts` is the one seam onto `expo-notifications`. Every entry
point lazy-requires the module through it, because it was removed from Expo Go
in SDK 53 and importing it there throws at *bundle* time — taking the whole app
down rather than the one feature.

**`cancelAllScheduledNotificationsAsync()` must never be called.** The geofence
dwell filter works by scheduling a reminder a couple of minutes out and
cancelling it if you leave again, so at any moment the queue may hold a
notification that *is* the location feature working. A digest re-arm that
cleared everything would eat it, and the symptom — a location reminder that
fires only when you don't happen to open the app in the two minutes after
arriving — is one nobody would reproduce deliberately. Both schedulers track
their own identifiers and cancel only those.

### Why the location reminder never arrived

`TaskManager.defineTask` names a JS entry point the OS looks up **by name**, and
it delivers a boundary crossing by starting the runtime with *no activity and no
React tree*. A task that has not been defined by then is not queued — the event
is dropped, expo-task-manager logs "Task 'DO_DONE_GEOFENCE' has not been
registered" somewhere nobody is looking, and nothing arrives.

The definition lived in `lib/geofencing.ts`, which is imported only from
`app/_layout.tsx` and two components. Expo Router loads route modules through
`require.context`'s lazy getters, so none of them had evaluated when the event
came in. Location reminders therefore fired only while the app was already open
and rendered, and **never in the case the feature exists for**: phone in a
pocket, app closed, walking into a shop.

This is the same bug that left the home-screen widgets blank, and it has the
same fix. `lib/geofence-task.ts` holds the task and nothing else, and
**`index.js` — the bundle entry — imports it.** `lib/geofencing.ts` keeps only
registration and permissions.

- **The static import graph of `geofence-task.ts` is paid for on every cold
  start**, including the headless ones a launcher widget update runs. So
  `./supabase`, `@do-done/api-client` and the *values* from `@do-done/shared`
  are behind `await import(...)` inside the handler. The last one matters more
  than it looks: `@do-done/shared` is a barrel, so importing one constant
  statically evaluates the Zod schemas and the ~697 KB generated Phosphor table
  before a widget can draw a tile that needs none of them.
- **Nothing else runs at that module's scope.** The foreground presentation
  handler and the channel setup used to; they are concerns of a *running* app
  and now live in `app/_layout.tsx`. Doing them at bundle evaluation loaded
  expo-notifications on every headless start to configure something only a live
  app can use.
- **The handler reads `getSession()`, not `getUser()`.** `getUser()` round-trips
  to the auth server, and this code runs on a phone just woken in someone's
  pocket, possibly with no usable connection — where a failed auth call means no
  reminder at all. `getSession()` reads local storage. The queries still
  authenticate, so an expired token fails them rather than the whole handler.
- **A soft-deleted task no longer greets you at the shop.** That query doesn't
  go through `TasksApi.read()`, so it carries the `deleted_at` filter itself.
- **A tapped notification goes somewhere.** `lib/notification-routing.ts` maps
  the payload to a route — a location reminder opens *its task*, which is the
  whole point given the body is a task title. Registered in `_layout.tsx`,
  because responding to a tap needs the router the background task doesn't have.
  Unknown payloads route nowhere rather than guessing: yanking someone off the
  screen they were on is worse than doing nothing.

### The digests are armed, not subscribed

A local notification's text is frozen the moment it is scheduled, and nothing
server-side exists to compose one. So `lib/digest-plan.ts` plans several
occurrences out to `HORIZON_DAYS` (8), `lib/digests.ts` computes each one's copy
from the current task list, and the whole plan is **cancelled and re-armed on
every launch and every return to the foreground** — the same trigger, and the
same reasoning, as the status-sync sweep.

A repeating DAILY trigger is the obvious thing to reach for and is useless here:
it would deliver the same frozen sentence every morning until the app was next
opened, which for the user this serves is the whole point of failure.

- **`MIN_LEAD_MS` (2 min) exists because re-arming cancels.** An app opened at
  07:59:30 would otherwise cancel the 08:00 digest and schedule its replacement
  for an instant already past — which expo-notifications delivers immediately,
  as a digest arriving the moment you open the app to read the list it describes.
- **A digest with nothing to report is not sent.** `buildDailyDigest` /
  `buildWeeklyDigest` return null for an empty window. A notification that
  arrives every morning to say the day is empty is the fastest way to get the
  feature switched off — and it teaches the user to swipe this app's
  notifications away unread, which is also how they miss a location reminder.
  The settings screen says so out loud, so the first quiet morning reads as the
  rule rather than as a bug. "Send one now" is the one exception: the user asked,
  so "nothing today" is the honest answer to a button that exists to prove the
  feature works.
- **Times resolve through `user_preferences.timezone`, never the device clock.**
  A digest is a wall-clock event in the user's life, and the two disagree while
  travelling. `zonedClockToUtc` does the conversion; `digest-plan.test.ts` pins
  it in two zones.
- **A failed prefs or task read leaves the existing schedule alone.** Usually a
  dropped connection, and disarming on that would silently kill the feature for
  anyone who opened the app on a bad train.
- **The weekly covers the seven days *from* the digest, not a calendar week.**
  Someone asking for their week on Monday means the week they are about to have.
- **Both switches default off**, in the column and in the schema, for the reason
  `status_sync_promote` does: nobody should find that a deploy started sending
  them notifications. Turning one on is also the only place the app asks for the
  notification grant, and it doesn't save the switch if the grant is refused —
  a switch reading "on" above a feature the OS will never let post is exactly
  what makes a notification feature look broken rather than declined.

The copy and the settings schema are in `packages/shared/src/notifications.ts`,
so a digest can't read one way on the phone and another on the laptop, and — more
immediately — so the date arithmetic is testable in node, which is the only place
`apps/mobile` can test anything.

**This is all pure JS and ships over OTA.** `expo-notifications` was already in
the native build, and no config plugin was added precisely so this wouldn't need
a rebuild.

> **Unverified on a device**, like the geofencing it sits beside. What CI covers
> is the arithmetic and the copy (`digest-plan.test.ts`,
> `notification-routing.test.ts`, `packages/shared/src/notifications.test.ts`);
> delivery, channels, and the permission prompt need a real build. **Web has no
> notifications at all** — that needs a service worker and VAPID keys, and is a
> separate change.

## Password-manager autofill

Login fields on **both** platforms carry explicit autofill metadata. Without it
the OS can't classify them and 1Password never offers to fill:

- Mobile (`apps/mobile/app/(auth)/login.tsx`): `autoComplete` (→ Android
  `autofillHints`), `textContentType` (→ iOS AutoFill), and
  `importantForAutofill`.
- Web (`apps/web/src/app/(auth)/login/page.tsx`): `name` and `autocomplete`.

Both flip the password field between `current-password` and `new-password` based
on signin/signup mode, so managers offer generation instead of a fill.

**App ↔ site association is a separate mechanism.** It is what makes a saved
`dodone.byebrianwong.com` login match the *app*, rather than the app being its
own vault item. It needs all three of:

1. `ios.associatedDomains: ["webcredentials:dodone.byebrianwong.com"]` in
   `apps/mobile/app.config.ts` (already set; EAS syncs the capability at build).
2. `APPLE_APP_ID` (`<TeamID>.com.beamer408.dodone`) in the web deployment, served
   at `/.well-known/apple-app-site-association`.
3. `ANDROID_CERT_FINGERPRINTS` (comma-separated SHA-256, usually the EAS upload
   key *and* the Play app-signing key), served at `/.well-known/assetlinks.json`.

Both routes 404 when their env var is unset, because a malformed association file
is worse than a missing one — Apple and Google cache them. `/.well-known` is in
`PUBLIC_PATHS` in `proxy-helper.ts`; Apple's spec forbids a redirect there.

**Neither env var is set yet**, and the iOS entitlement needs a fresh `eas build`
to take effect. Checklist with commands and verification steps:
[`docs/autofill-setup.md`](docs/autofill-setup.md).

> Test autofill in a preview/release build, and make sure 1Password is selected
> under Android Settings → Passwords & accounts → Autofill service.
