# do-done

AI-native task management app. Turborepo monorepo: Next.js web, React Native/Expo
mobile, and a custom MCP server.

## Writing style

Write plainly. This applies to code comments, commit messages, docs, and UI copy.

- State the rule or conclusion first, then the reason.
- One idea per sentence. Short sentences, active voice.
- Use concrete words. No metaphor in place of an explanation.
- Keep the reasoning and the caveats. Say when something is untested or a
  trade-off. Plain does not mean leaving things out.

Commit subjects say what changed, not what it means. Bodies should stay as
detailed as they are — they carry the reasoning, which is worth keeping.

**The hard part is ignoring the surrounding text.** The comments next to your
edit pull harder than any rule stated up here, and matching the local style is
usually good practice. It is wrong here. That pull is how the elaborate register
spread the first time, and it is why the repo needed a full pass in August 2026.

### Before and after

Real pairs from that pass. Each one is a different way of saying less than it
looks like.

**Metaphor carrying the explanation** — `packages/shared/src/spark.ts`:

- ✗ Celebrating *every* completion is how a delight becomes a tax: by the
  fortieth task of the week the burst is something the user is waiting out
  rather than enjoying.
- ✓ Only some completions burst. If every one did, it would fire around forty
  times a week, and users would start waiting it out.

**A commit subject that names a theme** instead of a change:

- ✗ `the row springs home before it is ticked off`
- ✓ `fix(mobile): finish the swipe-return animation before completing the task`

**A heading that names a theme** instead of stating the rule — this file:

- ✗ `Store hints sort; they never filter`
- ✓ `Store hints change the order, never what is shown`

**Personification** — `apps/web/src/components/task-item.tsx`:

- ✗ a signal that fires everywhere has stopped being one
- ✓ a mark that appears everywhere carries no information

**Metaphor in passing** — `packages/api-client/src/attachments.ts`:

- ✗ the bytes would be left paying rent forever
- ✓ the bytes would be left in the bucket forever

Note what survives in every pair: the reason, the number, the consequence. None
of these are shorter because something was dropped.

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
*scheduled* day. Every consumer that saw `due_date` — MCP clients most of all —
read the rarely-set deadline as the schedule, and reported a fully planned week
as empty. ("overdue" is a different word and is fine.)

**The quick-add parser is the one place that word is read rather than written.**
`parseTaskInput` sends every date it finds to `scheduled_date` ("buy milk
tomorrow", "ship it friday 9am"). It only produces a `deadline_date` when "due"
or "deadline" introduces the date ("submit report due friday"). The same
reasoning applies to input: reading "tomorrow" as a deadline left the task
unscheduled and out of every day-based view.

This is deliberately narrow. "by friday" is a schedule, because that is also how
people say the day they will get to something. The rule is
`DEADLINE_MARKER_PATTERN` in `packages/task-engine/src/parser.ts`.

There is one allowed exception to the ban: copy that teaches the keyword, like
the landing page's "'due friday' — a hard deadline instead". That quotes an
input token rather than naming a field.

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

**Only pass a status from a surface whose context implies triage.** That means
the Inbox screens (`inbox` — redundant but self-documenting), the project
screens (`not_started`, because filing into a project is triage), and the
group/date composers, which seed whatever axis their section is grouped by
(`seedFromDrop`, `seedFromUpcomingDate`). Everything else omits the status and
inherits the default.

Why: capture is not triage. The Android quick-add widget, `dodone://quick-add`,
the launcher shortcut, and the plus button on Today / Upcoming / All have no view
context to infer a status from. Seeding `not_started` there marked the task
triaged, so it never appeared in the Inbox anyone actually reviews.

On mobile the default lives in `defaultStatus` in `QuickAddComposer.tsx`, and in
what `QuickAddButton.tsx` puts in the URL: only the project screen sends
`status=not_started`, and `app/quick-add.tsx` reads anything else as `inbox`. On
web, omitting `status` from the `QuickAddSeed` is what reaches it.

## Quick-add pre-fills the fields it can guess

**When the surface knows what a field should be, the chip shows that value
before the user types anything.** Adding a task on the Finance project page fills
the Project chip with Finance. Adding on Today fills the Date chip with today.

The app already *created* tasks this way — the seed was merged in at submit —
but it did so invisibly, so the row you got back was not the row the composer
described. On Today the seed did not exist at all, so a task typed into the Today
bar had no date and dropped out of the list it was typed into.

Precedence, on web (`buildCreateInput` + `contextFacets`, `lib/quick-add.ts`) and
mobile (`buildInput`, `QuickAddFields.tsx`) alike:

| Source | Beats |
| --- | --- |
| An explicit chip pick, including *clearing* one | everything |
| What was typed (`#home`, `p1`, "friday") | the surface's guess |
| The surface's guess (project page, Today, a section) | nothing |

- **A chip shows the value the task would be created with**, so it tracks the
  text as you type. Typing `#home` on the Groceries page moves the chip to Home;
  deleting the token moves it back. `ParsedPreview` echoes only what the chips
  cannot show (deadline, tags, recurrence). Before this it was the only place a
  parsed date or priority appeared, while the chips beside it sat empty.
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
- **Only seed from a route that is genuinely one facet.** `seedFromPathname`
  gives the universal quick-add (sidebar, palette, `q`) the same context the
  page's own bar has — project pages, Today, Inbox — and nothing else.

### Capture is a button on mobile

Every list screen used to pin a full-width text field above the tab bar. It could
be typed into where it stood, but a tap raised the keyboard and grew the card
into the composer, so it behaved like a button already. Until then the field spent the
width of the screen saying "Add a task…" on top of the tasks it was covering. It
is now a plus button in the bottom-right corner (`QuickAddButton.tsx`), and the
typing happens where it already happened for the widget, the launcher shortcut
and the deep link: `dodone://quick-add`, a transparent modal over the list.

- **The screen's context rides along as URL params** — `projectId`,
  `scheduledDate`, `status` — so the chips open pre-filled as the table above
  says, and `useQuickAddFields` takes them through `QuickAddComposer`'s `seed`
  prop. A deep link arrives with none of them and seeds nothing, which is what it
  always did.
- **One composer, not two.** `QuickAddBar` was a second card with its own
  keyboard tracking, mic, expand button and copy of the create flow, and it was
  the only place two capture surfaces could drift apart. `ParsePreview` moved
  across with it, so the deadline / recurrence echo the deep-linked composer
  never had is now on every surface instead of none.
- **Adding closes the surface**, where the bar stayed open for the next task.
  `app/quick-add.tsx` invalidates before it dismisses, so the new row is in the
  list as the backdrop clears rather than arriving a beat later with the focus
  refetch. Burst capture is still a real need, and it is still served where it
  belongs — a shopping list, whose composer commits without dismissing on
  purpose.
- **A long press dictates.** The mic went with the field it sat in. A gesture
  nobody is told about is not a replacement for a button; it is one of four ways
  into the same recorder (see *Voice notes → Ways in*), and the composer's own
  mic is one tap further on.

## The bottom bar (mobile)

Four tabs: **Agenda, Tasks, Lists, Projects**. It was five — Today, Inbox,
Upcoming, All, Projects — and Lists was not among them.

The change is about how fast you can reach things. Getting to the grocery list
took three taps (Projects, the cart button, the list), and it took three taps
again the next day because nothing was remembered. Meanwhile Inbox held a
handful of untriaged rows on most days and had a whole tab to itself.

| Tab | Opens on | Tapped again |
| --- | --- | --- |
| Agenda | Today | swaps to Upcoming, and back |
| Tasks | All | swaps to Inbox, and back |
| Lists | the list you were last in | goes up to all lists |
| Projects | the project you were last in | goes up to all projects |

**Re-tapping a tab is the second half of every rule.** On the two swap tabs it
swaps; on Lists and Projects it pops back to the index. One gesture, and it
always means "the other thing here". It is also what makes remembering safe:
getting out of a resumed screen is never more than one tap.

That pop is written out in `popToIndex`, not left to the navigator. React
Navigation's JS bottom tabs only pop a nested stack through `popToTopOnBlur`,
which belongs to the *unstable native* navigator and is about blur rather than
a press — so the one gesture this design leans on would otherwise have been an
undocumented default we happened to be getting.

### Two views, one tab

Today and Upcoming answer the same question at two ranges, and so do All and
Inbox. Giving each its own tab spent a fifth of the bar on the distinction.

**Only the view you are on is named.** The header shows one word plus a small
tinted circle with two swap arrows (`components/SwapTitle.tsx`), and the glyph
turns over when you use it, so the swap has a direction. Printing both words
would spend the header's width on a word you are not looking at.

Two arrows rather than the other view's icon: a calendar beside "Today" reads
as "pick a date" and a star beside "Upcoming" reads as "favourite", and both of
those are real actions in this app. Arrows can only mean switch.

- **The mode is a module store** (`lib/view-mode.tsx`), not a context, for the
  same reason `lib/auto-sync-notice.ts` is one: the deep-link routes `/today`
  and `/upcoming` — which the home-screen widgets, the launcher shortcuts and
  the digest notifications open — sit outside the tab layout and still have to
  say which half they mean. Both are `Redirect`s that set the mode first.
- **It is not in the query cache.** This is navigation, not data, and
  `invalidateTasks()` sweeps everything under `taskKeys.all`.
- **It is persisted**, so the app reopens on whichever half you were last using.
  `hydrateViewModes()` runs once from the root layout. A mode set by a deep link
  wins over a restore that lands later — the link is the newer instruction.
- **The four view bodies are unchanged**, just moved: `components/views/`
  holds what used to be `app/(tabs)/{index,upcoming,all,inbox}.tsx`. Each lost
  its title `<Text>` and gained `<AgendaTitle />` or `<TasksTitle />`.

### The labels never change; the icon does

The tab bar answers "where can I go". The screen's own title answers "where am
I". A map whose labels move under your thumb is a worse map, and now that the
header names exactly one view it is already doing the second job. So the first
two tabs keep one name each and swap only their glyph — star ⟷ calendar, list
⟷ tray.

That needed a cover word for Today and Upcoming: **"Agenda"**. It is the only
new vocabulary in the change.

**The Tasks tab carries the inbox count as a badge**, and only while you are on
All. On the Inbox itself the badge would be telling you what you are already
reading. The badge is what keeps triage visible now that the Inbox has no tab.

### Lists and Projects remember where you were

Both tabs are **stacks**, not screens (`app/(tabs)/lists/`,
`app/(tabs)/projects/`). That is what lets a list open *inside* the tab, keeping
the tab bar — which is what the pop-to-index gesture needs. Because `(tabs)` is
a route group, the URLs are unchanged: `/lists/<id>`, `/projects/<id>`.

`lib/tab-resume.ts` holds the rule, with `resumeDecision` as a pure function so
the node suite covers it. This is exactly the kind of rule that fails silently
on a device — a tab that opens on the wrong screen, or one that navigates in a
loop — and `apps/mobile` has no renderer.

- **The memory is the last screen you saw in that section**, which may be the
  index. Backing out to the index is itself a visit, so it clears the memory and
  the next tap lands on the index. The index screen writes `null` on focus.
- **It never expires.** A week later the Lists tab still opens Groceries,
  because a week later that is still the list you keep. A time limit would only
  make the tab unpredictable.
- **It survives a relaunch** — one AsyncStorage key each. A cold start is when
  the shortcut is worth most.
- **A deleted or missing target falls back to the index**, silently. The stored
  id is checked against the loaded list before the tab restores it, so a list
  deleted on the laptop cannot strand the phone on an empty screen. That is also
  why the decision returns `wait` while the ids are still loading: deciding
  early would forget a good memory just because the list had not arrived.
- **The restore runs once per launch**, tracked in module state. Without that,
  popping back to the index would bounce straight into the list you just left.

Two doors closed with this: the cart button on the Projects tab and the
"Shopping lists" row in Settings. Both existed to reach a feature with no tab
of its own, and the Settings row specifically existed because the cart button
only appeared once a list existed — so there was no way to make a first one.
The Lists tab is permanent and has its own **+**.

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
  could show the user. You can still file a subtask elsewhere; it just does not
  survive the parent being moved.
- **`subtreeIds` stops at the depth-2 ceiling** the database trigger enforces.
  The cascade is two queries, not an open recursion — and one query for a
  childless task, which is the common case. It is awaited, so a caller's cache
  invalidation lands after the children have moved.
- **The cascade is best-effort.** The parent's own write has already landed and
  there is nothing to roll back to, so a failure leaves the subtree behind rather
  than failing the write the user asked for.
- `apps/web/src/lib/demo/api.ts` mirrors all three by hand.

### Hiding subtasks in lists

Every list is a flat query, so a subtask appears as an ordinary row with a
"↳ parent" breadcrumb. That is right for a checklist someone is working through,
and noise for a parent whose six steps bury the rest of the page. `showSubtasks`
on `DisplayConfig` is the switch, next to "Show completed" in both Display menus.

- **It is a top-level field, not a `filters` clause.** It describes what a list
  *is* by default, not a narrowing the user applied, so it must be able to
  default to *on* without lighting the "Filter · N" badge on every view.
- **It defaults to on**, and `parseDisplayConfig` backfills that for every config
  saved before the field existed. Defaulting it off would silently change what
  every saved view means.
- **One branch in `filterTasks`**, so grouped lists (`applyDisplay`) and the
  curated Today/Upcoming layouts (`filterByConfig`) both get it.

### Every mobile list is a Display view

Inbox, Project, Tag, and Completed used to hand-roll their own list — a
`DraggableFlatList`, or a `SectionList` over an Open/Done split. That is why they
had no Display menu, and so no way to hide subtasks. They now use
`useDisplayConfig` + `GroupedTaskList` like All/Today/Upcoming, reusing web's
`viewKey`s (`inbox`, `project`, `tag`, `completed`) so a preference set on the
laptop is the one the phone opens with.

- **`project` and `tag` each have one config, not one per project or tag** — same
  as web. A per-id key would reset itself every time a tag was coined.
- **Their defaults are web's defaults.** This changed two screens visibly: a
  project page opens grouped by status rather than Open/Done, and neither it nor
  a tag page shows completed tasks until "Show completed" is on. Both were
  previously implicit in the hand-rolled Open/Done split.
- **`GroupedTaskList` gained four props** so those screens did not each keep
  their own list just to keep their own behaviour:
  - `hideProject` and `openInProject` — the project screen, where every row
    belongs to the title bar's project, and the project's open count answers both
    celebration rules.
  - `sectionCounts={false}` — the tag screen. A tag cuts across projects and
    statuses, so its sections are not sections of *work*; a count taken from one
    would fire the celebration on a guess.
  - `ListEmptyComponent` — a list that renders nothing when empty is fine for All
    and wrong for Inbox, which has something to say there.
- **`hideEmptyGroups` on the project and tag screens.** `applyDisplay` emits
  every non-terminal status column even when empty, on purpose: they are drop
  targets, so a task can be dragged into a status nothing currently has. That is
  worth it on All and costly on a project page, where a few tasks sat under
  "INBOX (0)" and "LATER (0)". Both screens listed only non-empty sections before
  adopting the engine, so the flag restores that. The trade, on those two screens
  only: you can no longer drag into a status that is empty there. The engine and
  web are unchanged.
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
"gym" to "Health" is a guess about a project list we cannot see, and it is wrong
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
title whose words point two ways produces no suggestion at all. That is exactly
the case where the user would have stopped to think, and a confident wrong chip
would stop them doing so.

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
  `#project` already typed is not fed back as evidence for the answer it just
  gave. It is state rather than a ref, unlike the streak, because the chips have
  to fill in when the history lands.
- **`TasksApi.suggestionHistory()` selects three narrow columns, newest-first and
  bounded** — unlike `listTags`, which has to sweep everything because a tag it
  misses does not exist to the app. A suggestion has no such duty.

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
the in-app bar for the same title, which is what a shared scorer exists to
prevent.

`suggestionsFor(title)` takes the title rather than holding it, because the hosts
own that state — the same shape as `buildInput(raw)` and `absorbTags(value)`. It
scores the title directly with no parse: mobile's absorber has already stripped
every `#token` on the way in, and a leftover date word costs little because the
parser strips those before a task is saved, so no historical title carries one.

**`suggestionKeys` is its own query root, not under `taskKeys`** — the optimistic
`setQueriesData<Task[]>` sweeps rewrite everything under `taskKeys.all`, and this
cache holds a pair of Maps. It is deliberately **not** in `invalidateTasks()`,
which is where it differs from `tagKeys`: a tag count indexes what exists and is
wrong the moment a task moves. This is a guess from habit, and one more task
barely changes it. Refetching the history after every create
would be the most expensive write in the app, and the suggestion would come out
the same.

## Status ↔ schedule auto-sync

An opt-in rule with two independent halves, both off by default, that keeps a
task's status and its `scheduled_date` from drifting apart. Settings live on
`user_preferences` (`status_sync_*`); the rules are pure functions in
`packages/shared/src/status-sync.ts`.

- **promote** — a task whose scheduled date lands on or before the *horizon*
  moves up to `status_sync_status`. It never moves a task backwards, so
  `in_progress`, `done`, and `cancelled` are untouched. Overdue counts as inside
  the horizon. It fires on a *change*, not continuously — see below.
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
`startStatusSyncSweeps()` (mobile `_layout`, on resume), and before the MCP read
tools.

### Promote fires on a change; it is not an invariant

**A status the user set by hand always stands.** Promote runs at two moments and
no others: a write that moves a task's `scheduled_date` inside the horizon, and
the day a task's existing date comes near. A write that leaves the date alone
leaves the status alone.

So the rule reads as: re-dating a task reconsiders where it sits in the queue;
nothing else does. Move a task scheduled for tomorrow from Next back to Not
started and it stays there. Change its date — to any other day inside the
horizon, or from outside to inside — and it goes back to Next, because the date
is the newer instruction. Demote it again after that and it stays demoted again.

This replaced an invariant: promote used to re-apply on *every* write and every
sweep, so a demotion sprang back within seconds. It was doing exactly what the
setting said, and it read as the app refusing the edit, because the only evidence
was a field springing back with nothing to explain it. This section exists so that failure is not
repeated: **an automatic change the user cannot
override and is not told about is indistinguishable from a bug.**

Three precedence rules:

- An explicit `scheduled_date` in the same write always beats backfill.
- Promote is gated on the write moving the date (`dateMoved` in
  `statusSyncPatch`). Creating counts, and so does backfill having just supplied
  a date.
- But on a write that *does* move the date, an explicit `status` still does not
  exempt the row. Setting a Not started task to tomorrow moves it to Next even
  though the same write named a status.

**`user_preferences.status_sync_swept_through` is what makes the sweep a reaction
rather than a standing condition.** It records the horizon the sweep last ran
through; `sweepPromoteRange` turns that into the band of days that have *newly*
crossed in, and the sweep promotes only inside it. Without the lower bound the
sweep re-promotes every near task on every foreground, which restores the invariant this design removed. The write-time
fix alone was not enough.

- **The watermark advances even on an empty run**, and only after the promote
  UPDATE succeeded. Leaving it behind on an empty run reopens the same band next
  pass; advancing it past a band that failed to write skips those days forever.
- **Null means never swept**, and the next sweep takes in the whole list. That is
  both the pre-migration behaviour and what turning the setting on should do.
- **It is reset by `UserPrefsApi.updateStatusSync`** whenever a field that changes
  *which* tasks promote is written — everything except `status_sync_backfill`.
  Changing the rule re-applies it; off-and-on-again is the escape hatch for
  re-applying it over demotions you have changed your mind about.
- **It is deliberately not in `StatusSyncSettingsSchema`.** It is bookkeeping, not
  a setting, and putting it there would make it writable through
  `UpdateStatusSyncInput`.

### Every automatic change is reported

The other half of the fix, and the more important one: **the app tells you when
the rule moved something.** Copy lives in `describeStatusSyncNotice` /
`describeStatusSyncSweep` (`packages/shared`), so the phone and the laptop cannot
word the same event differently, and so it is testable in node — which on mobile
is the only place anything is.

- `TasksApi.create`/`update` return an optional `autoSync: { …, notice }`
  alongside `{ data, error }`. Returned rather than inferred: the interesting
  write is the one that sent *only* a date and got a status change too, and a
  caller reconstructing that would have to hold the prior row.
- `syncScheduledToStatus` returns `notice` and the rows it moved.
- **A create only reports when it overrode an opinion the caller had.** Landing
  in Next with no status asked for is the default arriving, not the rule taking
  something away — and a toast on every quick-add is how a feature gets switched
  off.
- **Mobile routes it through `lib/auto-sync-notice.ts`**, a module-level notifier
  the root installs, because `task-queries.ts` and `status-sync.ts` are plain
  modules and cannot call `useUndoToast`.
- **Web announces it on a window event** (`lib/auto-sync-events.ts`), same
  reasoning as `task-delete-events.ts`: there is no single web write door. Fifteen
  components call `getClientTasksApi().update()` directly, so the announcement is
  made by a Proxy in `tasks-client.ts` — the seam they all get their API from, and
  the same seam demo mode hangs on. A Proxy rather than a subclass, because
  `TasksApi`'s methods call each other (`complete` goes through `update`) and a
  subclass would announce one write twice.

"Today" is resolved through `user_preferences.timezone`, never the process clock.
See the timezone note under Dates above.

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

`pnpm typecheck` does not cover `apps/mobile` — it has no `typecheck` script. Run
`npx tsc --noEmit` there yourself.

### Running the app to look at it

`.claude/launch.json` names the servers an agent starts with `preview_start`
(`web`, `mobile`, `storybook`, `mcp`). **Never launch a dev server with a bare
shell command** — nothing can find it afterwards.

**The `web` entry sets `"autoPort": true` deliberately.** Worktrees are a normal
way to work here, so a second session is often already holding port 3000. Without
the flag the server refuses to start and there is no way to see the change at
all. With it, 3000 is still used whenever it is free; the flag only engages when the
alternative is no server at all.

**The cost: connecting Google Calendar only works on port 3000.**
`api/calendar/connect` builds its `redirectUri` from the request origin, and
Google Cloud Console has only `http://localhost:3000/api/calendar/callback`
registered, so any other port returns `redirect_uri_mismatch`. Free 3000 before
testing that flow. Nothing else is port-sensitive: `APP_URL` is pinned to the
deployed URL even locally, so the MCP OAuth issuer does not vary with the port,
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
calendar_sync, user_preferences. All tables use UUID primary keys and a `user_id`
column for RLS.

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
`.github/workflows/migrations.yml` runs it on every PR. A pull request is checked
out as the merge commit, so both branches' files are in the tree and the collision
is caught before either can be applied. **When you add a migration, number it past
every version already in the ledger** — check `supabase migration list --linked`,
not just the files on your branch.

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

- **stdio** — `apps/mcp/dist/index.js`, registered in `~/.claude.json` for Claude
  Code.
- **Streamable HTTP** — `apps/web/src/app/api/mcp/route.ts`, deployed with the web
  app and added in Claude as a custom connector pointing at
  `https://<your-app>/api/mcp`.

The HTTP endpoint is stateless: it builds a fresh `createDoDoneServer()` per
request, bound to the authenticated user. That per-request construction is
required, not an optimisation — the tool registrars capture their user id when
they are constructed.

**Anything here that touches dates must say which date it means.** DoDone
schedules on `scheduled_date` and almost never sets `deadline_date`, so a client
that treats "dated" as "has a deadline" reports a full week as empty. Tools answer
date questions through `get_agenda`, emit every date with its relative reading,
and resolve "today" through the user's timezone rather than the process clock
(which is UTC when hosted). See `packages/mcp-server/CLAUDE.md` → Dates.

### OAuth

Claude's custom-connector form accepts a URL and an optional OAuth client
id/secret, with nowhere to put a static token. So the web app is also an OAuth 2.1
authorization server:

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

- **PKCE S256 is mandatory.** Clients are public, so this is what secures the code
  grant. "plain" is rejected.
- **Codes and tokens are stored only as SHA-256 hashes, and are single-use.**
  Redemption and refresh rotation are atomic conditional UPDATEs, not
  read-then-write.
- **Redirect URIs must match exactly**, with the RFC 8252 loopback-port exception
  for native clients. Never prefix-match.
- **A bad `client_id` or `redirect_uri` renders an error, never a redirect.**
  Redirecting to an unvalidated URI is how an authorization server becomes an open
  redirector.
- `MCP_BEARER_TOKEN` is an optional static fallback (scoped to `DO_DONE_USER_ID`)
  for Claude Code's `--header` flag. Unset it to require OAuth.

`APP_URL` pins the OAuth issuer and must be the URL clients actually reach. The
OAuth paths and `/api/mcp` are in `PUBLIC_PATHS` in `proxy-helper.ts` so the auth
proxy does not redirect them to `/login`. `/oauth/authorize` handles its own
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
passer-by could wreck for everyone, or anonymous sign-ins — which are disabled on
the project and would create a row per crawler. The sandbox avoids both, needs no
environment variables, and works on every preview deploy. It also gives Claude a
way to drive the real UI, which the login wall made impossible.

- **`lib/demo/mode.ts` decides demo-ness from the URL**, not from a cookie or a
  context. `getClientTasksApi()` is called from deep inside components that know
  nothing about where they are mounted; the path is the one thing always available
  to them.
- **`lib/demo/api.ts` holds stand-ins for `TasksApi` / `ProjectsApi` /
  `UserPrefsApi` over a plain array.** They are not a fake `SupabaseClient`:
  faking the client would mean reimplementing PostgREST, `.or()` filter grammar
  and all, to arrive back at the same array operations. They reach callers through
  a cast, so nothing type-checks them at the call sites. `api.test.ts` sweeps both
  prototypes instead — a missing method is a runtime `undefined is not a function`
  that only ever fires in the demo.
- **The seam is `tasks-client.ts` / `projects-client.ts` /
  `user-prefs-client.ts`.** Every web mutation already went through those, so
  swapping the object is all it takes and no component knows it might be in a
  demo. Three components used to construct `new TasksApi(createClientSupabase(),
  …)` inline and now go through `getTasksApiFor(userId)` /
  `getProjectsApiFor(userId)`. A fourth doing that would silently bypass the demo.
- **`lib/demo/store.ts` is the database**: one immutable object, mirrored into
  **sessionStorage** so a link shared with a room full of people gives each of
  them their own copy, and re-seeded when its `seededFor` day goes stale.
  Replacing the whole object on every write stands in for the `router.refresh()`
  the real app relies on — a refresh here would re-run a server component that has
  nothing to say.
- **Demo screens render nothing until `useDemoData().ready`.** The seed is dated
  from the reader's calendar day and the server's day is UTC, so anything
  date-shaped rendered server-side would be a hydration mismatch.
- **`SidebarNav`, `SortableProjectList`, and `taskPath()` prefix their links with
  `/demo` when inside it**, derived from `usePathname()` rather than passed down. A
  bare `/today` would bounce the visitor to the login wall the demo exists to
  avoid. Settings is dropped from the demo nav (there is no account behind it), and
  `AppShell` takes `userEmail={null}`, which suppresses the Pip panel — Pip reads
  its state from the database.

## `#` in a title: project first, tag otherwise

A `#token` is matched against the user's own project list, Todoist-style.
`#groceries` files the task into **Groceries** if that project exists, and becomes
a tag if it does not.

Precedence inside a token is fixed: `#xs`…`#xxl` (estimate) → `#p1`…`#p4`
(priority) → project → tag. So a project named "M" loses to the size code rather
than shadowing it.

Three pieces read the same text and **must agree**:

- `parseTaskInput` (`packages/task-engine`) parses a whole quick-add string at
  submit.
- `extractTitleShortcuts` (`packages/shared`) runs on every keystroke in the title
  fields.
- **Every "+ tag" control** — the two task editors and mobile's quick-add chip row
  — classifies the bare word it is handed.

All three take the project list as an *optional* argument and delegate the match
to `matchProject` in `packages/shared/src/project-match.ts`. Omit the list —
Storybook, the mobile widget root, any surface with no projects available — and
every token is a tag, exactly as before.

**The "+ tag" field is a `#token` without the `#`.** It classifies its word
through `classifyShortcutToken` on the same size → priority → project → tag
ladder. It used to store whatever was typed, so `#personal` in the title filed the
task into Personal while `personal` typed into the tag box two inches away created
a tag of the same word, and `p1` there created a tag literally named "p1". A
classification rule the user cannot see must behave the same everywhere it can be
reached, so it is a shared function rather than a comment.

- **Match on a normalised key** (lowercase, alphanumerics only). A token is `\w+`
  and can never contain a space, so without normalising both sides every
  multi-word project would be unreachable by typing. `#sideproject` and
  `#side_project` both reach "Side Project". A name that normalises to nothing
  (emoji only) matches nothing rather than everything.
- **The surfaces differ in where the match lands.** Mobile's absorber fills the
  Project *chip*, the same way it already fills Priority and Estimate. Web has no
  absorber in quick-add, so the match shows in `ParsedPreview`, which updates as
  the text changes, and the chip stays the explicit override — the same way typed
  `p1` has always behaved there.
- **A typed project beats the section's**, same as priority: adding inside "Work"
  and typing `#home` means Home. An explicit chip still beats both.
- **The parse needs a project list, so on web it reads `QuickAddProvider`**
  (`useQuickAdd` → `useQuickAddContext`) rather than a prop. That is why a project
  created inline from the quick-add modal is also registered with the provider —
  otherwise it could not be typed by name until the next page load.

`/name` resolves against the same list. Unmatched, it stays the bare name it
always was (`parsed.project`); only `parsed.project_id` ever reaches a task.

## Tags: listing them and filtering by one

**A tag is not a row anywhere.** `tasks.tags` is a bare `text[]` — no tag table, no
join table, no per-user registry. So "the user's tags" is a question only the task
list can answer, and a tag exists exactly as long as some task carries it.
Everything below follows from that.

`summarizeTags` in `packages/shared/src/tags.ts` is the single answer: rows in, one
`TagSummary { tag, task_count, open_count }` per distinct tag out, ordered by open
work then alphabetically. Web's index, mobile's, the demo sandbox, and the MCP tool
all call it, so a count cannot mean one thing on the phone and another on the
laptop.

| Surface | Where |
| --- | --- |
| Web | `/tags` (sidebar) → `/tags/<tag>`; every tag chip on a row links to the latter |
| Mobile | Projects tab → tag button, and Settings → Tags → `/tags/<tag>` |
| MCP | `list_tags`, plus a `tags` filter on `list_tasks` |

- **Matching is exact, including case.** `#Work` and `#work` are two tags — in the
  column, in `applyDisplay`'s tag filter, and in PostgREST's `overlaps`. Folding
  case in the index alone would make a card's count disagree with the list that
  card opens, and an index of counts must never do that. Normalising tags where
  they are *written* is a real change and a separate one.
- **Counts come from a sweep of the task rows, not from a loaded list.**
  `TasksApi.listTags()` selects two narrow columns with no `.range()` — the same
  shape and cost as `ProjectsApi.listWithCounts`. The per-view `availableTags` that
  feeds the Display menu's tag pills is a different thing and stays as it is: it
  can only see the slice on screen, which is right for narrowing the list in front
  of you and useless as an index of what exists.
- **`TasksApi.listByTag` uses `overlaps("tags", …)`** — the first caller of the
  `idx_tasks_tags` GIN index, which had been dead since it was created. Filtering a
  fetched page in the client would miss everything past the limit, which on a tag
  view is the entire point of the page.
- **A tag view is an ordinary list**, so web hands it to `TaskDisplayView` and the
  whole Display menu works. `viewKey` is the bare `"tag"`: one saved config for the
  surface, not one per tag, or the preference would reset every time a new tag was
  coined.
- **No quick-add on a tag view, on either platform.** Nothing in the composer seeds
  a *tag*, so a task typed there would be created without one and drop out of the
  list it was typed into — the bug the Today bar had before `contextFacets`.
- **A missing tag is not a 404.** "Never existed" and "nothing carries it any more"
  are the same state, so `/tags/<gone>` renders an empty view that explains itself.
  A link from a task someone just untagged has to land somewhere.
- **The tag chip is the one chip on a web row that navigates rather than edits.**
  Every other chip opens a popover in place, so this is a `Link` that stops the
  click reaching the row — otherwise the editor would open over the page it just
  navigated to. It shows its `#` now that it goes somewhere. **Mobile rows show no
  tags**: that row collapses everything into `rowSubline`'s single line of text by
  design (see *The task row*), and a tappable chip would be the first thing to
  break that.
- **Mobile's tag summary is its own query root** (`tagKeys`, not under `taskKeys`).
  The optimistic `setQueriesData<Task[]>` sweeps rewrite anything under
  `taskKeys.all`, and this cache holds `TagSummary[]`. `invalidateTasks()`
  invalidates it explicitly, since any write can move a count.
- **MCP can now read what it could already write.** `create_task` and `update_task`
  have always accepted `tags` while nothing could list or filter by them, so an
  agent could only guess at spellings. `search_tasks` still will not find a tag —
  tags are not in the `fts` vector — which is why `list_tags`' description says so.

## Linking to a task (web)

Every task has an address, and the editor keeps the address bar accurate:

| URL | What it is |
| --- | --- |
| `/task/<id>` | Canonical and context-free. What "Copy link" hands out, and what a recipient opens: a standalone page. |
| `/inbox?task=<id>` | The editor, mirrored onto the view it was opened from. Written while the modal is up, so the address bar is always shareable and Back closes the modal. |

`OpenTaskProvider` (`apps/web/src/lib/open-task.tsx`) owns the single editor for
the whole authenticated app. It is mounted once in `(app)/layout.tsx`, not per row,
for two reasons: a link can open a task with no row on screen, and a task showing
in two lists still opens exactly once.

It writes the URL with the **native History API**, not `router.push`. A router
navigation would re-run the underlying list's server components on every row click
and change nothing — the list is already rendered, and the editor is a layer above
it. `popstate` keeps state and URL in agreement.

`TaskItem` falls back to its own local modal state when the provider is absent
(Storybook, unit tests), which is why `useOpenTask()` returns null rather than
throwing.

The auth proxy carries the destination through sign-in (`?next=`), so a task link
handed to someone signed out survives the login round-trip. `safeNext` on the login
page stops that being an open redirector.

## Click feedback (web)

**Every route under `(app)` needs a `loading.tsx`.** This is required, not polish.
These routes are dynamic server components — auth comes from cookies, rows from
Supabase — so without a fallback Next.js skips prefetching them *and* blocks the
entire client-side transition until the server render lands. Clicking a sidebar
item changed nothing on screen for a second or two: not the rows, not even the
active pill, because `usePathname()` only updates once the navigation commits.
Nothing was producing feedback at all. The fallback is what lets the transition
commit on the click, and it enables partial prefetching, so most navigations then
land instantly.

Feedback has three layers, each covering what the one before it cannot:

1. **`active:` styling** on every sidebar row (`PRESS` in `sidebar-nav.tsx`). CSS
   only, so it fires on pointer-down, before React or the network. Note the
   explicit short duration: Tailwind's default 150ms is tuned for hover and reads
   as lag on a press. Project rows get the background but **not** the scale — they
   are also dnd-kit drag handles, and an inline `transform` cannot share the
   property with a utility class.
2. **The active pill moving**, the moment the transition commits — which the
   `loading.tsx` files make immediate.
3. **`NavPendingDot`** (`useLinkStatus`), only for when the shell has not
   prefetched and the click really is waiting on the network.

Layers 1 and 3, and the skeletons, start invisible and fade in after ~140ms
(`.dd-skeleton`, `.dd-link-pending` in `globals.css`), so a navigation faster than
that shows no placeholder rather than a flash. The skeletons carry the real page
title in the real type and the geometry of a real task row, so the destination is
readable on the first frame and the swap is a fill-in rather than a jump. That is
also why `PageSkeleton` takes `maxWidth` (`/calendar` is `max-w-7xl`, everything
else `max-w-3xl`).

**One CSS trap, already paid for: do not drive the pending dot with a fade-in
animation plus a pulse animation.** Two animations on `opacity` means the later one
wins outright, and a pulse whose `0%`/`100%` frames are implicit resolves them to
the *underlying* opacity — 0 here. The dot pulsed between invisible and almost
invisible. It is now one keyframe set whose first quarter is the fade-in.

`app-shell.test.tsx` mocks `next/link`, so that mock must export `useLinkStatus` or
every test in the file dies on the nav rows.

## A failed read must not render as an empty account (web)

**Every server page under `(app)` must tell "the read failed" apart from "there is
nothing here."** They used to be the same thing on screen.

`TasksApi` and `ProjectsApi` return `{ data, error }` and set `data` to `[]` when a
read fails. So a page that destructured `data` and dropped `error` rendered an
outage as an empty list, under its own empty-state copy: "No tasks in your inbox."
The detail pages were worse — `if (error || !task) notFound()` told the user a task
did not exist because a read had 401'd, on a link they had just been handed.

This shipped, and a Supabase incident then rejected every authenticated read with
`PGRST303 JWT issued at future`. The app reported a full account as empty for
hours, and it looked exactly like data loss.

- **`lib/read-result.ts` is the seam.** `read()` throws `ReadError` when a list read
  fails. `readRow()` is for `getById`, and returns `null` only when the row is
  genuinely absent.
- **`readRow` exists because `.single()` reports "no rows" as an error**
  (`PGRST116`, HTTP 406). Routing that through `read()` would turn every real 404
  into "could not load". Only that one code means absent; anything else, including
  an error with no code at all, is a failure.
- **The fix is in the web helper, not in the shared API.** Switching `getById` to
  `.maybeSingle()` would read better, but mobile's `task-queries.ts` and
  `list-queries.ts` branch on that `error`, and MCP reads it too.
- **`app/(app)/error.tsx` is the boundary**, so the shell and sidebar survive and
  the user can navigate away. Its copy says the data is still there, because the
  whole failure was that an outage read as deletion.
- **It takes `unstable_retry`, not `reset`.** This is Next 16. `reset` only
  re-renders what the boundary already has; `unstable_retry` re-fetches, which is
  the only useful thing to do when the fetch is what failed.
- **`requireServerApis()` redirects when there is no session** rather than handing
  back a null API. A signed-out visitor used to get the same empty lists a failed
  read did.
- **Calendar events are deliberately exempt.** `getDisplayEvents` is best-effort and
  returns `[]` — events are decoration on a page whose substance is the tasks, and a
  Google outage should not blank the list.
- **The boundary does not cover `(app)/layout.tsx`, and the layout must not
  throw.** Next's error file wraps its segment's page and everything nested
  below it, but *not* the layout in the same segment — errors bubble to the
  nearest boundary *above*, and there is none above `(app)`. (`global-error.js`
  is a different thing: it is for the root layout, and replaces `<html>`.)

  Adding a boundary above would be the wrong fix anyway. A throw in the layout
  takes the shell with it, so the user would lose the sidebar, the nav, *and*
  the tidy error card the page was rendering inside it — worse than the bug.

  So the layout reports instead of throwing. `projectsUnavailable` rides from
  `(app)/layout.tsx` through `AppShell` to `SidebarNav`, and the Projects
  section says "Couldn't load projects" in place. The shell keeps working; one
  section admits it is blind.

  - **The case this exists for is partial failure.** In a total outage the
    page's error card already explains the empty sidebar beside it. When only
    the layout's read fails you get a working task list next to an empty
    Projects section, and without this there is no explanation anywhere.
  - **Lists share that read and stay silent.** Two notices for one cause reads
    as two faults.
  - **The notice is `neutral-500`, not the `neutral-400` of the headings above
    it.** Those are uppercase labels you skim; this is a sentence you have to
    read, and 400 on the light sidebar is about 2.5:1. Measured: 4.54:1 light,
    6.94:1 dark.
  - **`hasPlaces` still swallows its error**, hiding the Places nav row when
    the locations read fails. Lower stakes — Settings links to Places
    unconditionally, so there is always a way in.

## Cold start (mobile)

**"Nothing scheduled today" is an answer, and the app must not give it before it
has one.** The mobile query cache is in memory, so every launch began with
`data === undefined` on every list, and every screen rendered its empty state into
that gap. The app opened by telling the user their day was clear, then filled in a
moment later. Web never had this problem: its pages are async server components, so
the rows arrive with the HTML.

Three pieces, all under `apps/mobile`:

- **`lib/query-persist.ts`** writes the query cache to AsyncStorage, restored by
  `PersistQueryClientProvider` in `app/_layout.tsx`. Launch opens on the rows the
  user last saw, refreshed underneath. A snapshot older than `CACHE_MAX_AGE_MS`
  (24h) is dropped rather than shown. **`gcTime` in `query-client.ts` is the same
  24h and must stay in step** — otherwise a restored list for a tab the user has not
  opened is garbage-collected before it is ever observed, and the next write-out
  persists the cache without it.
- **A persisted query's data must survive `JSON.stringify`.** The snapshot is
  written as JSON, which has no representation for a Map or a Set — both come
  back as `{}`. That is not stale data, it is data of the wrong *type*, and
  every screen here copes with the first and none with the second.
  `useListCounts` caches a Map: restored from a snapshot it arrived as a plain
  object, the first row of the Lists screen called `.get` on it, and the whole
  app went to the error boundary — on every cold start, for anyone with a list.
  `survivesJsonRoundTrip` keeps such a query out of the snapshot entirely, so it
  refetches on launch and draws a skeleton, which is what the screens are built
  for. `useAisleMemory` caches a Map too. **Caching a Map is still allowed; it
  just will not be persisted.** `CACHE_KEY` is `v2` because the old snapshots
  already hold the broken shape and cannot be repaired by a reader.
- **`lib/list-load-state.ts`** decides skeleton vs. empty vs. error, once, for every
  list screen. `hasData` is `data !== undefined`, **not** `length > 0`: a restored
  empty list is a real answer and gets the empty state, while a cache that has never
  held one gets the skeleton. It is a plain function over a plain input because
  `apps/mobile` has no renderer to test a hook with.
- **`components/ListPlaceholder.tsx`** draws it: `ListSkeleton`, an `UpdatingBar`
  that delays itself ~350ms (`useRefreshOnFocus` refires every query on every tab
  switch, so a bar bound straight to `isFetching` strobes), and `ListError`, without
  which an offline first launch pulses a skeleton forever.
- **`lib/section-rows.ts`** answers the last question in that chain: is this list
  empty? That is a question about tasks, not about rows. Every section flattens to a
  header row, and `applyDisplay` emits sections that hold nothing: the "none"
  grouping always emits one, and a status grouping emits a column per status so
  there is somewhere to drag a task to. So `data` is never empty on a list with no
  tasks, `DraggableFlatList`'s own `data.length === 0` test never fires, and
  `ListEmptyComponent` never renders. An empty Inbox therefore drew nothing at all —
  no rows, and no "Inbox is empty" either, since its one row was the "none" group's
  8px spacer header. `SectionedDraggableList` decides it with `hasTaskRows` and hands
  the list no rows when the caller gave it a `ListEmptyComponent` to show instead. A
  caller that passes none keeps its headers, which is why All, Today's grouped branch
  and Upcoming's grouped branch now pass one.

**That bar is the only signal a background refresh gets.** `RefreshControl`'s
spinner belongs to the *gesture*, so every list drives it from `usePullToRefresh`
(`lib/query-client.ts`) rather than from the query's `isRefetching`. The
obvious-looking `refreshing={isRefetching}` hits the same `useRefreshOnFocus` trap:
a refetch fires on every tab switch, so the platform drew its pull-to-refresh circle
— a control the user is meant to have *dragged* into view — unprompted at the top of
every list on every tap of the tab bar.

**The cache is restored only for the account that wrote it**, and that check lives
*inside* `restoreClient`, not in the auth listener. Restore and the auth event
resolve independently, so clearing after the fact is a race the previous user's rows
can win.

## Dragging a row (mobile)

**A long press starts a drag, and there is no handle.** A row can be asked to do
three things and has one body to ask with. Reordering is the one that *must* be a
hold: `DraggableFlatList` needs the finger still down when `drag()` is called, so
it cannot be a tap. Multi-select used to own the hold, which is why every row
carried a `reorder-three` grab handle — dragging had to live somewhere else, and
that somewhere was ~36px of horizontal space on every row of every list, spent
permanently on the rarer of the two actions. The handle is gone and the hold
reorders, matching the projects list, which has long-pressed to reorder since it
was written.

Multi-select is now an explicit mode, armed from **`ListActionsMenu`** — the ⋯
button in each list's top bar — and left with Done on the bulk bar. That is the
right trade for a mode: it is asked for rather than fallen into, and the gesture it
used to occupy was one the finger reached for constantly while trying to move a
task.

- **`lib/row-gesture.ts` holds the rule as two pure functions**, tested in node like
  the rest of `lib/` (there is no renderer here). `rowLongPressAction` returns
  `'drag'` only on a list that can reorder and only while selection is *not* armed:
  a row in selection mode is a target and nothing else, since a drop would rewrite
  the task the user is in the middle of picking. That is the same reason the swipe
  panels are disabled there.
- **`onLongPress` is `undefined`, not a no-op, when there is nothing to hold for.** A
  `Pressable` carrying an `onLongPress` swallows the press that would otherwise have
  fired `onPress`, so a list that cannot reorder (search, Completed) would eat a slow
  tap.
- **`isActive` on `TaskSelectionValue` is its own flag**, no longer
  `selectedIds.size > 0`. The menu arms the mode with nothing picked yet, and under
  the old derivation that state was indistinguishable from "not selecting" — the rows
  would not have become targets and the first tap would have opened the editor.
- **`BulkActionBar` appears with the mode, not with the first selection**, since it is
  both the confirmation that the ⋯ item was heard and the only way out. Its five
  buttons are withheld until something is picked; a row of controls that would act on
  nothing invites a tap that does nothing.
- **A few top bars got shorter rather than longer.** Today's Completed and Settings,
  and All's Completed, moved into the ⋯ menu: they are destinations rather than
  actions on the list, and five indigo icons beside "Today" crowded the heading.
  The menu opens as a bottom sheet, like every other menu in the app — an anchored
  popover would have to know the height of two different kinds of header, and the
  sheet lands under the thumb.
- **A menu row that opens another modal has to wait for this one to go.** On iOS a
  `Modal` presented while another is still dismissing never appears — no error, the
  row simply does nothing. Every action here navigated, so nothing hit it until
  "Edit project" tried to open a sheet and did nothing at all. `ListActionsMenu`
  holds the action and runs it from the modal's `onDismiss`, which is iOS-only, so
  Android still runs it inline rather than waiting for a callback that never fires.

The cost is discoverability: nothing on the row now says it can be dragged. That is
already true of the projects list, and the alternative was a permanent visual cost on
every row for a hint each user needs once.

**The query cache has to agree with the finger before the write goes out, not
after.** `SectionedDraggableList` keeps a local copy of the order so a drop lands
instantly, but it re-seeds that copy from `sections` — that is, from the cache — on
any change to any task in view. So while the cache holds the pre-drag order, the list
is one cache write away from re-laying itself out into it and back.

A cross-section move used to guarantee exactly that. It was
`updateTask(id, patch).then(() => reorderTasks(ids))`: two writes, each with its own
optimistic patch and its own `invalidateTasks()`, and only the second one carried the
order. The first patch landed a cache that agreed the task had moved section but still
carried its old `sort_order` — the only thing that decides a row's place *within* a
section (`TasksApi.list` orders by it alone, and `generateFocusList` breaks ties by
it). So the row appeared in the wrong slot, the list re-rendered around it, then did it
twice more as the two refetches came back. Three full re-layouts in about a second,
which is what read as the whole screen flashing.

- **`moveTask(id, input, orderedIds)`** in `lib/task-queries.ts` is the one door for a
  drag that both re-files a task and re-orders its destination: one optimistic apply of
  *both* halves, both writes, one invalidate. All four cross-section drag handlers
  (Today, Upcoming, and both branches of `GroupedTaskList`) go through it.
- **`reorderTasks` patches the cache too**, via `patchCachedOrder`, which stamps
  `sort_order` and re-sorts. That reproduces what the refetch will return, so the
  reconcile is a no-op rather than a second opinion.

`lib/task-move.test.ts` asserts on the cache *mid-flight*, with the writes held open,
because the settled state was never the problem.

The other half of a drag's aftermath is the refresh spinner, covered one section up:
every one of these invalidates used to drop `RefreshControl`'s circle over the list,
landing it on the row the finger had just released.

### Every optimistic sweep goes through `patchTaskLists`

**Not every cache under `taskKeys.all` holds a `Task[]`.** `useParentTask` caches a
*single* task under `taskKeys.detail(id)` — the "↳ parent" breadcrumb on a subtask row
— and `{ queryKey: taskKeys.all }` matches it by prefix. Every optimistic updater in
`lib/task-queries.ts` is array-shaped (`old.map`, `old.filter`, `.sort`), so all of
them met it with `is not a function`.

That throw leaves no trace. It comes out of `setQueriesData` synchronously — before the
`try` that owns the write and before the `finally` that invalidates — and every caller
swallows the rejection. `setQueriesData` walks the cache in insertion order, so the
lists it reached first kept their optimistic patch. The row left its list, nothing was
ever sent, and the task was still sitting where it started when the next screen was
opened. One subtask row anywhere on screen was enough, and the detail cache then
outlived it (`gcTime` is 24h, and it is persisted), so swipe-to-Tomorrow, delete and
every bulk action stayed dead for the rest of the session.

- **`patchTaskLists(updater, scope?)` is the one door**, and it skips anything that is
  not an array; `cachedTaskLists()` is the read side. A guard rather than a narrower key
  filter, because the invariant is one any future query can break again just by caching
  a task on its own.
- **`taskKeys.detail` is named beside the list keys** so the exception is visible next
  to the rule it breaks, instead of spelled out inline at the hook.
- **A skipped cache is reconciled by `invalidateTasks()`** like everything else, so the
  breadcrumb still follows a renamed parent.
- **The swipe panel's Today / Tomorrow now reports a failed write.** The row leaving the
  list is the entire feedback that gesture gives, so a silent `.catch(() => {})` there
  made a reschedule that sent nothing look exactly like one that worked.
  `lib/task-cache-shape.test.ts` is the regression, and it asserts the *write went out*,
  not just the settled cache.

## The tab bar minimizes as you scroll (mobile)

Scrolling down a list shrinks the bottom tab bar: the labels fade, the icons
scale to 80%, and the row goes from 50pt to 30pt. Scrolling up restores it. All
four tabs stay in place and stay tappable the whole time.

**A hand-written bar has to draw everything the default one did.**
`tabBarBadge` is the one that bit: the Tasks tab's inbox count is set in
`app/(tabs)/_layout.tsx` and would simply never have appeared. It renders
inside the scaling wrapper, so it shrinks with the icon rather than floating
free of it as the bar minimizes.

**It minimizes, it does not hide.** Hiding chrome is the pattern for reading
surfaces, where the session is long and the content is what matters. A task list is
scan-and-act: you scroll to find a row, tick it or open it, and switching views
is often the next thing you do. A switcher you have to scroll back up to reach
has been taken away rather than tidied.

The gain is 20pt of list, which is about a third of a task row. The bar also
sheds five labels and 40% of its height, and that visual weight is most of why
the change reads as roomier than 20pt sounds.

**The safe-area inset is never interpolated.** Shaving it too would roughly
double the gain, and it is what iOS 26's own minimized tab bar does, but it puts
the icons' bottom edge within a few points of the home indicator's gesture zone,
where the system eats the first upward swipe.

### Where the pieces live

| File | What |
| --- | --- |
| `lib/tab-bar-motion.ts` | The policy: thresholds, the state machine, the interpolations. Pure, node-tested. |
| `lib/tab-bar-minimize.tsx` | The provider holding the one shared value, plus `useTabBarScrollSync` for lists. |
| `components/MinimizingTabBar.tsx` | The bar. Passed to `<Tabs tabBar={...}>` in `app/(tabs)/_layout.tsx`. |

`progress` is a single Reanimated shared value, 0 expanded to 1 minimized. The
bar's height, its labels' opacity, its icons' scale and the add button's resting
place are all derived from it on the UI thread. Two separate animations could
only agree at the ends, which on a scroll-driven change is most of the time they
are visible.

### The bar floats, so every list adds its own bottom padding

`BottomTabView` lays its tab bar out as a flex sibling of the screens. A bar with
an animating height in that flow would resize the screen, and therefore
re-measure the `FlatList` inside it, on every frame of a scroll. So the bar is
`position: absolute` and out of flow entirely.

Two consequences:

- **Every list on a tab needs extra bottom padding** — the expanded bar's
  height — so its last row can scroll clear of the bar. That is
  `useTabBarScrollSync().contentInset`, added to whatever padding the screen
  already asked for. It is constant, never the animated height: a padding that
  tracked the sweep would re-measure the list every frame, which is the thing
  the floating bar exists to avoid.
- **The add button rests above the expanded bar and translates down** by exactly
  what the bar sheds, off the same shared value. A transform, not an animated
  `bottom`, so the sweep costs no layout. Off a tab there is no provider, the
  progress stays 0, and it sits in the corner it always did.

### Rules in the state machine

`nextMinimizeState` runs once per scroll frame on the JS thread and returns its
own argument on all but two frames of a scroll. The shared value is written only
on an actual flip, so the spring starts once per direction change.

- **Hysteresis, or the bar flickers.** A momentum scroll changes direction
  constantly. Minimizing needs 24pt of downward travel from the last turning
  point; expanding needs 12pt upward. `anchor` is that turning point, not the
  last offset — a reversal has to be measured from where the finger changed its
  mind.
- **Expanding is deliberately half the threshold of minimizing.** The failure
  modes are not symmetrical. A bar that minimized too eagerly costs a glance; a
  bar that will not come back means the user is pulling at their own navigation
  and getting nothing back.
- **Neither rubber band is a gesture.** The top one is easy — it reads as a
  negative offset. The bottom one is not: flick to the end of a list and it
  overshoots ten or fifteen points and settles back, which arrives as a clean run
  of *decreasing* offsets sitting right on the 12pt expand threshold. Reaching
  the bottom of a list popped the bar open about half the time. `clampToScrollRange`
  needs the list's scroll range, which is why the lists also report
  `onContentSizeChange` and `onLayout`. That range is tracked **per list**, not in
  the provider: all five tab screens are mounted at once and each has its own.
- **`canMinimize` is a one-way veto.** It can keep the bar out, never trap it in.
  Its callers are things that can get stuck — a drag whose end never fires, an
  accessibility flag read asynchronously at launch — so a stuck veto leaves the
  bar permanently expanded, which is the app as it was before this existed.
- **A drag freezes it.** Dragging a row near the bottom auto-scrolls the list,
  and that is the library moving it, not the user.
- **A tab change resets it**, state and anchor both. The list you arrive at has
  its own offset.

### Accessibility

- **Reduce Motion turns it off rather than making it instant.** Elsewhere in the
  app that setting lands on the end state, because the end state is the thing
  that happened — a task really is done and its row really is gone. Nothing
  happened here. The minimize *is* the decoration, so the right response is to
  leave the bar alone rather than jump-cut it between two sizes on every flick.
- **A screen reader turns it off too.** VoiceOver and TalkBack scroll the list
  themselves, so the bar would resize under an exploring finger.
- **Labels are still announced when they are invisible.** `accessibilityLabel`
  carries them, so nothing a screen reader needs rides on the label's opacity.
- **A minimized 30pt row is under every platform's touch minimum**, so each tab's
  `hitSlop` reaches down into the safe-area inset (dead space) and 10pt up into
  the list, which reserves far more than that in padding.

The bar is hand-written rather than a wrapper around `BottomTabBar` because that
component takes its height from `tabBarStyle`, a plain style prop on an RN
`Animated.View`, with nowhere to put a Reanimated value. Press handling is copied
from the default: emit `tabPress`, navigate only if nothing prevented it and the
tab isn't already focused. `@react-navigation/bottom-tabs` is now a direct
dependency of `apps/mobile` for that component's prop types; it resolves to the
same copy expo-router already uses.

**This is pure JS and ships over OTA.** No new native module, no config plugin.
Verified on the iOS simulator; the Android half is the same code with no
platform branches except the press ripple, and Android's stretch overscroll
doesn't move `contentOffset` at all, so the bounce rule is inert there.

## The task editor sheet (mobile)

**Everything under the finger runs on the UI thread.** The sheet's rise, its drag, and
the backdrop's dimming are one Reanimated shared value — `translateY`, in pixels below
the sheet's resting place — written by worklet gesture handlers and read by two
`useAnimatedStyle`s. Nothing about the motion crosses into JS until the sheet is
off-screen and there is a close callback to fire.

It used to be a plain `Animated.Value` with `useNativeDriver: false` and a
`runOnJS(true)` pan, which put every frame on the JS thread — the same thread the editor
mounts on. Opening a task fires three requests, lays out a month grid, and used to mount
six nested `Modal`s, all inside the 280ms the open animation had to run in. The
animation lost every time.

- **`lib/sheet-motion.ts` holds the policy as pure worklets**, tested in node like the
  rest of `lib/`: when a release dismisses (a *projected* rest position, so a short fast
  flick counts and a flick back up never does), how long the closing sweep takes
  (velocity-matched, so a flicked sheet does not decelerate the instant the finger
  leaves), and the backdrop's opacity for a position. The `'worklet'` directives ship
  those to the UI thread; `babel-preset-expo` adds `react-native-worklets/plugin` on its
  own, and under vitest the directive is an inert string.
- **`SHEET_HEIGHT_RATIO` and `styles.ghRoot.height` must stay in step.** The slide is
  measured against the ratio, so a sheet taller than its travel never fully leaves the
  screen.
- **The height a worklet reads must be a `SharedValue`, not a ref.** Reanimated copies
  captured values into the UI runtime, so `ref.current` read from the memoised gesture is
  whatever it was on the first render, forever.
- **The backdrop is derived from the sheet, never animated alongside it.** It was a flat
  `rgba(17,24,39,0.4)` under `animationType="none"`, so the screen went dark in a single
  frame while the sheet was still off the bottom, and came back only after it had
  finished leaving. Deriving it is also what makes it follow a *drag*: half dismissed is
  half lit. The style's colour is opaque now; restoring the alpha would multiply the two.
- **The body owns the drag until it has nothing left to scroll.** `activeOffsetY(12)`
  claims downward drags, which is also how you scroll a list back up, so the pan samples
  the ScrollView's offset in `onBegin` and stands down unless it was already at the top.
  Without that the editor lurched toward the floor instead of scrolling.

Two render-cost rules, both because **the editor re-renders on every keystroke in the
title** — autosave holds the task in React state:

- `ScheduleCalendar` and `SubtasksSection` are `React.memo`ed and their props kept
  stable. `SubtasksSection` takes `parentId`/`parentDepth` rather than the parent `Task`
  for exactly this reason: a `Task` prop is a new object on every keystroke and would
  defeat the memo on the renders it exists to skip.
- Nested pickers are mounted only while they are open. Six of them used to live
  permanently inside every open editor, each rebuilding its option rows per keystroke and
  holding a host view it never showed.

## The completion animation

The most repeated gesture in the app, and one shape on both platforms. Timings and rules
live in `@do-done/shared`, because the two implementations have nothing else in common
(CSS plus inline styles on web, Reanimated worklets on mobile) and the constants are the
only thing keeping them from drifting.

```
-90 →   0   the ring flinches under the press          anticipation
  0 → 220   the check springs and the ring fills
 20 → 360   a hairline halo rings out and dissolves    anticipation
 40 → 230   the strike-through is drawn, left to right
  0 → 400   sparks, on a completion that earned one    gated
420 → 680   the row slides right as its height closes  exit
```

**Nothing may outlive the 680ms envelope.** That keeps `TASK_COMPLETE_EXIT_MS` governing
every list drop and leaves the write path, the hold, the per-id chaining, and the undo
window untouched. `completion-motion.test.ts` asserts the relationships rather than the
numbers: the line finishes with the check (230 against 220 — one is the control
acknowledging the tap, the other the text, and the eye may be on either), and everything
inbound lands before the hold ends.

**The spark burst must finish inside the *hold*, not just the envelope.** The row turns
on `overflow: hidden` the moment it starts collapsing, so a particle still in the air is
sliced off at the row's edge as it shrinks. `SPARK_MS` is 400 against a 420ms hold. The
stagger is spent *within* that, never added to it — a particle that starts late flies for
less time — so all ten land on the same frame. Web varies each particle's
`animation-duration`; mobile re-bases each one off the single shared progress value.

**Two platform differences that look like drift and are not:**

- Web hangs the squash off `:active`, so it really is the press, firing on pointer-down
  ahead of React. Mobile folds it into the completion, because a 22px ring is under the
  thumb at exactly the moment a press-driven squash would be visible, and
  swipe-to-complete has no press at all.
- React Native cannot animate `textDecorationLine`, so `StruckText` draws the rule itself
  from `onTextLayout` line rects behind one widening clip. Web uses an inline background
  gradient that fragments per line, so each rule ends where its line's text does.

**The halo and the burst mark a *moment*, not a state**, and are rendered only for the
frames they run in. Keying either off "is completed" would set every row in a Completed
list going the instant the page painted.

### When the sparks fire

Celebrating every completion turns the animation into something users wait out. By the
fortieth task of the week it is an interruption, and the next request is a switch to turn
it off. `sparkReason` is the gate. It returns *why* rather than a boolean, so tests can
assert the reason:

| Reason | Fires when |
| --- | --- |
| `project-finished` | the last open task in the project |
| `last-in-section` | the last open task in this list's section |
| `streak` | the first completion of a day whose predecessor also had one |
| `effort` | estimated at two hours or more |
| `priority` | P1 or P2 (`p2`'s label is "High") |

Finishing outranks what finished it: the last task in a project being a two-hour P1 makes
the moment the project ending, not the task's size.

**A row cannot know it emptied a section, so its surroundings tell it.** Web publishes
counts through two contexts in `task-row-behavior.tsx`. Section and project are provided
at different depths — a project page groups by status, so the project's last open task is
not the last in any group — and one context would have the inner erase the outer. Mobile
passes props, matching the split already documented on `keepsCompleted`.

**A missing count means "this surface cannot tell" and is deliberately different from
zero**, so the inbox, search, and the drag overlay never fire those rules rather than
firing them wrongly. Counts are read at the tap, not at render: by then the row has
already told its list it is done.

**Streak needed a data model that did not exist.** `tasks.completed_at` is the only
substrate and nothing aggregated it. `packages/shared/src/streak.ts` buckets timestamps
into the reader's *local* days (a task finished at 11pm belongs to the day the user was
living in), and `claimStreakDay()` both answers and records in one call. One call rather
than a read plus a note, because *any* completion starts the day — splitting them would
let a second completion moments later claim it again. It is claimed only when completing;
reopening is a correction and must not mark a day nobody worked. The history is fetched
once per session (a provider on web, a module singleton on mobile) and read synchronously,
because the row decides inside the tap handler, where an `await` would cost the frame the
animation exists to use. Not loaded means `false`: an unknown history costs a burst rather
than inventing one.

**Reduced motion lands on the end state and drops the decorative layers** on both
platforms. It never simply plays slower.

One trap already paid for: putting the drawn rule on the text means axe stops measuring
that text's contrast (`color-contrast` skips anything with a background-image), so five
pre-existing findings on completed titles went quiet without the rendering changing. Noted
in `globals.css` — that contrast is ours to watch now, not axe's.

## Shopping lists

A list of things to buy is not a project and not a note. People keep them in
Apple Notes and Google Keep because a task app makes twenty words cost twenty
rows of ceremony — and then pay a different cost, because the grocery list sits
in the same drawer as everything they are trying to think about.

**An item is a task. A list is a project with a `kind`.**

```
projects.kind = 'tasks' | 'list'
tasks.is_list_item        derived from it, by trigger
```

A thing you are going to buy is a small task: it gets ticked off, it can carry a
photo of the label, it can be moved, and it has to come back when you tap it by
mistake while walking. All of that exists and is already careful. A list is *not*
a task — a task is finished once, and a shopping list is **standing**: it empties
and refills forever. As a task it would be a permanently open row, or a
recurrence pretending this Saturday's groceries are last Saturday's work.

`TasksApi` being the one door web, mobile and MCP write through is what decided
it. Undo, the optimistic cache patch, the 680ms completion gesture, offline
persistence, attachments, the widgets — a `list_items` table does not cost a
migration, it costs re-deciding all of those and re-deciding them again each time
one changes. And `matchProject` meant `milk #groceries` filed into a list the day
the column landed.

### One flag isolates list items, and one door applies it

`tasks.is_list_item` is **derived, never written by a caller**:
`task_sync_is_list_item` sets it from the project on insert and on every
re-parent, and `project_cascade_kind` re-flags a whole project when its kind
changes. Denormalised rather than joined because PostgREST cannot express "where
the project's kind is not 'list'" — an embedded `projects!inner(kind)` drops
every task with no project at all — and because a rule you can forget is a rule
that shows someone their groceries in Today.

`TasksApi` grew a third door beside `read()`:

| | Sees |
| --- | --- |
| `base()` | live rows of both kinds. Only the two below may call it. |
| `read()` | the task universe. All fifteen existing reads, unchanged. |
| `readItems()` | shopping-list items. `listItems`, `listCounts`, `clearGot`. |

**Reads by *id* deliberately use `base()`.** The isolation is about lists of
tasks, not about addressing one: an item has a `/task/<id>` link and opens in the
editor, so `getById`, `update`'s prior-state read and `subtreeIds` would
otherwise 404 on rows the app itself had just linked to.

Four rules that are not in that function:

- **An item never enters the task universe** — not Inbox, Today, Upcoming, All or
  Focus. `filterTasks` carries the same condition as a second lock, and as the
  *first* one for anything that builds a list without the API (the demo sandbox
  reads its store directly). `DisplayContext.includeListItems` is the explicit
  opt-in; it is **not** a `DisplayConfig` field, so it can never light the
  "Filter · N" badge or be persisted into a saved view.
- **A list is one row, never forty.** The only way a list reaches Today is a trip
  you deliberately scheduled.
- **Buying bananas does not celebrate.** `sparkReason` returns null for an item —
  `openInProject === 1` is the last item of *every* grocery run, forever, so the
  most repeated action in the app would become the most celebrated one. The gate
  is inside that function so neither row component can forget it. The streak is
  gated at the two call sites instead, because `claimStreakDay()` has a side
  effect and has to be turned away *before* the call.
- **Lists do not count.** `busyness`, the pet's project and tag tallies and its
  last-activity proxy all carry `is_list_item = false` explicitly, since none of
  them go through `TasksApi.read()`.

The calendar trigger learned the same clause: a dated item re-parented into a
list would otherwise leave a live event pointing at a tin of tomatoes.

### Store hints change the order, never what is shown

What matters to someone shopping is not partitioning by shop. It is **not missing
an item because it was filed under the shop they are not standing in**. Every
partition scheme fails that silently, so: one list per *kind of shopping*
(Groceries, Amazon, Hardware — these genuinely differ), and the shop is an
optional per-item hint.

`orderForShop` puts unhinted items and this shop's items together, and sinks the
rest into a collapsed **Better elsewhere** that still shows its count. A hint
records a *preference* ("the bread is better at TJ's"); treating it as a filter
turns a mild preference into a missed item. With no shop known — the ordinary
case — nothing is elsewhere and the list is simply itself, which is how the
feature degrades to a plain list when location is declined or absent.

**`orderForShop` still has no caller.** It sorts a list for the shop you are
standing in, which needs an answer to "which shop is that". Only Places and
geofencing can give one, and neither is wired to a list yet. The function and its
tests are written; the surface that would use them is not. Everything else about
store hints — typing one, showing one, changing one — works without it.

Hints ride in `tags` under an `at:` prefix (`STORE_TAG_PREFIX`) rather than a
column: tags already round-trip through every capture surface and MCP, and a
column would be nullable on every task in the app to describe a field only items
can have. `sameStore` matches on a normalised key and lets either side contain
the other, because the hint is typed by a person ("trader joes") and the shop
name comes from OpenStreetMap ("Trader Joe's #142").

#### Typing a store: `@` names one

`@` names a store the way `#` names a project. Typing `milk @Trader Joe's` in a
list composer creates an item called "milk" carrying the tag `at:Trader Joe's`.

`#` could not be reused. It means project first, tag otherwise, and a shopping
list is a project, so `#target` becomes ambiguous the day someone names a project
Target. `@` was unused, and it reads correctly out loud: milk at Trader Joe's.

**The token runs to the end of the line.** A store name can contain spaces, and
real ones usually do. A `\S+` token would handle `@target`, but it would read
`@Whole Foods` as a store called "Whole" and leave "Foods" in the item name. The
rule is that the store goes last.

The `@` must start the line or follow a space, so an email address inside an item
name is left alone. A trailing `@` with nothing after it matches nothing, which is
the correct reading of a half-typed token.

**Only the list composers parse it.** `parseTaskInput` reads every task title in
the app, where `@` usually means a person, so a global rule would file "@sam" as a
shop. `extractStoreToken` is called by the two list composers and nowhere else.

Three places to set a store:

| Where | Control |
| --- | --- |
| The composer | Type `@`. Stores already on the list are suggested; Tab accepts the first. |
| The row, on hover (web) | A text input backed by a `<datalist>` |
| The long-press sheet (mobile) | `ItemSheet`, which used to be the aisle picker. Store sits above aisle. |

Tab is the same binding `SuggestedFacets` uses for the history's guesses, so the
two cannot come to mean different things.

**The row control is a text input, not a `<select>`.** The answer it collects is
"one of these, or a new one", and a select can only express the first half. Using
one would make the composer the only place a store could ever be created, which is
wrong for the row you are looking at when you realise the bread is better
somewhere else. A `<datalist>` gives the suggestions and keyboard support without
a custom popover.

Suggestions come from `storesOnList`, which counts bought items as well as open
ones. The cart is where the previous shop's stores are, so dropping them when an
item is ticked would empty the suggestions when they are most useful.

**Setting a store is one write. Correcting an aisle is two.** A store has no
lesson to record, because it describes one purchase rather than the words. Buying
batteries at Target once does not mean batteries always come from Target. "Bananas
are produce" is a fact about the language, so that one is stored.

### Aisles: guessed from a built-in lexicon

An item's aisle is guessed from its name, and the list is grouped by it in
walking order, so a shopping list reads as a route rather than an inventory.
`packages/shared/src/food.ts` is the whole thing.

**This looks like the mistake `suggestCategories` already made, and is not.**
That dead keyword table maps "gym" to "Health", and it is wrong for everyone
whose projects are named differently — which is everyone, because a project list
is personal. Food categories are not: "bananas" is produce in every household on
earth, and the category set is a property of supermarkets rather than of this
user's filing scheme. There is nothing personal to get wrong, only the language —
a much smaller and much more stable problem. It is the one place in DoDone where
shipping a lexicon beats learning from history.

Two rules decide between competing matches:

- **The longest phrase wins.** "ice cream" beats "cream", "chicken stock" beats
  "chicken", "frozen peas" beats "peas".
- **Between equal-length matches, the rightmost wins**, because an English noun
  compound is head-final. That single rule gets *both* "chocolate milk" (dairy)
  and "milk chocolate" (snacks) right, which no first-match scan could.

A word is looked up as written, then singularised, then pluralised — the lexicon
is written the way people write shopping lists, which is not consistently
("candles" plural, "sourdough" singular).

- **A single-word entry must be unambiguous across aisles.** "wrap" was listed
  under bakery for tortilla wraps and put *Gift wrap* in the Bakery aisle. It is
  gone; a tortilla is reachable by its own name, and the ambiguous phrases ("gift
  wrap", "cling wrap") are listed where they belong so longest-match resolves
  them. Same shape as "toilet roll" vs "rolls" and "dish soap" vs "hand soap".
- **Unrecognised is a first-class state, not a failure.** It groups into a
  trailing **Other** — never "Uncategorised", since the user did not fail to do
  anything, we did.
- **`groupByAisle` collapses to one unlabelled group** when grouping would gain
  nothing: fewer than `AISLE_GROUP_MIN_ITEMS`, everything in one aisle, or nothing
  recognised at all. So a caller renders the result unconditionally and gets a flat
  list exactly when a flat list is right, which is what stops an Amazon list of
  electronics looking like a broken grouped one.
- **A correction is a tag** (`aisle:frozen`, the same mechanism as the store hint)
  and always beats the guess, with no confidence that could overturn it: the
  lexicon guesses about language, and the user is looking at the shelf. It survives
  every future change to the lexicon, which is why it is stored rather than
  recomputed.

#### Aisle corrections are remembered

A tag fixes *that row*. A shopping list is standing, so the same words come back
next week on a new row and would be guessed wrong again. `list_term_aisles` is the
lesson that outlives the item: normalised item text → aisle, per user.

**It cannot be learned from history, which is the obvious idea.** "Clear bought"
soft-deletes the items and `purgeDeleted()` destroys them an hour later, so
anything derived by sweeping past items would forget everything the user taught it
by the end of the afternoon. Hence a table rather than a `suggestFacets`-style
sweep — the one place in the app where that shape does not apply.

- **The key is the whole item text, minus a leading quantity** (`learnableTerm`) —
  not a head word. Learning "milk" from a correction to "chocolate milk" would be a
  guess about which word carried the intent, and wrong exactly when it mattered: it
  would re-file every other milk on the list. Under-generalising costs one more
  correction; over-generalising costs trust in the grouping. The quantity strip is
  the one concession, because "6 eggs" and "eggs" are obviously the same lesson.
- **The composite primary key `(user_id, term)` is the concurrency story.**
  Teaching is an upsert, so two devices correcting the same word settle on
  last-writer-wins rather than duplicating.
- **`itemAisle` resolves most-specific-first**: this row's own tag, then what was
  taught, then the lexicon.
- **"Automatic" un-teaches**, deleting the row rather than storing a blank. A
  stored "no aisle" would be a third state that has to beat the guess, and nothing
  in the UI means that. It is also why the option is not labelled "Other": clearing
  hands the word back to the lexicon, which usually has an opinion, so the row does
  not land in the Other group.
- **A memory that fails to load is an empty map, never an error.** Without it the
  lexicon still guesses, which is a good answer; a list that refused to render
  because a preference did not load would be a much worse one. The mobile write is
  best-effort for the same reason — the row is already right.
- Web seeds it server-side (so the first paint is already in the taught groups,
  with no visible re-shuffle) and reloads it client-side after a correction. That
  second read is also the only source the demo sandbox has, which is why it is not
  a server-prop-only design with a demo special case beside it.
- **The cart is never grouped.** It is a record of what happened, not a route
  through anything, and aisle headers over it would imply something was left to
  walk.
- **One walking order, not one per store.** Every supermarket differs, but they
  differ around this shape, and wrong-but-consistent still beats unordered.
  Per-store ordering is a real follow-up.

Correcting is a `<select>` on web — keyboard-operable and labelled for free, and
the control genuinely is "which of twelve" — revealed on row hover or its own
focus. On mobile it is a long-press, because the row's two tap targets are already
spoken for (see *The item row* below) and a third visible control would cost
mis-ticks.

#### The aisle is what the ring carries

`AISLE_COLOR` and `AISLE_ICON` in `packages/shared/src/food.ts` give each aisle a
hue and a Phosphor icon, and `aisleRing` hands a row both. On mobile the item
row's leading circle draws them, so a shopping list reads as a route before a
word of it is read.

- **Because the project cannot.** On a task the ring carries the project, which
  is the thing that differs down a list. Every item on one shopping list has the
  *same* project, so drawing it would paint the screen one colour and say
  nothing. The aisle is the variable that actually differs, and it is nominal —
  produce is not more than dairy — which is what hue is for. Same reasoning as
  `rowGutter`'s, in *The task row*.
- **Twelve hues cannot all be told apart at 21px, and do not have to be.** The
  icon is the primary reading and the list is already grouped under aisle
  headers. The colour is what makes the grouping visible while scrolling, and
  what makes a mis-filed item stand out among its neighbours.
- **The icons are the same `ph:` tokens `projects.icon` holds**, so
  `parseProjectIcon` draws them and no surface needs a second code path. Fill
  weight for the reason the project picker defaults to it: at this size a line
  weight lands under a device pixel. `food.test.ts` asserts every aisle's token
  parses — a name that is not in the curated catalogue draws an empty ring, on a
  device, with no error anywhere.
- **A completed item's ring fills with its aisle colour**, so the cart stays as
  colour-coded as the list above it.
- **Unrecognised gets `NO_AISLE_COLOR` and no icon** — chosen rather than
  missing, the same way a task with no project gets a deliberate neutral.
- **The aisle is computed per item, not taken from the section.**
  `groupByAisle` collapses to one unlabelled group on a short list, so reading the
  group would leave a three-item list with grey rings.

### The surfaces

Both apps go through `@do-done/shared/lists` — `openItems`, `gotItems`,
`summarizeList`, `listSubline`, `itemSubline`, `splitProjects` — so a count cannot
mean one thing on the laptop and another on the phone. An empty list says
**"Nothing on it"**, not "0 items": empty is a shopping list's resting state, not
a number worth printing.

| | Where |
| --- | --- |
| Web | `Lists` under Projects in the sidebar → `/lists` → `/lists/<id>` |
| Mobile | The **Lists** tab → `/lists` → `/lists/<id>` |

Neither list screen uses the app's list machinery — not `TaskDisplayView`, not
`GroupedTaskList`. Every axis those exist to offer (group by status, sort by
deadline, filter by priority) is meaningless on things to buy, and the row they
draw spends its width on a project ring and an urgency gutter a list has no use
for. What is left is a checkbox, a word, and a field that must not lose focus.

**The composer commits without dismissing** — Enter clears the field and keeps the
keyboard, the sheet and the list; a running "N added" is the receipt. Capture here
is a burst, not one item, which is the one place a list composer must diverge from
the task composer. On mobile that is `blurOnSubmit={false}` plus
`submitBehavior="submit"`.

**Put away soft-deletes**, which is what makes a list standing rather than
disposable: the list survives, its history does not pile up in it, and the ids it
returns are an undo token `TasksApi.restore` takes directly. It was called "Clear
bought" until the pantry landed — see *Putting a list away no longer destroys
anything*.

**Web's sidebar section appears only once a list exists.** A permanent heading
for an unused feature is exactly the clutter this design argues against.

**Mobile went the other way**: Lists is one of the four tabs, always there. A
tab is not a heading in a list of headings — the bar has four slots and each one
is a place, so a permanent slot costs reach rather than clutter. See *The bottom
bar (mobile)*.

#### The item row: the circle completes, the text opens the editor

An item is a task, so it has everything a task has — notes, a photo of the label, a
store hint, a deadline. The row is the only way in to any of that, so its two
halves do two different things:

- **The circle ticks it off.** Nothing else does. On mobile the ring is 21px and
  the thumb is not, so its `hitSlop` stretches the target to the full height of the
  row and past its left edge — a walking tap still lands without looking.
- **The words open the item's editor** — web's app-wide `OpenTaskProvider` modal,
  mobile's `TaskEditModalV2` sheet.

The whole row used to tick. A click meant for "what did I write here" bought the
thing instead, and the only sign was a row moving into the cart.
`list-view.test.tsx` is the regression on web; there is no renderer on mobile, so
that half is verified on the simulator.

**On mobile the tick is the same gesture a task's is** (`components/ListItemRow.tsx`).
It was not: the row had no animation, no haptic, no undo, and it only reached the
cart when the refetch landed. It now shares `useRowExit`, `StruckText` and the
timings in `@do-done/shared` with `TaskItem`, so the ring flinches and fills, a
halo rings out, the title is struck through, and the row holds at full height
before collapsing. Swipe right to tick off, swipe left to delete — both with the
undo toast the rest of the app gives.

- **Not `TaskItem` itself**, for the reason the screen is not `GroupedTaskList`:
  that row spends its width on an urgency gutter, a project ring, a focus star and
  a subtask breadcrumb, none of which an item has. What is shared is the
  behaviour, not the layout.
- **The swipe-left panel is one tile.** A task offers Today and Tomorrow beside
  Delete; a thing to buy has no day worth moving.
- **No burst and no streak**, as before. `sparkReason` already returns null for an
  item — the last thing in the basket is the last thing in *every* basket — and
  buying milk must not hold a run of working days alive.
- **A tick moves the row; it does not remove it.** So `toggleComplete` patches the
  item's status into `listKeys.items()` in place rather than filtering it out, the
  one root in the app with that shape. Without it the row collapsed out of its
  aisle and the item reappeared in the cart a round trip later, which reads as it
  vanishing and coming back. `lib/list-item-complete.test.ts` asserts the frames in
  between, since the settled state was always right.
- **The `keyExtractor` carries which side of the list the row is on**, not just the
  id. A row shrinks its own height on the way out, and the patch above then moves
  it between the aisles and the cart. Keyed by id alone, React reconciles those as
  the same element whenever the row lands at the same index in the flattened list,
  so the instance survives with its exit state still collapsed and is drawn at zero
  height in its new section. With one item on the list that is *every* time: a
  "Got it · 1" header over nothing at all. This is the `keepsCompleted` trap on the
  task row, reached from the other direction, and it is invisible to CI — there is
  no renderer here, so it was caught on the simulator and can only be caught there.

#### The row shows the store and the scheduled day

`itemSubline` in `@do-done/shared` builds the muted line under an item's name. It
returns the store, then the scheduled day, then the deadline. The caller joins the
parts with a middot.

**An unset field adds nothing to the line.** No placeholder, no empty chip, no
reserved space. Most items have a name and nothing else, so most rows are a single
word. This is the rule `rowSubline` follows for tasks.

**An overdue item prints its age rather than its date** — "3 days ago", not
"Aug 26". The age says this is something you keep forgetting, which a date does
not.

`itemSubline` does not call `rowSubline`, because a task row and an item row need
different facts. An item has no project worth naming, since it is the list you are
looking at. It has no status worth naming, since the tick says it. It has no
recurrence. It does have a store, which a task row has nowhere to show. The only
part they share is the date.

Two layout rules:

- **The title wraps.** Web used to set it to one line with an ellipsis, inside a
  grid that split into two columns from `sm`, so names clipped at roughly half the
  page width. The grid splits at `lg` now, and the title wraps to as many lines as
  it needs.
- **Both rows align to the top.** A ring centred against a two-line title looks
  detached from the word it ticks off. On mobile this meant moving `flex: 1` off
  the title and onto the column that wraps the title and its subline. Flex-basis
  resolves against the container's main axis, so a `flex: 1` left on a `Text`
  inside a column sets a vertical basis of 0 and collapses the title to height 0.
  This is the same mistake already documented on the task row's title.

**A list's own name, icon and colour are editable from the list.** Web's
`ProjectActions` — the same Edit button a project page has, since the form behind
it already knows how to say "Edit list" — sits in the header of `/lists/<id>`.
Mobile's `ProjectFormSheet` grew an edit mode beside its create mode (prefill,
Save, and a Delete behind a confirm), opened from the pencil in the list's title
bar. That sheet is also mobile's only way to delete a list.

**Two cache bugs came out of the same root**, and both are worth not
re-introducing. A list's items live under `listKeys`, not `taskKeys`:

- The optimistic sweeps in `task-queries.ts` are scoped to `taskKeys.all`, so
  ticking an item wrote to Supabase and left the row exactly where it was until the
  screen was left and re-entered — on the one surface where the tick *is* the
  feedback. `TASK_LIST_ROOTS` is now the list of roots holding a `Task[]`, and every
  sweep walks all of them. Only `listKeys.items()` is in it: `index()` caches
  `Project[]`, which is an array and would sail through an `Array.isArray` guard
  into an updater written for tasks.
- `createProject` invalidates the project caches, which the lists index is not among,
  so a list created on the phone left the screen saying "No lists yet".
  `ProjectFormSheet` invalidates lists explicitly after every write.

`listKeys` is therefore *defined* in `task-queries.ts` beside `tagKeys` and
re-exported from `list-queries.ts`, because the reverse import would be a cycle.

### The pantry: what you bought before

A shopping list never finishes. It empties and refills, and most of what goes on
it has been on it before. `list_pantry` records that history, so putting an item
back is one click instead of typing the word again.

**The history could not be derived from past items.** `TASK_TRASH_RETENTION_MS` is
one hour, and `purgeDeleted()` runs on every launch and every return to the
foreground. Putting a list away soft-deletes its bought items, and the purge
destroys them within the hour. Anything computed by sweeping past items would have
forgotten the week by that afternoon.

Keeping those rows instead is the obvious alternative and does not work. Buying
milk weekly for a year is 52 rows for one word, each carrying its own tags,
attachments and sort order. The drawer would have to group them back into one line
anyway, and "deleted" would stop meaning deleted.

```
list_pantry (user_id, list_id, term)
  title            as last written
  last_bought_at
  buy_count
  gaps             days between the last ten buys, oldest first
  store            where it was last bought
```

`term` is `learnableTerm(title)`, the same key `list_term_aisles` uses, so "6 eggs"
and "eggs" are one entry. The composite primary key handles concurrency the same
way that table does: two devices ticking milk settle on last-writer-wins rather
than creating a duplicate row.

**The pantry is per list. `list_term_aisles` is per user.** They are kept separate
on purpose. "Bananas are produce" is a fact about the language and holds on every
list someone keeps. "Milk comes from Trader Joe's" is a fact about one kind of
shopping. Folding one into the other would scope the aisle memory down to a single
list, so the pantry stores no aisle at all and `itemAisle` still answers that
question.

**A buy is recorded in `TasksApi.update`**, the one door web, mobile and MCP all
write through. `clearGot` was the other candidate and would miss two cases: an item
ticked but never cleared, and an item deleted by hand after being bought.

The write is fire-and-forget, and its errors are swallowed, for the same reason as
the pet code beside it. The task row is already correct. A lost pantry entry costs
one extra correction later; a failed tick costs the user the thing they came to
buy.

**`record_pantry_buy` does the upsert, the count and the gap in one statement.**
Reading the row, computing the gap in the client and writing it back would take two
round trips on one of the most repeated actions in the app, and would lose a buy
when two devices tick the same item at once. Same-day repeats are ignored, so tick,
untick and tick again cannot inflate the count or store a zero-day gap.

**A missing or unreadable `list_pantry` degrades to a plain shopping list.**
`PantryApi.load()` returns an empty array rather than throwing, so the drawer and
the due strip simply do not render, and the record error is swallowed inside
`TasksApi.update`. The row and `@store` need no schema change and work either way.

#### Putting a list away no longer destroys anything

"Clear bought" is now **Put away**. The write is unchanged — the bought items are
still soft-deleted, and `TasksApi.restore` still takes the returned ids as an undo
token. What changed is that each of those items was recorded in the pantry when it
was ticked, so nothing worth keeping is lost.

**So clearing stays one unconfirmed tap.** Making it harder would cost time on
every shopping trip to prevent a loss that no longer happens. The extra step moved
to deleting a pantry entry instead, which is the one action on these screens that
cannot be undone: an ✕ on hover on web, a long press on mobile, one item at a
time.

#### The drawer, and what it leaves out

The drawer sits below the list and holds three bands: last 2 weeks, last 2 months,
earlier. `pantryBands` builds them, newest first within each, and drops any band
that is empty.

**Only the first band is open.** After a year "Earlier" holds hundreds of rows, and
a list screen should not open two screens below its own list. You reach that band
through the composer instead: `searchPantry` matches a few typed letters against
every entry, including those in collapsed bands, and adds the item with its store
attached.

**Entries already on the list are excluded**, from both the drawer and the
suggestions. This stops the drawer duplicating the list. It also makes an
accidental tick self-correcting: un-ticking puts the row back on the list, which
hides its pantry entry again.

**The sandbox seeds a history across all three bands.** An empty drawer shows
nothing useful, and a visitor to `/demo` has no shopping history of their own.

#### Cadence: measuring the rhythm rather than guessing it

The two-week and two-month bands approximate an item's buying rhythm rather than
measuring it, so they mis-sort some items. Rice bought three weeks ago lands next
to a genuine one-off. Milk bought fifteen days ago drops a band.

Once an item has been bought three times, its own gaps answer the question
directly. The list opens on **Probably due**: entries past their own measured
interval, each a pill that adds the item. The bands stay below for anything with
fewer than three buys, which is every entry on the first shop after this ships and
a shrinking share afterwards.

**Entries are ranked by how far past its rhythm each item is, not by age.** Two
weeks late on milk matters more than two weeks late on rice, and only the ratio
captures that.

Four rules, each of which stops the feature becoming annoying:

- **Three buys before it claims anything** (`CADENCE_MIN_BUYS`). Two buys is one
  gap, and one gap proves nothing. Salt bought in January and again in March would
  otherwise announce a two-month rhythm.
- **A median, not a mean.** This is why `gaps` is an array rather than a running
  average. One holiday drags a mean far enough that a weekly item never reads as
  due again.
- **Due expires** (`CADENCE_STALE_FACTOR`, three times the interval). Past that an
  item has been abandoned rather than left late. Without the ceiling every item
  eventually becomes due and stays due, and something given up on years ago ranks
  first.
- **The label hedges.** `cadenceLabel` says "about weekly", not "every 7 days". The
  estimate comes from a handful of shopping trips, and the wording should say so.

The strip is capped at six pills (`CADENCE_MAX_SUGGESTIONS`), and due entries are
removed from the bands below, so nothing is offered twice on one screen.

### Known traps

- **A write built from a filtered getter destroys what the filter hid.** The demo
  sandbox's `create`/`update`/`reopen` did `write([...this.tasks, task])`, and
  `write` replaces the whole array — which already made the previous delete
  un-undoable, and would have wiped every list item. They build from `allTasks` now.
- **An optimistic append plus a parent re-sync is a race**, and which side wins
  differs by surface: against Supabase the append lands first, but the demo's write
  is synchronous so its re-render arrives *before* the append and the row showed
  twice. Both composers dedupe by id.
- **`Project.kind` and `Task.is_list_item` are optional on read**, and default to
  `tasks`/`false` through `projectKind()`. A deploy that lands ahead of its migration
  must not fail to parse, and defaulting either the other way would hide a whole
  project's tasks from the app.

## Deleting a task

The other way a row leaves a list, and until recently the only one with no gesture
at all: the row was there, the list came back one shorter, and nothing on screen
said which. **Deletion is the opposite of the completion gesture**, not a red
repaint of it, and the two must not be confusable at a glance:

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
*shorter* than the completion's 680ms and travels further. That hold marks a
state the task passed through; this one only has to be long enough to see which
row is going.

Constants and their rationale live beside the completion's in
`packages/shared/src/constants.ts`. `delete-motion.test.ts` asserts the
relationships rather than the numbers: leftward against rightward, shorter against
longer, and both envelopes comfortably inside the undo window.

- **The row hears about its own deletion through a window event**
  (`lib/task-delete-events.ts` on web). A completion is started by a control *in*
  the row, so the row can animate itself; nothing about a deletion is. It comes from
  the right-click menu, the editor modal (which may be open over a different page
  entirely), the bulk bar, and a keyboard shortcut — none of which own a row, and two
  of which act on rows that are not mounted. The fan-out comes with it: a task showing
  in two lists is two rows, and both are leaving.
- **`useDeleteTasks` is the one door**, and it fixes the sequence at the door rather
  than at four call sites: announce, write, toast, then refresh once the envelope is
  spent, so the removal lands on an already-invisible row. Two of those call sites used
  to show an undo toast, one showed nothing at all, and deleting from the editor modal
  was a permanent delete with nothing offering it back.
- **The condemned wash outranks selection and hover both.** A row that is going has
  nothing useful left to say about being picked or pointed at, and this is the only
  moment red means "leaving" rather than "overdue".
- **The dim holds its value through the collapse.** Letting it lapse there multiplies
  a row fading to zero by one fading back to full, and the row visibly *brightens* on
  its way out — which is why the travel layer carries two transition durations, one per
  property.
- **Mobile has no confirm dialog either.** It had one, and its stated reason was the
  absence of an undo; that reason is gone. Asking first *and* offering an undo
  afterwards is asking twice. `deleteTask` takes a `holdMs` so the optimistic cache
  patch waits for the animation, exactly as `toggleComplete` does.

### Undo gives back the same task

**Nothing is destroyed when you delete.** `tasks.deleted_at` is stamped, the row is
hidden from every read, and `restore()` clears the column again. So the task that comes
back is the same row: same id, same subtasks, same attachments, same location links,
same pet history — and every `/task/<id>` link handed out before the delete still works.

It used to recreate from a client-side snapshot (`create(toCreateInput(task))`), which
gave back a *new* row wearing the old title. Its subtasks and files had gone with the
cascade the moment the hard delete landed, and nothing the client held could bring them
back. The Undo button was misreporting what it did.

| Method | What it does |
| --- | --- |
| `TasksApi.delete(id)` | Stamps `deleted_at` across the subtree. Returns the ids it touched. |
| `TasksApi.restore(ids)` | Clears it again. One UPDATE, idempotent. |
| `TasksApi.purgeDeleted()` | Hard-deletes anything past `TASK_TRASH_RETENTION_MS`, clearing the Storage bytes first. |

- **The returned ids are the undo token.** They were computed against the *live* tree,
  so a subtask deleted separately five minutes ago is not among them and the parent's
  undo correctly leaves it deleted. They also cover rows the caller never knew about — a
  task's subtasks are not on screen, so undo cannot work off what the list handed it.
- **Every read filters, and there is one place to forget it.** `TasksApi.read()` is the
  private helper all fifteen reads start from, and it is the *whole* mechanism:
  **`tasks_select` is the plain `user_id = auth.uid()` and must stay that way.** Reads
  outside `TasksApi` — busyness, project counts, the pet tallies, the calendar re-push
  routes — each carry the filter explicitly, because a deleted task that still counts
  against its project makes the sidebar disagree with the list it opens.
- **A select policy may not hide a deleted row, and this was tried.**
  `20260810000002` added `and deleted_at is null` to `tasks_select` as a backstop, and it
  made deleting impossible. Postgres applies SELECT policies to an UPDATE's *result* rows
  when the statement has a RETURNING clause, and PostgREST's UPDATE always has one — it
  reads the count back out of a CTE even under `Prefer: return=minimal`. The write landed,
  the resulting row had `deleted_at` set, the policy rejected it on the way back, and every
  delete on both apps came home 403. (The USING clause being checked against the row as it
  *was* is true, and is the other half of the sentence.) It also killed `purgeDeleted()`,
  whose `not deleted_at is null` lookup runs over the anon key from the apps and matched
  nothing. `20260811000001` reverts it; the reasoning is written out there.
- **`restore()` never reads the rows it restores.** It is one UPDATE by id, which is what
  makes it idempotent and lets it run without the caller holding anything but the ids
  `delete()` returned.
- **The calendar trigger knows about it.** A soft delete is an UPDATE, so the trigger's
  DELETE branch never fires and a deleted task's Google Calendar event would sit there
  forever. One clause — `deleted_at is null` — in each syncable predicate turns a delete
  into the existing "enqueue a delete" branch and a restore into the existing "enqueue an
  upsert" one. `isSyncable` in the calendar worker carries the same clause and **must stay
  in step**, or an upsert queued from before the delete re-creates the event.
- **This is not a trash can.** Nothing in either app lists deleted tasks or offers a way
  to reach them, and `TASK_TRASH_RETENTION_MS` is an hour — close to the undo window rather
  than comfortably past it, because "deleted" has to keep meaning deleted. The window is
  slack for the purge sweep, not a feature.
- **The purge is driven from the apps**, riding along with the status-sync sweep on both
  platforms (web's `StatusSyncRunner`, mobile's `sweepStatusSync`). Same shape, same
  reasoning: one filtered read that finds nothing in the ordinary case, and no
  infrastructure a preview deploy will not have. It never triggers a refresh — the rows it
  destroys have been invisible since they were deleted.
- **The demo sandbox soft-deletes too**, and needs the filter in *two* places:
  `DemoTasksApi`'s `tasks` getter, and `useDemoData`. The demo screens read the store
  directly rather than calling `list()`, so without the second one a deleted task simply
  stayed on screen. The real app has no equivalent gap; its lists are server components
  that go through `TasksApi` like everything else.

### The undo window

`UNDO_TOAST_TTL_MS` is **9 seconds**, up from six, and both platforms read it from
`@do-done/shared` so the promise cannot differ by platform. Six was measured against the
wrong thing: the time it takes to *read* the toast, not the time it takes to notice the
list is wrong, work out which row went, decide that was not what you meant, and get the
pointer down there.

The toast is the only way back from a deletion, so it stops being a white card on a white
page:

- **Dark on both themes**, outside the page's palette entirely. It is the only element on
  screen that is temporary and irreversible if missed.
- **Undo is a filled control**, not a text link beside a message.
- **The window is drawn draining** — a hairline bar under the button, linear because it
  reports a fact rather than expressing a feeling. That is the difference between "there is
  an Undo" and "there is an Undo *and you have time*", which is why the window was
  widened.
  Web sets the CSS animation's duration from the constant; mobile drives an
  `Animated.Value` from the same mount as the dismiss timer. Either way the bar and the
  timer cannot disagree.
- **⌘Z takes it back** (web), bound only while a toast with an undo is up, and never when
  the event target is an input, textarea, or contenteditable. The shortcut is a convenience
  over the button and must never be the reason a half-typed title loses its last word. The
  binding is advertised on the button, since one nobody is told about is one nobody
  presses.

## Swiping a task row (mobile)

Swipe **right** for the single Done/Reopen action, which the row plays itself and then
closes. Swipe **left** for Today / Tomorrow / Delete, which are buttons and wait to be
tapped.

### Wait for the swipe to settle before completing

**A swipe past the threshold says two things, and they are sequential**: the row is let go
of, and *then* the task is done. Both used to fire on the release frame, so the check had
sprung, the halo had rung out and the strike-through was drawn while the row was still 90px
to the right and travelling. The travel then read as the row catching up with something
that had already happened, which is what made a return that really was animating feel like
a snap back to the edge.

Two constants in `apps/mobile/lib/swipe-actions.ts`, derived from each other and tested
together:

- **`SWIPE_RETURN_SPRING`** is handed to `ReanimatedSwipeable`'s `animationOptions`,
  because **the library's default is not a spring you can see**. It ships
  `{ mass: 2, damping: 1000, stiffness: 700, overshootClamping: true }`, and Reanimated has
  no overdamped solution — anything with a damping ratio at or above 1 is integrated as
  *critically* damped, here at ~19 rad/s. Ours is deliberately underdamped (ζ ≈ 0.81) with
  clamping off, so the row decelerates into its resting place instead of arriving there.
  The overshoot that buys is ~1.4%, and that is the intent: past the row's own edge there
  is only the list background, so a bounce big enough to *see* would read as a gap opening
  beside the row.
- **`SWIPE_RETURN_MS`** is how long the completion waits, matched to that spring's envelope
  (~3% of the distance left, the frame the row visibly lands on). It is a delay in front of
  the completion, not an extension of it: the 680ms exit envelope, the hold the write waits
  out, and the undo window are all downstream and untouched.

The wait is a timer, not the library's `onSwipeableClose`. That event fires when the spring
is *numerically* at rest — later than the frame the eye reads as landed, and never at all if
anything interrupts it, and a swipe that silently failed to complete the task is far worse
than one that completes a frame early. `handleToggle` cancels any pending timer, so a ring
tap during the return cannot be undone by the swipe that was still owed. Reduce motion skips
the wait: there is no travel to wait for.

**`ReanimatedSwipeable` reports the direction of the *gesture*, not the panel that opened** —
the reverse of the `Swipeable` it replaces, and of how `onSwipeableWillOpen('left')` reads.
`panelForSwipe()` in `apps/mobile/lib/swipe-actions.ts` is the one place that mapping is
written down, with the library source quoted. Reading it backwards fails silently and
completely: the row completed the task on the delete gesture, showed "Completed …", and did
nothing at all on the complete gesture — with the Today/Tomorrow/Delete buttons snapping
closed before they could be reached.

**Those three buttons may not be `Pressable`s**, and this is not a style preference. They
are rendered *inside* the swipeable, so the row's pan gesture is their ancestor, and it
activates after ten points of horizontal travel. React Native cancels the press responder
the instant an ancestor gesture handler activates — the same rule that stops a button firing
when you start a scroll on it. So a tap whose thumb was still gliding out of the swipe that
opened the panel was swallowed whole: `onPress` never ran, nothing was written, and the
swipeable's release handler re-settled the panel where it already was. No error, no toast,
no row movement, and a second tap usually worked. They are `BaseButton`s from
gesture-handler now, with `disallowInterruption`, so the press is decided in the arena the
pan competes in and claims the touch on the down event rather than losing to the pan
afterwards. The trade is that a drag can no longer *start* on a button; the row body is
still there to drag, and it is what closes the panel.

**The cancel, the patch and the rollback around an optimistic write must name the same
roots.** `patchTaskLists` grew a second one when shopping lists arrived
(`listKeys.items()` holds ordinary task rows), while `cancelQueries` and the snapshot either
side of it still said `taskKeys.all` alone. Both gaps read as the same thing — the row not
moving. `invalidateTasks()` refetches `listKeys.all` after *every* write, so on a list there
is usually a fetch in the air; it was sent before this write existed, so its answer is the
state the user is trying to change, and landing on top of the patch puts the row back for a
whole round trip. `cancelTaskFetches()` and `snapshotTaskLists()` both walk
`TASK_LIST_ROOTS` now, and `task-optimistic-scope.test.ts` is the regression.

**Completion writes are serialized per task id** (`completionChains` in
`lib/task-queries.ts`). Undo is a second write to the same row while the first is still in
the air — the toast goes up as the completion is sent, and the row is still being held for
its collapse animation — so fired concurrently the two UPDATEs race and the row keeps
whichever reached Postgres second. Chaining makes the last *intent* the last write. The
sequence number a call claims before joining the queue also tells a superseded write to
leave the cache alone; otherwise its `dropFromLists()` fires mid-undo and takes back the row
the user just recovered.

The toast waits for the write to land, and a failed undo reports that instead of leaving a
button that visibly does nothing. `Toast.undo` is therefore optional: a message-only toast
renders without the button.

Delete is the exception to all of it — a hard delete behind a confirm dialog, with no undo.
`TasksApi.delete()` clears Storage bytes and cascades subtasks; there is no row left to
restore.

## The task row: two coloured slots (mobile)

**The row has exactly two places colour is allowed, and each carries one
variable.** Everything else that used to be a chip is one muted line of text.

| Slot | Variable | Why that channel |
| --- | --- | --- |
| The **ring** (leading circle) | Project — its colour, and its `icon` when set | Hue is a *nominal* channel: it says which, not how much. A project is a label with no ordering, so colour fits it. |
| The **gutter** (10px, left of the ring) | Urgency — a red dot when overdue, then a bar whose length falls with the rank, nothing for a P4 | Priority is *ordinal*, and the channels that carry order are position and length. Red–orange–yellow only reads as a ranking because traffic lights taught us, and that breaks the moment a user picks red for their "Home" project. |

Rules, all of which matter:

- **P4 draws nothing; P3 does.** They are not the matched pair the names suggest.
  `tasks.priority` is `not null default 'p4'`, so P4 is what a task gets by *not*
  being triaged — the widget, a deep link, and every MCP create land there. A mark
  for P4 would be a mark for absence on nearly every row, and a signal that fires
  everywhere stops being a signal. P3 is the lowest rank someone actually chose, so
  it is the lowest one worth drawing. It is the only cool mark in the column: slate,
  so it reads as ranked rather than urgent, and deliberately not the indigo accent,
  which means *selected* everywhere else.
- **A task cannot *not* have a priority.** The column is `not null default 'p4'` — no
  null, no `none`, and no surface offers one. So P4 does two jobs indistinguishably:
  it is the rank called "Low", and it is what a task carries when nobody chose. That
  is why the line falls there rather than somewhere tidier. Separating them would let
  all four ranks draw, but it means a migration plus every priority surface (the check
  constraint, `TaskPriority`, the focus score, the `#p1`–`#p4` parser, display grouping
  and filters, both pickers, the widget, the MCP enums). Until someone wants that, this
  is where it stands.
- **"Low" is the only name that rank has**, on both platforms, in the editor, the
  context menu, and the quick-add chip. Mobile's composer briefly offered a fifth row
  reading "No priority", which set the draft to null and so created a P4 — the same task
  the Low row makes, under a name for a state that does not exist. Re-tapping the
  selected rank still clears the chip, and that is also a P4; it just reads as undoing a
  choice rather than as a fifth rank.
- **Overdue outranks priority** in the gutter, and is the only thing in that column that
  is ever red. Being late is also said in the title's weight, so it reads from further
  away than a coloured chip did.
- **An unset field takes no space at all** — no placeholder, no empty chip. `rowSubline`
  returns only the parts that exist, so a bare task renders a title and nothing else.
- **The surface hides a day, never the value.** A row prints its scheduled day like any
  other fact, "Today" included; `hideScheduledDay` is how a caller says *I have already
  named this day* — a section header reading "Today" or "Tomorrow", an Upcoming day
  column, or the Today screen, which sets it per row so a Focus task scheduled Friday
  still says Friday. This used to be decided by the value: `schedulePart` swallowed
  "Today" wherever it appeared, on the Today-screen reasoning above, and so on Inbox,
  All, a project, a tag and search a task scheduled today rendered exactly like an
  undated one — while tomorrow's said "Tomorrow". The one day a list most needs to point
  out was the one day it did not. An overdue task ignores the flag and prints its *age*
  ("3 days ago"), which is the actionable form, and which no header ever repeats:
  "Overdue" is not a day.
- **A project with no icon is a first-class state**, not a fallback — the ring is still
  its colour. A task with no project gets a deliberate neutral.
- **Completion fills the ring with the project's colour**, the same way for every
  priority. Done is a state, not a rank; the reward must never vary by how important the
  task was.

The decisions are pure functions in `packages/shared/src/task-row.ts` (`rowGutter` /
`rowSubline` / `rowEstimate`), not in the component, because `apps/mobile` has no
renderer to test a component with (see Testing) and because web will want the same
answers when its row follows. `RECURRENCE_PRESETS` moved there too, so the label a row
prints can never drift from the option the editor's picker set.

**Both platforms encode it the same way, and only the anchor is shared.** The two
`TaskItem`s are independent (`apps/web` Tailwind, `apps/mobile` StyleSheet). They agree
on the ring and the gutter — both call `rowGutter` — but not on what follows the title:

- **Mobile** collapses every chip into `rowSubline`'s single line of text, because
  nothing in that row was interactive anyway.
- **Web keeps its chips**, because there they are *editors*: priority, project, estimate,
  and schedule each open a popover in place. Collapsing them into text would delete four
  inline controls to save a line. The project chip drops only its colour dot, which the
  ring now carries. Turning them into a subline that swaps back to editors on hover is a
  real option, and a separate change.

**Web-only detail:** the gutter is also the priority editor's button, so a P4 row has an
invisible control. A faint placeholder fades in under the pointer (`group-hover/row`) to
keep it discoverable.

**A title with no `flex` of its own.** `styles.title` must not set `flex: 1`. The text is
handed to `StruckText`, which wraps it in a View — a *column* container — so `flex: 1`
there means `flexBasis: 0` on the **vertical** axis and collapses the title to height 0.
Filling the row is `StruckText`'s root's job. When this was wrong, every row without a ★
rendered no title at all, on every screen; only focused rows survived, because the star
gave the row a height to centre against.

Two follow-ups deliberately left out: dropping the project from the subline when it
repeats the row above (needs list-level context at every call site — `hideProject` is the
prop, and `app/projects/[id].tsx` already passes it), and the section-header changes
(capacity, create-into-group). One divergence worth revisiting: web still paints an
overdue date chip red, so an overdue row there says it three ways (gutter, weight, chip)
where mobile says it two.

One behaviour was removed on purpose: the row's project chip used to open a picker
inline. The chip is gone and no other element in the row is a natural target, so the
picker now lives only in the editor, one tap away.

## Quiet rows and detailed rows (web)

Web can now draw the row either way, and it is a Display setting:
`DisplayConfig.rowStyle` is `"quiet"` or `"detailed"`.

| | What the row shows |
| --- | --- |
| `quiet` (default) | One muted line under the title, plus a date column on the right. Colour appears twice: the project ring and the urgency gutter. |
| `detailed` | The chips as they were — each fact its own filled pill, and each pill an editor you open in place. |

Quiet is what the mobile row has always drawn. Both platforms now build that
line with `rowSubline` from `@do-done/shared`, so they cannot word the same task
differently.

- **It is a setting because the trade is real.** Quiet gives up four inline
  editors (project, estimate, status, and the chips' hover targets) to get a
  calm list. Which one you want depends on whether you are reading the list or
  working through it, so it is a control rather than a decision.
- **It is a top-level field, not a `filters` clause** — same reasoning as
  `showSubtasks`. It describes how a list draws, not a narrowing the user
  applied, so it must never light the "Filter · N" badge.
- **It defaults to `quiet`, and `parseDisplayConfig` backfills that** for every
  config saved before the field existed. This deliberately changes how existing
  saved views look; the setting is how you get the old row back.
- **Mobile has no such switch.** It has never had chips to go back to.
- **`useIsQuietRow()` threads it**, exactly like `useIsCompact()` — through
  `TaskRowBehaviorProvider`, because `TaskItem` is rendered from a dozen call
  sites that shouldn't each have to carry the value.

Two shared-package additions make the split possible without duplicating rules:

- **`rowSchedule(task, ctx)`** returns the "when" part on its own — the
  schedule, or what a finished task says in its place. `rowSubline` calls it for
  its first part, so there is one implementation.
- **`RowSublineContext.hideSchedule`** drops exactly what `rowSchedule` returns,
  for a caller drawing the date in a column of its own. Web's quiet row sets it;
  mobile does not, because a phone row has no width for a column.
- **`RowSublineContext.hideStatus`** is the status-shaped twin of
  `projectName: null`: a status-grouped list has already put the word in the
  header above every row it applies to. Web passes its existing
  `hideStatusBadge`; mobile's `GroupedTaskList` passes `config.group ===
  'status'`, which it had never suppressed before.

**The quiet row drops the edit pencil and halves the action strip** (`w-12` →
`w-6`). A click on the row already opens the editor, and so does the context
menu. The strip still reserves a fixed width, and that part is not cosmetic:
the date is placed by `ml-auto` against this strip, so a strip that varies in
width moves the column the dates are trying to form.

## Sticky list headers

**The page title and the group headers stay on screen.** Before this, one screen
into a long list nothing said which list you were in or which section a row sat
under.

The two platforms needed opposite fixes. On web everything scrolled away. On
mobile the screen title was already pinned — it is a `View` above the list, not
part of it — and only the section headers were missing.

### Web

Three CSS variables in `globals.css`, applied through three classes, because the
offsets stack:

| Token | What it is |
| --- | --- |
| `--dd-appbar-h` | The app shell's own top bar. `3.5rem`, zeroed at `md` where the bar is `md:hidden`. |
| `--dd-pagebar-h` | The list's own sticky title bar. |
| `--dd-stick-top` | What a sticky *group* header sets `top` to. |

`.dd-stick-scope` raises `--dd-stick-top` for the subtree `StickyPageBar` wraps,
so a group header pins under the page bar on a view that has one and under the
app bar on a view that doesn't (the project page draws its own heading). No call
site carries a number of its own.

- **`StickyPageBar` keeps the big title in flow and hands off to a 48px bar.**
  Pinning the heading at full size would spend ~56px of every screen on a word
  the sidebar already highlights. The Display menu lives in the bar, so it stays
  reachable — it used to scroll away with the title.
- **The handoff is an IntersectionObserver on a sentinel, not a scroll handler.**
  It answers the question when it changes rather than on every frame, and it
  works however the scroll happened. `rootMargin` accepts neither `calc()` nor a
  custom property, so the tokens are resolved to pixels in JS and re-resolved on
  resize — crossing the `md` breakpoint changes one of them.
- **A pinned header must have an opaque background.** Without one, rows scroll
  through the words instead of under them. A static screenshot cannot show that
  failure, which is why `STICKY_SECTION_HEADER` carries the background rather
  than leaving it to each call site.
- **Group headers already sat inside their own `<section>`**, which is exactly
  the containment sticky wants: a header pins while its own rows are on screen
  and is pushed out by the next one.
- **Two sections are deliberately not sticky.** Today's Focus is capped at
  `FOCUS_MAX` (3) rows, so a header there could never pin before the section
  ended; and both Focus and Overdue are tinted cards, where a pinned band would
  have to match the card's fill exactly or read as a seam.

### Mobile

`SectionedDraggableList` is a `DraggableFlatList` over a flattened array of
header-and-task rows — that flattening is what lets a task be dragged between
sections — so `SectionList`'s `stickySectionHeadersEnabled` is not available and
the indices are computed instead.

**`ListHeaderComponent` occupies index 0 when present**, and VirtualizedList
matches `stickyHeaderIndices` against `dataIndex + stickyOffset` without adding
the offset itself. Forget it and every section pins its first task instead of
its name, which looks deliberate enough that nobody would report it.

The Completed screen was already a `SectionList` with
`stickySectionHeadersEnabled`, so it needed no change.

A shopping list is a `SectionList` too, and was missed: it kept its own copy of
the old 11px uppercase grey header long after the four screens above moved. It
uses `SectionHeader` now, with the aisle's own colour on the dot — so the header
and the rings under it say the same thing — and its rows went full-bleed to match
every other list. They had been floating white cards, which a sticky header sits
badly over and which leaves a swipe panel opening outside the row it belongs to.

### The label itself

`text-xs font-semibold uppercase tracking-wider` dated the app more than
anything else in it, and it also failed at its job: at 12px, grey, in caps the
header was quieter than the near-black rows it named. It is sentence case at
13px (web) / 14px (mobile) in the body colour now, with the count as a pill
rather than "(6)", so it reads as a quantity rather than as part of the
sentence.

The group's colour moved to the dot beside the label instead of tinting the
words. Tinting both spent the same signal twice, and that is what forced the
text so light.

One shared module per platform, `components/section-header.tsx` and
`components/SectionHeader.tsx`, replacing four copies of the same StyleSheet.
Four copies is how a section comes to be named one way on one screen and
another on the next.

### The contrast this exposed

A subline is not a chip. Once the metadata stopped being decoration beside the
title and became the only place a project, an estimate or a place is stated, the
neutral it was drawn in stopped being defensible: `neutral-400` measures 2.5:1
on white. Both platforms' sublines moved to `neutral-500` (4.8:1), and the count
pill to `neutral-600` (`neutral-500` on a `neutral-100` pill measures 4.35:1,
under the bar for 11px text). Mobile's section header went from `#6b7280`
(4.39:1) to `#111827`.

The quiet row's date column has the same problem in a second place: the chip it
replaced sat on its own `orange-50` fill, which lifted `orange-600` to a passing
ratio, while the same text on the page measures 3.58:1. It is `amber-700`
(5.03:1) now — the reason `colors.status.warning` in `packages/ui` is amber and
not yellow.

**Known and measured: muted text is marginal on a *selected* row.** Selection
paints the row `indigo-50`, and because the metadata is now text rather than
chips with their own fills, it composites over that: `neutral-500` measures
4.24:1 there, `red-600` 4.27:1, `amber-700` 4.50:1. Darkening the resting
palette to clear a transient multi-select state would make every ordinary row
heavier to fix the rare one, so it is left as is. The aggregate still moved a
long way the right direction — Chromatic's accessibility diff for the change
was net −422 contrast violations.

## Attachments

A task can carry files. Two halves that must stay in agreement:

| Where | What |
| --- | --- |
| `task_attachments` | The metadata row — name, mime type, size. Cascades with the task. |
| `task-attachments` Storage bucket | The bytes, at `{user_id}/{task_id}/{uuid}.{ext}`. |

**The leading `user_id` segment is required.** Storage RLS can only see an object's path
— it cannot join back to `tasks` — so the owner has to be *in* the key.
`attachmentStoragePath()` in `packages/shared/src/attachments.ts` is the only thing that
builds one. The bucket is private; every read is a short-lived signed URL from
`AttachmentsApi.signedUrls()`.

**Write order is deliberate in both directions.** Upload puts the bytes down before the
row, and deletes the object again if the insert fails. Remove deletes the bytes before
the row. A row pointing at absent bytes renders as a permanently broken attachment,
whereas bytes with no row are merely invisible — so the failure always lands on the
invisible side.

**`TasksApi.delete()` clears the bucket first**, across the task's whole subtree. The
`task_attachments` foreign key cascades, but a cascade only reaches the metadata: a
Storage object has no foreign key to follow, so without this the bytes would sit there
forever with nothing pointing at them. The subtree walk is bounded by the depth-2 trigger
and short-circuits to a single query for a task with no children.

**Rendering is classified once, in `attachmentKind()`** — by extension first, MIME type
second. A `.md` file arrives as `text/plain` from a browser, as
`application/octet-stream` from Android's document picker, and sometimes with an empty
type from a drag-and-drop; the extension is the only signal that survives all three. SVG
is deliberately not an inline image: it can carry a `<script>`, and inlining one would
run it in the app's own origin.

Markdown renders on both platforms but through different machinery, because React Native
has no DOM:

- **Web** — `react-markdown` + `remark-gfm`, with `MARKDOWN_COMPONENTS` mapping its
  elements onto the modal's type scale (there is no `@tailwindcss/typography` here).
  `rehype-raw` is deliberately absent: attachment content is untrusted, so raw HTML in an
  uploaded file must stay inert text.
- **Mobile** — `parseMarkdown()` from `@do-done/shared` returns a typed block tree that
  `MarkdownView.tsx` draws with `<Text>`/`<View>`. Keeping the parse in the shared package
  is also what makes it testable, since `apps/mobile` has no renderer in CI.

Mobile uses two pickers because the platforms split them — `expo-image-picker` for the
library, `expo-document-picker` for files — and reads bytes with `expo-file-system`'s
`File(uri).bytes()` (Hermes has no `atob`, and base64 would inflate a 10 MB file by a
third in memory). **All three are native modules, so mobile attachments need a fresh
`eas build`. They will not arrive over OTA.**

`attachmentKind()` also classifies **audio**, which is what every voice note is. Playback
is `expo-audio` on mobile and a plain `<audio controls>` on web — the browser's transport
is keyboard-accessible and already has a scrubber, so a hand-rolled one would be worse.
Both platforms sign a URL for audio the same way they do for images (`needsSignedUrl`),
and both label a file matching `isVoiceNoteFileName()` as "Voice note" rather than showing
its timestamped storage name.

## Voice notes

**A recording produces two artefacts and DoDone keeps both**: the audio, as an ordinary
attachment, and the transcript, as the task's text. Keeping the audio is the feature, not
a nicety — a recogniser mishears names and numbers constantly, so the recording is the
record of what was said and the transcript is a convenience over it.

**One microphone session produces both.** `expo-speech-recognition` will persist the audio
it is already listening to (`recordingOptions: { persist: true }`), which is why there is
no separate recorder module: two things contending for the mic means one of them silently
gets nothing on Android. It was already a dependency, so the capture half needed no new
native module.

| Where | What |
| --- | --- |
| `packages/shared/src/voice.ts` | `splitTranscript`, `appendTranscript`, file naming, the duration cap. Shared so a sentence cannot become the title on the phone and the description on the web. |
| `apps/mobile/lib/voice-session.ts` | Pure decisions: transcript accumulation, level normalisation, the completion gate, error copy. |
| `apps/mobile/lib/voice-capture.ts` | `useVoiceCapture` — the native module, lazily required so Expo Go degrades to `supported: false` rather than crashing. |
| `apps/mobile/lib/voice-note.ts` | `attachVoiceNote` — bytes out of the cache, up to Storage, cache file deleted. |
| `apps/mobile/lib/use-voice-quick-add.ts` | The create-then-attach flow both quick-add surfaces share. |
| `apps/mobile/components/VoiceRecorder.tsx` | The card: level meter, clock, live transcript. |

Rules that look arbitrary and are not:

- **The transcript splits into a title and a description, but only where there is no
  title yet.** Quick-add takes the first believable sentence as the title, falling back to
  a word-boundary cut at `VOICE_TITLE_MAX_CHARS` when the recogniser returned no
  punctuation (Android's default). The task editor *appends* the whole thing to Notes,
  because the task already has a title. A sentence boundary is only believed after three
  words — dictation punctuates abbreviations too, and "Call Dr." would otherwise title the
  task with half a name.
- **A final result is folded in by prefix, not by appending.** Android's continuous mode
  emits one result per utterance; iOS re-sends everything said so far. Appending blindly
  stutters on iOS, replacing blindly loses every Android segment but the last, and the
  prefix test needs no platform check.
- **A session hands over only once `end` *and* `audioend` have both fired.** The file is
  explicitly unsafe to read before `audioend`, so completing on `end` alone ships a
  truncated WAV — a bug that reproduces on one phone and not another. A grace timer covers
  a recogniser that dies mid-session.
- **The recording is uploaded after the task is created, never before.** An attachment row
  points at a `task_id`, so there is nothing to attach to until then; the file waits in the
  cache across the gap between speaking and submitting. A failed upload reports itself and
  keeps the task — and keeps the local file, since destroying the only copy of what someone
  said over a transient network error is the one unrecoverable outcome here.
- **The name and MIME type come from the URI the recogniser wrote**, not from an
  assumption: Android writes WAV, iOS may write CAF, and neither announces which.
  `attachmentKind` reads the extension before the MIME type, so guessing wrong renders the
  app's own recording as an anonymous download chip.
- **`VOICE_MAX_DURATION_MS` is the attachment size limit expressed as a clock.** 16 kHz
  mono PCM is about 32 KB/s, so the 10 MB bucket ceiling is a little over five minutes.
  Four leaves headroom, and a counter the user can watch is kinder than rejecting a
  five-minute upload after the fact.
- **The recorder is a plain card, not a `Modal`.** Every surface it appears on is
  keyboard-anchored, and an Android `Modal` opens a new window and drops the IME — the same
  reason `QuickAddFields`' chip popovers are inline.

### Ways in

Four entry points, all reaching the same composer:

| Entry | How |
| --- | --- |
| The plus button on a list screen | Long press |
| `dodone://quick-add?voice=1` | In-app deep link, opens straight into recording |
| `dodoneadd://voice` | The "Voice task" launcher shortcut — `QuickAddActivity`, floating over the live home screen |
| Task editor | 🎙 Record, beside Photo and File; transcript appends to Notes |

`QuickAddActivity` answers both `dodoneadd://open` and `dodoneadd://voice`, and the launch
URI is the *only* thing that tells them apart. `quick-add-root.tsx` reads it via
`getInitialURL`, and `isVoiceLaunch` (`lib/quick-add-launch.ts`) matches it. **That match
and the shortcut's `data` URI must stay in step**, which is what `withAndroidShortcuts.test.ts`
asserts; a mismatch is silent on the device and opens the wrong door with no error. The
composer does not mount until the URI has been read, because mounting on the default and
correcting afterwards races a permission dialog over a keyboard that should not have
appeared.

## Design system

- Accent: indigo-500 (#6366f1)
- Font: Inter
- Spacing: 4px grid
- Aesthetic: Things 3 cleanliness, Linear speed
- Tokens in `packages/ui/src/theme.ts`

### The app is light-only, and says so in one place

Every screen in `apps/mobile` paints itself from a hardcoded light palette.
Nothing reads the colour scheme — but the *navigation* theme did, so after sunset
the header on the handful of screens that use a native one (a list, a project,
Settings, Completed) turned black above a light body, while every screen that
draws its own title bar stayed light. Which headers went dark tracked which
screens have a native header, not anything about the screens themselves, so it
read as a bug in particular lists.

`APP_THEME` in `app/_layout.tsx` is `DefaultTheme` unconditionally, and
`userInterfaceStyle` in `app.config.ts` is `"light"` for the native half — the
keyboard, native alerts, the status bar default. Following the system when only
the chrome can follow it is worse than not following it at all.

**The two halves ship differently.** The theme is JS and goes out over OTA; the
config is native and only takes effect on a fresh `eas build`. This is a mobile
decision only: web carries `dark:` variants throughout and its own
`prefers-color-scheme` blocks in `globals.css`.

A real dark mode is a separate change, and a large one: it means a token layer
for every StyleSheet in the app.

### A project's colour and its icon

Both are the identity channel on every task row's ring, so both are chosen from a
menu rather than typed.

- **`PROJECT_COLOR_OPTIONS`** (`packages/shared/src/constants.ts`) is twelve wide and
  two deep: a bright spectrum, then the same sweep darker, ending on four neutrals.
  The grid is `grid-cols-12`, not a wrapping row — a palette that reflows to 11-and-1
  loses the pairing that lets two projects both be "the green one" and still be told
  apart at 20px.
- **`COMPACT_PROJECT_COLORS`** is the older set of eight, used by the *inline* "new
  project" forms: web's project popover and mobile's quick-add chip. Four wrapped rows
  of dots is fine in a dialog and a wall in a popover over a keyboard, and capture is
  not where a colour gets chosen carefully.
- **`packages/shared/src/project-icons.ts`** is the emoji catalogue: ten groups plus
  **Symbols**, which are not emoji at all. `projects.icon` has always accepted a free
  string rendered as text, so ★ and ◆ work and take the row's own text colour. The
  group exists to say so, since nothing did.
- **Two length budgets, and the catalogue satisfies both.** Postgres counts code points
  and `ProjectSchema` counts UTF-16 units, so a ZWJ family (7 and 11) passes the column
  and is rejected by the client. Sequences that long are not offered, and
  `normalizeProjectIcon` drops one rather than truncating it, since half a ZWJ sequence
  renders as two unrelated emoji. `firstGrapheme` is the cluster reader, written by hand
  because `Intl.Segmenter` is not dependable on Hermes. That budget is
  `PROJECT_EMOJI_MAX_LENGTH` (10) and is about the glyph; `PROJECT_ICON_MAX_LENGTH` (64)
  is the column. Different numbers for different reasons.

### `projects.icon` holds two kinds of value

The picker has an **Icons** tab (a curated Phosphor set, MIT) beside the emoji one, and
the column stores whichever was chosen:

**409 icons across the same 11 groups the emoji tab uses**, out of Phosphor's ~1,500. It
is curated rather than complete because the path data ships in the mobile JS bundle with
no code splitting: 409 icons in three weights is 697 KB, and the whole library would be
about 2.2 MB for a picker most people open once per project. Search is what makes a set
this size usable, so an icon carries keywords as well as a label.

**An icon appears in exactly one group.** The picker drops its group headers as soon as a
search or a group filter narrows the list, and keys the cells by icon name alone — so the
same name in two groups collides on a React key in the view people actually use. Where two
groups both want a reading, each takes a sibling icon: Work has `buildings` and Travel has
`city`, Nature has `snowflake` and Food has `jar`. `phosphor.test.ts` asserts it.

| Stored value | What it is |
| --- | --- |
| `🚀` | A character. Printed as text. |
| `ph:briefcase:fill` | A Phosphor icon, drawn from `PHOSPHOR_PATHS`. |

**`parseProjectIcon` in `packages/shared/src/phosphor.ts` is the only thing allowed to
decide which**, and every surface in both apps and the widget goes through it. Guessing
fails loudly: a row that mistakes a token for a glyph renders the literal text
`ph:briefcase:fill` inside a 20px ring. The few places that genuinely need a `string` — a
chip label, a menu row — call `projectIconText`, which yields the character or nothing.

- **An unknown name is `none`, not an emoji.** A token this build has no paths for (a
  trimmed catalogue, an older client, a hand-written row) draws a bare coloured ring, which
  is the only failure here that still looks deliberate.
- **The weight rides in the token**, so it belongs to the project rather than to a setting
  elsewhere. That lets the picker offer it beside the grid, where the choice is being made,
  and means a row needs no second read to draw itself. The app names the three weights for
  what they are — Phosphor's `bold` is **Outline**, `fill` is **Fill**, `duotone` is **Light
  fill** — because "Bold" beside "Fill" reads as two points on one scale.
- **Fill is the default.** The glyph in the ring is 11–12px and Phosphor draws on a 256px
  grid, so a line weight lands under a device pixel while a solid shape survives.
- **`phosphor-data.generated.ts` is generated, ~697 KB, and shared by all three renderers.**
  Web builds `<svg>` elements, mobile builds `react-native-svg` ones, and the widget takes
  **markup** from `phosphorSvgMarkup`, because the launcher's host draws none of React
  Native — the same reason the Quick Add tile ships as a string. Regenerate with
  `tools/phosphor/emit.mjs` against `@phosphor-icons/core`; the curated list is
  `tools/phosphor/catalogue.mjs`.
- **`react-native-svg` is a native module.** Mobile draws nothing for a Phosphor icon until
  a fresh `eas build` is installed. It will not arrive over OTA, the same way attachments
  and voice did not. Emoji are unaffected.

The picker **expands in flow on both platforms and never floats.** Web's dialog is
`overflow-hidden` (which is what rounds its header and footer), so an absolutely positioned
panel is clipped the moment it passes the footer. On mobile an Android `Modal` would open a
second window and drop the IME. The form grows and its body scrolls instead.

`ProjectFormSheet` is the whole of it on mobile — create, edit and delete, for a project
and for a list alike — so the full palette and both icon tabs are reachable there.

**Where it is opened from differs by screen, and the reason is the header.** A list's
detail bar has no ⋯ menu, so editing is a pencil beside "Put away". A project's already
spends two slots on Display and ⋯, so **Edit project** is a row in that menu instead: a
third icon for an action taken once or twice in a project's life is the trade this app
keeps refusing elsewhere.

**Deleting a project does not delete its tasks.** `tasks.project_id` is
`references projects(id) on delete set null`, so they are unfiled and stay in the task
universe; the confirm says so. That is also why the delete is behind a confirm at all —
a task has an undo toast and `restore()` behind it, and this has neither.

## Testing

Vitest everywhere (`pnpm test` → `turbo run test`). Web component tests run in jsdom from
`apps/web/vitest.config.ts`; the packages run plain node tests.

**Keep every workspace package on one vitest version.** No package here depends on
`@testing-library/jest-dom` directly, so its `/vitest` entry resolves `vitest` through its
own path in the pnpm store and calls `expect.extend()` on whatever copy it lands on. When
`apps/web` was on 4.x and `packages/*` on 3.x, it extended the copy no test ran against, and
all 26 `toBeInTheDocument()` assertions failed with `Invalid Chai property`. Same version but
two physical copies does it too, which is why `@types/node` is pinned to `^20.19.39` across
**every** workspace package, `apps/mobile` included, to stop pnpm peer-splitting the install.

To check: after `pnpm install --frozen-lockfile`, `ls node_modules/.pnpm | grep '^vitest@'`
should print exactly one line (a dirty `node_modules` keeps stale directories and will show
more). `grep '^@types+node@'` should print one line too.

**`react` is pinned the same way, for the same reason.** A package that ships a hook
(`packages/api-client`, whose `useAutoSaveTask` the task editors share) needs `react` only as
a devDependency, but pnpm resolves that copy separately — and anything with a `react` peer
that the package pulls in (`use-debounce`) then resolves against *it*, not the app's. Render
such a hook in a jsdom test and it runs against a second React whose dispatcher is null:
`Cannot read properties of null (reading 'useRef')`. So `packages/api-client` is pinned to
the exact version `apps/web` uses (`19.2.4`, no caret), and `apps/web/vitest.config.ts` sets
`resolve.dedupe: ["react", "react-dom"]` as a backstop. `apps/mobile` stays on Expo's
`19.1.0` — no vitest there, nothing to split.

**`apps/mobile` tests logic only — there is no renderer.** Its `vitest.config.ts` runs
`lib/`, `widgets/`, and `plugins/` tests in a node environment and nothing else: query-cache
logic, the widget task handler's decisions, and the XML a config plugin emits, none of which
need pixels. Anything that draws needs a device or a simulator, and neither exists in CI; a
jsdom shim would only prove things about a React Native that is not the one that ships. What
the suite is for is sequencing the eye cannot check on a device anyway — `toggleComplete`'s
completion hold, for instance, where the write must go out before the row leaves and the
invalidate must not land during the animation.

Modules that reach for native code (`./supabase`, `./widgets`, `./query-client`,
`./location-queries`) are `vi.mock`ed per test file, so each test names the seam it stands in
for rather than relying on a global setup.

**The gap this leaves is real.** Component and screen bugs cannot fail here. A missing task
title shipped to main and over OTA because nothing in CI can render a row — see *Running
mobile on the iOS simulator* below.

The pre-existing workaround for the old React breakage is the `vi.mock` of
`./task-edit-modal-v2` in `task-item.test.tsx` and `draggable-upcoming.test.tsx`. Those
isolate the modal for speed too, so they were left alone.

Note that `pnpm test -- --force` passes `--force` to vitest, not turbo. To bypass the turbo
cache, call it directly: `./node_modules/.bin/turbo run test --force`.

## Storybook and Chromatic

Storybook lives in `apps/web/`. It loads `*.stories.tsx` files alongside components and uses
`@storybook/nextjs-vite`.

```bash
pnpm --filter web storybook        # dev server on :6006
pnpm --filter web build-storybook  # static build to storybook-static/
pnpm --filter web chromatic        # publish to Chromatic
```

Stories cover the main surfaces: TaskItem, TaskEditModalV2, TaskForm, WeekView, TodayView,
SidebarNav, ScheduleButton, the pet panel, and more (~18 `*.stories.tsx` files under
`apps/web/src/components/`).

Chromatic publishes Storybook on every push and PR and detects visual regressions. Setup:
sign up at chromatic.com, connect the repo, add the project token as the
`CHROMATIC_PROJECT_TOKEN` GitHub Actions secret. The `.github/workflows/chromatic.yml`
workflow does the rest. Visual diffs appear as a PR check; accept or reject them in the
Chromatic UI. For local runs, set `CHROMATIC_PROJECT_TOKEN` in your shell and run
`pnpm --filter web chromatic`.

**The "UI Tests" check is required on main**, so pending visual diffs block a merge until the
baselines are accepted.

## Running mobile on the iOS simulator

This is the only way to see the mobile UI — CI cannot render it. Two traps, both of which
cost a cycle the first time:

- **`npx expo run:ios` does not work on this Mac.** It fails with `CommandError: No code signing certificates are available`, even with no `--device` flag, because its device probe
  hits a broken `devicectl` and concludes you are building for a physical iPhone. Build for
  the simulator SDK directly instead, from `apps/mobile/ios`:

  ```bash
  xcodebuild -workspace DoDone.xcworkspace -scheme DoDone -configuration Debug \
    -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
    -derivedDataPath build CODE_SIGNING_ALLOWED=NO
  ```

  The `.app` lands at `ios/build/Build/Products/Debug-iphonesimulator/DoDone.app`. Install it
  on a booted simulator (bundle id `com.beamer408.dodone`) and run `npx expo start
  --dev-client` alongside it — a Debug build needs Metro on :8081. Fast Refresh means JS edits
  need no rebuild.

- **`pod install` needs `export LANG=en_US.UTF-8`** or CocoaPods warns and can misbehave.

Setup in a fresh worktree: `pnpm install`, build the workspace packages, copy in
`apps/mobile/.env`, then `npx expo prebuild -p ios --no-install` and `pod install`.
**Prebuild rewrites the `ios`/`android` npm scripts** to `expo run:*` — revert that. `ios/`
and `android/` are gitignored.

`expo-notifications` throws `getRegistrationInfoAsync` on launch because a simulator cannot
issue a push token. It is harmless and does not happen on a device.

iOS shows nothing about the Android-only surfaces: the home-screen widget, the launcher
shortcuts, `QuickAddActivity`, and geofencing. Those have no verification path — there is no
Android SDK, JDK, or emulator on this machine.

## Mobile native builds (EAS)

The mobile app uses native modules (the Android home-screen widget, geofencing, voice input)
that do not run in Expo Go. To test those, build a custom dev client APK once:

```bash
npm i -g eas-cli                  # one-time
eas login                         # one-time
cd apps/mobile && eas init        # one-time: writes projectId into app.config.ts
eas build --profile development --platform android   # cloud build, ~10-15 min
```

Install the APK on the device, run `pnpm --filter mobile start`, open the dev client, and scan
the QR code.

Build profiles in `apps/mobile/eas.json`:

- `development` — APK with dev client and debugging tools
- `preview` — APK for internal testing (no dev client)
- `production` — AAB for the Play Store

After the dev client is installed you can iterate on JS without rebuilding. Only adding a new
native module requires a fresh build.

### The native app and the JS bundle

A React Native app is two artifacts with a contract between them, and most rules in this file
follow from it:

- **The native app** — compiled Swift/Objective-C/Kotlin, containing Hermes and every native
  library. Built once, slowly.
- **The JS bundle** — your `.ts`/`.tsx`, bundled. Rebuilt constantly, fast.

The JS can only call native libraries that were compiled into the native app.

`runtimeVersion: { policy: "appVersion" }` in `app.config.ts` names that contract. `eas update`
publishes a JS bundle stamped with that version to a channel (`development` / `preview` /
`production`), and an installed app accepts only bundles whose version matches its own. Merging
to main publishes to `preview`.

**Practical rule:** if you changed only `.ts`/`.tsx`, never rebuild — it ships over OTA. If you
added a native module or changed `app.config.ts`, rebuild, and bump the version if it is going
out over OTA.

### Installs too old to accept OTA updates

**A build stops accepting OTA updates the moment a published bundle imports a native module
that build does not have.** The update downloads, throws on launch, expo-updates rolls back to
the last bundle that started, and — because `CheckForUpdateProcedure` will not re-offer an
update with `failedLaunchCount > 0` — every check from then on returns "no update available".
The app sits on an old bundle reporting that it is current, and the only signal is the sha in
Settings → App version not moving.

Adding `expo-document-picker` / `expo-image-picker` / `expo-file-system` (attachments) and
`expo-audio` (voice) each drew that line. Installs older than those need a new APK, not an
update.

`describeNoUpdate()` in `apps/mobile/lib/update-check.ts` makes this legible:
`Updates.checkForUpdateAsync()` returns a `reason` alongside `isAvailable: false`, and only
`noUpdateAvailableOnServer` means you are current. Reporting every reason as "Up to date" is
what hid the problem, so an unrecognised reason deliberately does not claim currency either.

### Android widget setup

- Widgets are declared in `apps/mobile/app.config.ts` under the
  `react-native-android-widget` plugin. Widget JSX lives in `apps/mobile/widgets/`.
- **`widget-task-handler.ts` is registered from `index.js`, the bundle entry, and
  nowhere else.** `registerWidgetTaskHandler` is `AppRegistry.registerHeadlessTask`: it
  names the JS entry point the launcher's widget update runs. That update arrives through
  a headless worker that starts the ReactHost with **no activity and no React tree**, so
  anything registered from a component — or from a module only a component pulls in — has
  not run yet, the task key is unregistered, and nothing draws. Expo Router route modules
  load via `require.context`, whose entries are lazy getters, so `app/_layout.tsx` (where
  this used to live) evaluates only when the router renders. The widgets drew only while
  the app was warm, and were blank whenever they were added or updated with it closed. A
  blank widget gives no other signal: no crash, no log, just an empty cell.
- **Everything reachable from `widget-task-handler.ts`'s static imports must load in that
  cold context**, so it stays tiny (React plus the Quick Add tile). Supabase,
  `@do-done/api-client`, and the task engine are behind `await import(...)` on the branch
  that needs them.
- Widgets read the Supabase session from AsyncStorage, shared with the main app.

### The task widgets draw the app's row

Today, Upcoming, and the 4×1 **Next up** strip all render the two-slot row described under
*The task row*: ring for the project, gutter for urgency, one muted subline for the rest.
The row's decisions are **not** reimplemented here — `rowGutter` / `rowSubline` /
`rowEstimate` from `@do-done/shared` are the same functions the in-app row calls, so a
widget and a list can never disagree about what a task is. Priority used to colour the
checkbox here, which put an ordinal variable in a nominal channel on the one surface that
never said which project a task belonged to.

Four rules the widget adds, all about a launcher cell being small:

- **`loadWidgetTasks` fetches projects as well as tasks**, because the ring needs a colour
  and an icon. A projects failure returns an empty list rather than propagating: every ring
  falls back to neutral, which is a duller widget but still a correct one. Letting it take
  the task list down would turn a cosmetic outage into an empty home screen.
- **Fitting spends a height budget, not a row count.** `layoutRows` in
  `widgets/widget-layout.ts` charges 24 dp for a bare row, 34 dp for one with a subline, and
  22 dp for a group header, and reserves the "+N more" line *before* placing the row that
  would need it. The old `rowCapacity` divided the height by a flat 26 dp, which was wrong in
  both directions as soon as rows stopped being uniform — and a "+N more" computed off a
  wrong capacity is a wrong number about the user's own task list, with nothing on the home
  screen to contradict it.
- **Below `COMPACT_BUDGET_DP` the sublines all go.** A subline costs 42% more row height,
  which on a 3×2 is the difference between three tasks and one — the widget was a group
  header and a single line. There are exactly two densities and no truncated middle ground,
  and the choice is made inside `layoutRows` from the budget, so no caller can get it wrong.
- **A group header owns its day, so the rows beneath do not repeat it.**
  `WidgetGroup.namesTheDay` drives `rowSubline`'s `hideScheduledDay`, the date-shaped twin of
  `projectName: null`. Overdue is deliberately *not* a day group: "3 days ago" is the one
  genuinely actionable thing those rows say. The project name **stays** in the subline — the
  ring is a fast cue, the name is the readable one, and a project with no icon would
  otherwise be a colour the user has to have memorised.
- **The card has a dark variant**, via the library's own `renderWidget({ light, dark })`. One
  component tree; a theme is an argument to it (`widgets/widget-theme.ts`). A project's colour
  is **lifted toward white, never replaced** — someone who picked green for Home has to find
  green on both cards. The dark card is `#191b22` rather than black, so it keeps an edge
  against an AMOLED wallpaper.

**`widgets/widget-render.ts` is why the two render paths cannot drift.** The launcher's
headless handler and the app's own foreground refresh (`lib/widgets.ts`, called from
`invalidateTasks`) both build the light/dark pair from it. A refresh that passed a single tree
would silently drop the dark card until the next 30-minute tick — a bug that only reproduces
on a phone set to dark.

Two things that can only be checked on a device: an 18 dp ring is well under Material's 48 dp
touch minimum (its tappable box is padded to 26×24, as far as it goes without making every row
taller), and `TextWidget` has no `lineHeight`, so the dp constants in `widget-layout.ts` are
padding-and-margin sums rather than a typographic ideal.

**Adding the Next up widget changes `app.config.ts`, so it needs a fresh `eas build`.** The
row redesign itself is pure JS and ships over an update.

### Quick-add widget (floats over the home screen)

The 1×1 "Quick Add" widget mimics Todoist's: tapping it opens a quick-add sheet over the live
home screen without launching the main app.

- The widget (`widgets/QuickAddWidget.tsx`) opens `dodoneadd://open` — a scheme distinct from
  the app's `dodone` scheme so it resolves *only* to the translucent activity, with no
  disambiguation chooser. `react-native-android-widget` cannot target an activity by
  component, hence the dedicated scheme.
- **`plugins/withQuickAddActivity.js`** is a config plugin that, on every `expo prebuild`,
  generates a translucent `QuickAddActivity` (`.kt`), registers it in `AndroidManifest.xml`
  with `Theme.App.QuickAddTranslucent` and the `dodoneadd` intent-filter, and adds that style.
  The activity runs in its own task (`taskAffinity=""`, `launchMode="singleTask"`,
  `excludeFromRecents`) with `windowSoftInputMode="adjustResize"` — without that it defaults
  to pan, and the window slides up *underneath* the composer's own keyboard offset.
- **`QuickAddActivity` mounts a second registered JS root, `"QuickAdd"`** (see `index.js`, the
  custom bundle entry that also imports `expo-router/entry` for the main `"main"` root). Both
  roots share one ReactHost and JS bundle, so the Supabase session is shared.
- That root is `quick-add-root.tsx`, which renders `components/QuickAddComposer.tsx`. It
  dismisses with `BackHandler.exitApp()`, which finishes only the quick-add task and returns
  to the launcher.
- **The When / Priority / Project / Estimate chips live in `components/QuickAddFields.tsx`**
  (`useQuickAddFields` + `QuickAddChipRow` + `QuickAddPickers`), reusing selectors exported
  from `components/TaskEditModalV2.tsx`. Every mobile capture surface shares them: this widget
  composer and the in-app `dodone://quick-add` modal, which is where every list screen's plus
  button lands too (see *Capture is a button on mobile*).

  **Nothing in that module may call a TanStack Query hook or reach for an API** — the widget
  root has no QueryClientProvider. Both the project list (`projects`) and the inline "New
  project" action (`onCreateProject`) are handed in by the host, which is the only piece that
  knows what else has to hear about a new project: the in-app hosts pass `createProjectOrNull`
  from `lib/task-queries` and let it invalidate the cache, while the widget root reads
  `ProjectsApi` directly and keeps its own array. The widget used to pass neither, which is why
  its Project chip was missing and `#groceries` silently became a tag on the one surface where
  it could not be a project. A surface that omits the list still gets that behaviour, which now
  only describes the first frame while a list loads.
- **Every quick-add surface has a door to the full editor**, because the chips will never cover
  notes, subtasks, attachments, or the month calendar, and a capture surface that dead-ends
  there is one you have to abandon. The rule is the same on both platforms: **create the task
  first, then open the editor on the persisted row** — both editors autosave, so neither has
  anywhere to keep unsaved state. Web has "More options →" (modal) and an expand icon (bar,
  inline composer), both via `openEditor` in `use-quick-add-composer.ts`; `allowEmpty` there
  creates a throwaway "New task" that `TaskEditModalV2`'s `draft` prop deletes again if the
  editor closes untouched. Mobile passes `onExpand` to `QuickAddComposer` and **requires a
  title**, since it has no `draft` equivalent and the alternative would be orphan "New task"
  rows. Where the editor opens is the host's call: in place for `app/quick-add.tsx`, but the
  widget root deep-links `dodone://task/<id>` and dismisses, since a 3400-line sheet wanting
  the router and the query cache has no business in a translucent launcher activity.
- **Two composer rules keep the surface from jumping around**, both matching Todoist: the card
  rides the IME via Reanimated's `useAnimatedKeyboard` (frame-synced inset, not a post-hoc
  `keyboardDidShow` measurement), and the chips open their options as **inline popovers in the
  same window**, because an Android `Modal` opens a new window and drops the keyboard. Only the
  full month grid takes over the screen, and it hands focus back to the input on close.
- **Widget artwork is inline SVG via `SvgWidget`** (`widgets/dodone-mark.ts`). Do **not** use
  `IconWidget`: it renders the icon name as *text* in a typeface the app has to ship itself, so
  `icon="add"` with no `material.ttf` literally drew "add" on the home screen.
- **The tile paints its squircle twice** — once as the SVG, once as a `backgroundColor` on the
  `FlexWidget` behind it — deliberately. `SvgWidget` hands the string to AndroidSVG and swallows
  a parse failure with a bare `printStackTrace`, so artwork alone has a silent path to fully
  transparent. It is sized to a centred square of `min(width, height)` from `widgetInfo`, not
  `match_parent`: a launcher cell is taller than it is wide, and square artwork would letterbox
  inside its own background.
- **The handler draws the tile for every action except `WIDGET_DELETED`.** With
  `updatePeriodMillis: 0` there is no update tick, so an action it declines to draw for leaves
  the tile exactly as it was — and for a fresh widget, that is blank forever. `_layout.tsx`
  also calls `repaintQuickAddWidget()` once per launch, so opening the app heals a tile whose
  one render was lost.
- **Test the tap flow in a preview/release build** — `expo-dev-client` intercepts launches in
  debug builds. After changing the widget's size, remove and re-add it on the device.
- **None of this has been confirmed on a device.** See
  [`docs/android-widget-verification.md`](docs/android-widget-verification.md) for the checklist
  it still needs, the `ImageWidget` fallback if `SvgWidget` turns out not to render, and the
  build problems (stale checkouts, APK signing, launcher caching) that have already cost three
  install cycles.

### Launcher quick actions (app shortcuts)

Long-pressing the DoDone icon offers **Add task / Voice task / Search / Today / Upcoming**, each
pinnable to the home screen. These are not widgets: the launcher draws them, so a pinned one
takes exactly one cell and sits flush with the app icons around it. That is why they exist
alongside the 1×1 quick-add widget rather than instead of it.

- `plugins/withAndroidShortcuts.js` writes `res/xml/shortcuts.xml`, the icon drawables, and the
  labels, then hangs a `meta-data` tag off MainActivity. They are static shortcuts, so they
  exist from install with no runtime native code.
- **Labels must be `@string/` references.** Android silently drops a `<shortcut>` whose label is
  a literal — no build error, the row just is not there.
- **Intents must be explicit** (`targetPackage` + `targetClass`); an implicit one never launches.
  The deep link rides along as the intent's `data`, which is what `expo-linking`'s
  `getInitialURL` reads. Add task and Voice task both target `QuickAddActivity` directly, so the
  composer floats over the home screen exactly as the widget does; the rest target MainActivity.
  Those two differ *only* in their `data` URI — see Voice notes → Ways in.
- **Each icon ships twice**: an `<adaptive-icon>` in `drawable-anydpi-v26` so the launcher masks
  it to the same shape as the app icons, and a plain circle vector in `drawable/` for API 24-25,
  which has no mask. The glyph is scaled into 24..84 of the 108 viewport, inside the safe zone
  no mask can clip.
- `plugins/withAndroidShortcuts.test.ts` asserts the generated XML, including that every
  `dodone://` target has a route file. Every failure mode here is silent on the device, so the
  test is the only place they surface. It is why `vitest.config.ts` includes `plugins/**` as
  well as `lib/**`.

### Location reminders (geofencing)

A task can carry reminders at places — "buy milk when I get to Tesco", "post the letter when I
leave the office". `task_locations` links a task to a location with a `trigger_type` of `enter`
or `exit`; a task can have several.

**Surfaces (mobile)**

- `components/LocationReminderSheet.tsx` — the 📍 row in the task editor. A search field over
  tappable places: the first tap attaches the reminder, and direction, radius, and whether to
  keep the place are adjusted afterwards. **This is the only place in the app that prompts for
  location**, and it explains itself before asking.
- `app/locations.tsx` (Settings → Saved places) — rename, re-radius, delete. Also lists any
  *one-off* place currently holding a region, since those count against the cap the warning on
  that screen is about.
- `lib/location-queries.ts` — query hooks and mutations. Every write ends in a geofence sync;
  the OS holds its own copy of the regions.

**Surfaces (web) — reads and writes everything, fires nothing.**

Web had no awareness of locations at all, so a task set up on the phone showed no date and read
as one nobody had planned. It now edits the same rows through the same `LocationsApi`; only the
geofence stays on the phone, because no browser can wake an app when you walk into a shop. Each
web surface says so.

| Where | What |
| --- | --- |
| `components/task-locations.tsx` | `LocationSection`, the **Places** block in the task editor. Same flow as the sheet: search, one click attaches, then direction / radius / "Save place" / remove. |
| `components/map-preview.tsx` | The web twin of mobile's `MapPreview`, same tiles from the same projection. |
| `app/(app)/places/` | The **Places** view: every place, and the open tasks waiting at each. Mobile's screen shows a count; web lists and links the tasks, since it has the width. |
| `lib/task-locations-context.tsx` | One `listTaskLinks()` read for the whole app, so a row can show a place chip without a query per row. |
| `lib/supabase/locations-client.ts` | `getLocationsApiFor` / `getClientLocationsApi` — the demo seam, mirroring `attachments-client.ts`. |

- **Places is in the sidebar, not under Settings** — the reverse of mobile, and the same split
  web already makes for Tags. A phone's nav is scarce; a laptop is where you sit down and ask
  what is waiting for you where. **The row appears only once a place exists**, like the Lists
  section, and Settings links to the page until then. `hasPlaces` comes from a `listAll()` in
  `(app)/layout.tsx`.
- **The row chip states, it does not edit.** Every other chip on a web row opens a popover; a
  place needs a search field, a direction, a radius and a map, which is a panel. So the chip
  names the place and the row's own click opens the editor. `locationRowLabel` in
  `@do-done/shared` is deliberately shorter than `locationReminderLabel`, which the editor's card
  uses.
- **The editor announces its writes on a window event** (`lib/task-location-events.ts`), because
  the badge provider and the editor sit at opposite ends of the tree — the same shape as
  `task-delete-events.ts`.
- **Never prompt for location on open.** `positionIfAlreadyAllowed()` asks the Permissions API
  whether geolocation is *already* granted and reads a position only then. This is web's version
  of `getLastKnownPosition()`. "Use where I am now" is the one control that prompts, because the
  user pressed it.
- **The demo sandbox implements locations for real** (`DemoLocationsApiImpl`), unlike attachments,
  which are inert there. An attachment needs a Storage bucket the demo has no session for; a place
  is four numbers and a name, and place search is a keyless public geocoder. The seed ships three
  places, and the stub mirrors the one-off prune trigger and the delete cascade by hand.

**Shared, so the two cannot drift:** `place-search.ts` and `map-tiles.ts` moved out of
`apps/mobile/lib` into `@do-done/shared` unchanged, and `shared/src/locations.ts` holds
`TaskLocationLink`, the trigger labels, and the phrasing both editors use.
`LocationsApi.getTaskLocations` now returns links with the place joined on — it always embedded
`locations(*)` and every caller re-cast it by hand — and `listTaskLinks()` is the batch read the
row chips need.

**Capture: search first, saving never required.** Three rules, each of which was a usability bug
first:

- **A place does not have to be saved.** Attaching writes a location with `is_saved = false` —
  geofenced exactly like a saved one, hidden from the pickers, and deleted by a database trigger
  when its last `task_locations` row goes (`20260805000002_one_off_locations.sql`). "Save place"
  promotes the same row, so the task links survive. Client-side cleanup would have leaked rows on
  the paths that do not go through the client (a deleted task, a cascade), and a leaked one-off
  place is invisible by construction, since nothing lists it.
- **A name is never asked for.** `locations.name` stays NOT NULL because it is what the
  notification says, but it comes from the search result ("Target") or the reverse-geocoded street
  line, not from the user.
- **Search is type-ahead** (`lib/place-search.ts`), biased toward the last known position and
  labelled with distance so "the closest one" is easy to pick. The provider is **Photon** (OSM
  data, keyless): `expo-location`'s `geocodeAsync` returns coordinates with no label, so it cannot
  populate a suggestion list at all, and Nominatim's usage policy forbids autocomplete.
  `geocodeAsync` stays as the "look up what I typed" fallback when Photon is unreachable. Reading
  the position for bias uses `getLastKnownPosition()`, which returns null rather than prompting or
  waiting for a fix, so opening the sheet stays free.

`components/MapPreview.tsx` draws the pin, its radius, and your own position from raster tiles
(`lib/map-tiles.ts` holds the Web-Mercator projection, tested in node). Deliberately not
`react-native-maps`: that is a native module, so it would need a fresh dev-client build and a Maps
API key before anyone could see a pixel. The trade is that it cannot be panned and the pin cannot
be dragged.

The sheet tracks the IME height itself and shrinks its list to fit, because `edgeToEdgeEnabled`
turns off Android's `adjustResize`, so nothing moves on its own and a bottom-anchored sheet is
simply behind the keyboard. Same problem `QuickAddComposer` solves by riding
`useAnimatedKeyboard`; this sheet needs the number rather than a transform, because it resizes its
list instead of moving.

**Engine** (`lib/geofencing.ts`)

- **`registerUserGeofences()` never prompts.** It registers only locations with at least one *open*
  task, so finished work stops waking the device, and a user with no location reminders is never
  asked for location at all.
- **`requestGeofencePermissions()` is the prompting path** — foreground, then background, then
  notifications (Android 13+ needs POST_NOTIFICATIONS, and a location reminder that cannot notify
  does nothing).
- Requires both foreground and background location, the latter shown only after foreground is
  granted, per Android policy. Since Android 11 the background grant has no dialog: the OS
  deep-links to the app's Location settings screen for "Allow all the time".

**Why it is not just "notify on enter"** — three rules, tuned in
`packages/shared/src/constants.ts`:

- **Dwell.** An enter fires the moment you clip the boundary, so driving past the shop would fire
  the reminder. Notifications are scheduled `GEOFENCE_DWELL_SECONDS` out and cancelled if the
  opposite transition lands first. This is why regions register with `notifyOnEnter` *and*
  `notifyOnExit` even when only one direction has tasks — without the opposite event there is
  nothing to cancel on.
- **Cooldown.** Position drift makes regions flap. Once a task fires for a place it stays quiet for
  `GEOFENCE_COOLDOWN_MINUTES`.
- **Region cap.** iOS silently stops monitoring past 20 regions (`GEOFENCE_MAX_REGIONS`), so we
  trim by open-task count and mark the rest "Paused" on the places screen rather than letting them
  fail invisibly.

Radius presets start at 100 m (`LOCATION_RADIUS_PRESETS`) because a typical urban fix lands 20-60 m
off; tighter regions miss arrivals and emit spurious exits while you sit still. The default is
200 m.

Dwell and cooldown state live in AsyncStorage, not module state — the background task runs in a
fresh JS context after the OS kills the app.

> **The firing half has never run on a device.** Geofences, the dwell filter, the notification
> channel, and all three permission prompts are unverified outside a type-checker; none of them
> execute in Expo Go or CI. See "Where things stand" in
> [`docs/HANDOFF.md`](docs/HANDOFF.md) for the order to check them in. Each failure mode here is
> silent.
>
> The *editing* half is verified, on web: the task editor's Places block and the Places view were
> driven in a browser against `/demo`, including live Photon search and real OSM tiles.

## Notifications

Everything the app posts is a **local** notification, scheduled on the device. There is no push
server: no FCM/APNs credentials, no token table, no cron, no edge function. Two kinds, on three
Android channels:

| Kind | Channel | Fired by |
| --- | --- | --- |
| Location reminder | `location-reminders` (HIGH) | `lib/geofence-task.ts`, from the OS geofence event |
| Daily / weekly digest | `digests` (DEFAULT) | `lib/digests.ts`, armed ahead of time |
| Task reminder / day-start roundup | `task-reminders` (HIGH) | `lib/task-reminders.ts`, armed ahead of time |

**Three channels, not one.** Android lets a user silence a channel without silencing the app, and
"a reminder because I walked into a shop", "a summary of my morning" and "the task I set for 3pm is
at 3pm" are genuinely different subscriptions. One shared channel would make muting the digest also
mute the thing you are standing in front of. The digest channel is DEFAULT rather than HIGH on the
same logic: a heads-up banner every single morning is what gets a channel muted. The task channel
is HIGH, like the location one — a reminder whose whole value is landing at 2:55 for a 3pm task is
worth interrupting for, and arriving silently an hour later is the same as not arriving at all.

`lib/notifications.ts` is the one seam onto `expo-notifications`. Every entry point lazy-requires
the module through it, because it was removed from Expo Go in SDK 53 and importing it there throws
at *bundle* time — taking the whole app down rather than the one feature.

**`cancelAllScheduledNotificationsAsync()` must never be called.** The geofence dwell filter works
by scheduling a reminder a couple of minutes out and cancelling it if you leave again, so at any
moment the queue may hold a notification that *is* the location feature working. A digest re-arm
that cleared everything would eat it, and the symptom — a location reminder that fires only when
you do not happen to open the app in the two minutes after arriving — is one nobody would reproduce
deliberately. Both schedulers track their own identifiers and cancel only those.

### Register the geofence task at the bundle entry

`TaskManager.defineTask` names a JS entry point the OS looks up **by name**, and it delivers a
boundary crossing by starting the runtime with *no activity and no React tree*. A task that has not
been defined by then is not queued — the event is dropped, expo-task-manager logs "Task
'DO_DONE_GEOFENCE' has not been registered" somewhere nobody is looking, and nothing arrives.

The definition lived in `lib/geofencing.ts`, which is imported only from `app/_layout.tsx` and two
components. Expo Router loads route modules through `require.context`'s lazy getters, so none of
them had evaluated when the event came in. Location reminders therefore fired only while the app
was already open and rendered, and **never in the case the feature exists for**: phone in a pocket,
app closed, walking into a shop.

This is the same bug that left the home-screen widgets blank, and it has the same fix.
`lib/geofence-task.ts` holds the task and nothing else, and **`index.js` — the bundle entry —
imports it.** `lib/geofencing.ts` keeps only registration and permissions.

- **The static import graph of `geofence-task.ts` is paid for on every cold start**, including the
  headless ones a launcher widget update runs. So `./supabase`, `@do-done/api-client` and the
  *values* from `@do-done/shared` are behind `await import(...)` inside the handler. The last one
  matters more than it looks: `@do-done/shared` is a barrel, so importing one constant statically
  evaluates the Zod schemas and the ~697 KB generated Phosphor table before a widget can draw a tile
  that needs none of them.
- **Nothing else runs at that module's scope.** The foreground presentation handler and the channel
  setup used to; they are concerns of a *running* app and now live in `app/_layout.tsx`. Doing them
  at bundle evaluation loaded expo-notifications on every headless start to configure something only
  a live app can use.
- **The handler reads `getSession()`, not `getUser()`.** `getUser()` round-trips to the auth server,
  and this code runs on a phone just woken in someone's pocket, possibly with no usable connection —
  where a failed auth call means no reminder at all. `getSession()` reads local storage. The queries
  still authenticate, so an expired token fails them rather than the whole handler.
- **A soft-deleted task no longer greets you at the shop.** That query does not go through
  `TasksApi.read()`, so it carries the `deleted_at` filter itself.
- **A tapped notification goes somewhere.** `lib/notification-routing.ts` maps the payload to a route
  — a location reminder opens *its task*, since the notification body is a task title.
  Registered in `_layout.tsx`, because responding to a tap needs the router the background task does
  not have. Unknown payloads route nowhere rather than guessing: yanking someone off the screen they
  were on is worse than doing nothing.

### Digests are scheduled ahead, then re-armed

A local notification's text is frozen the moment it is scheduled, and nothing server-side exists to
compose one. So `lib/digest-plan.ts` plans several occurrences out to `HORIZON_DAYS` (8),
`lib/digests.ts` computes each one's copy from the current task list, and the whole plan is
**cancelled and re-armed on every launch and every return to the foreground** — the same trigger, and
the same reasoning, as the status-sync sweep.

A repeating DAILY trigger is the obvious thing to reach for and is useless here: it would deliver the
same frozen sentence every morning until the app was next opened — which is precisely how it would
fail the user it is meant to serve.

- **`MIN_LEAD_MS` (2 min) exists because re-arming cancels.** An app opened at 07:59:30 would
  otherwise cancel the 08:00 digest and schedule its replacement for an instant already past — which
  expo-notifications delivers immediately, as a digest arriving the moment you open the app to read
  the list it describes.
- **A digest with nothing to report is not sent.** `buildDailyDigest` / `buildWeeklyDigest` return
  null for an empty window. A notification that arrives every morning to say the day is empty is the
  fastest way to get the feature switched off — and it teaches the user to swipe this app's
  notifications away unread, which is also how they miss a location reminder. The settings screen
  says so, so the first quiet morning reads as the rule rather than as a bug. "Send one now" is the
  one exception: the user asked, so "nothing today" is the correct answer to a button that exists to
  prove the feature works.
- **Times resolve through `user_preferences.timezone`, never the device clock.** A digest is a
  wall-clock event in the user's life, and the two disagree while travelling. `zonedClockToUtc` does
  the conversion; `digest-plan.test.ts` pins it in two zones.
- **A failed prefs or task read leaves the existing schedule alone.** Usually a dropped connection,
  and disarming on that would silently kill the feature for anyone who opened the app on a bad train.
- **The weekly covers the seven days *from* the digest, not a calendar week.** Someone asking for
  their week on Monday means the week they are about to have.
- **Both switches default off**, in the column and in the schema, for the reason `status_sync_promote`
  does: nobody should find that a deploy started sending them notifications. Turning one on is also
  the only place the app asks for the notification grant, and it does not save the switch if the grant
  is refused — a switch reading "on" above a feature the OS will never let post is exactly what makes
  a notification feature look broken rather than declined.

The copy and the settings schema are in `packages/shared/src/notifications.ts`, so a digest cannot
read one way on the phone and another on the laptop, and — more immediately — so the date arithmetic
is testable in node, which is the only place `apps/mobile` can test anything.

**This is all pure JS and ships over OTA.** `expo-notifications` was already in the native build, and
no config plugin was added precisely so this would not need a rebuild.

> **Unverified on a device**, like the geofencing it sits beside. What CI covers is the arithmetic and
> the copy (`digest-plan.test.ts`, `notification-routing.test.ts`,
> `packages/shared/src/notifications.test.ts`); delivery, channels, and the permission prompt need a
> real build. **Web has no notifications at all** — that needs a service worker and VAPID keys, and is
> a separate change.

### Per-task reminders

The digests describe a *day*. These describe a *task*: on the day it is scheduled, at the time it is
scheduled for. Off by default, like everything else here.

| Shape | When it fires |
| --- | --- |
| A task with a **time** | At `scheduled_time`, less `notify_task_reminder_lead_minutes` |
| Tasks with **only a day** | Named together in one day-start roundup at `notify_day_start_time` |

**The roundup is one notification, not N.** Most DoDone tasks carry a `scheduled_date` and no
`scheduled_time`, so one reminder each would mean ten at 09:00 on an ordinary Tuesday. A channel that
behaves like that gets muted within a week — and muting it also silences the timed reminders the
feature exists for. `buildDayStartRoundup` in `@do-done/shared` names the first three and counts the
rest.

The three files mirror the digests' three exactly, so the two read side by side:
`packages/shared/src/task-reminders.ts` (eligibility and copy), `apps/mobile/lib/task-reminder-plan.ts`
(which instants, and how many fit), `apps/mobile/lib/task-reminders.ts` (arming, identifiers,
lifecycle).

- **The OS budget is capped explicitly.** iOS keeps at most **64** pending local notifications per app
  and silently drops the rest — no error, the 65th just never arrives. Every scheduler here shares that
  one budget, so task reminders take `MAX_TASK_REMINDERS` (48) of it, soonest first, and log what they
  dropped. Same failure mode as the 20-region geofence cap, same treatment: trim by a rule we chose
  rather than letting the OS discard an arbitrary tail.
- **It re-arms on writes as well as on foreground**, which is the one place it diverges from the
  digests. A digest describes an aggregate, so being stale for a few hours is harmless. A reminder is
  armed against one specific task at one specific instant, and the moment it most needs to exist is the
  moment that task is created: type "call the bank at 3pm" at 2:40 and pocket the phone, and
  foreground-only re-arming would never arm it. So `invalidateTasks()` calls
  `scheduleTaskReminderSync()` — debounced 5s, the same shape as the widget refresh and the geofence
  sync beside it.
- **A re-arm that arrives mid-run is queued, not dropped.** The write that triggered it is exactly the
  one missing from the plan being armed.
- **Overdue work is never announced.** Its day already came and its reminder already went; announcing
  it again would mean every slipped task pinging forever. Overdue belongs to the digest, which is a
  separate switch. This is also why the arming path does one query where the digest does two.
- **A list item is never announced.** A notification is the loudest surface in the app, so it is the
  last place a tin of tomatoes should turn up. Enforced in `isRemindable`, so neither the timed path
  nor the roundup can forget it.
- **A task is announced once.** `reminderAnchor` picks `scheduled_*` if there is one and falls through
  to `deadline_*` otherwise — the same precedence `bucketDate` uses in the weekly digest. Falling
  through rather than ignoring the deadline means a hard external cutoff with no plan still gets said
  out loud, which is the date whose arrival you least want to learn about afterwards.
- **A lead can push a reminder into the previous day**, and `applyLead` returns the day as part of its
  answer so it can. The horizon bounds the task's day rather than the shifted instant, so a task at
  00:30 on the first day still gets its heads-up the night before.
- **Times resolve through `user_preferences.timezone`**, never the device clock, and `MIN_LEAD_MS`
  applies for the reason it does for digests: the re-arm cancels and recreates, and an instant that
  passes in between is delivered *immediately* — a 9am reminder arriving at 2pm because the app was
  opened.
- **`parseTaskClock` is deliberately more tolerant than `parseClockTime`.** `tasks.scheduled_time` is a
  free `text` column the Google Calendar pull also writes into, so a value can arrive as `"09:30:00"`.
  A reminder silently not arming over a trailing `:00` is a bug nobody would reproduce.

**This is pure JS and ships over OTA** — no new native module, no config plugin. **Web still has no
notifications**, unchanged: that needs a service worker and VAPID keys.

> **Unverified on a device**, like the digests and geofencing beside it. CI covers the arithmetic, the
> eligibility rules, the cap and the copy (`task-reminders.test.ts` in both packages,
> `task-reminder-plan.test.ts`); delivery, the channel and its importance need a real build.

## Password-manager autofill

Login fields on **both** platforms carry explicit autofill metadata. Without it the OS cannot classify
them and 1Password never offers to fill:

- Mobile (`apps/mobile/components/LoginScreen.tsx`): `autoComplete` (→ Android `autofillHints`),
  `textContentType` (→ iOS AutoFill), and `importantForAutofill`.
- Web (`apps/web/src/components/auth-card.tsx`): `name` and `autocomplete`.

Both flip the password field between `current-password` and `new-password` based on signin/signup mode,
so managers offer generation instead of a fill.

### The signed-out screen is rendered in place, not navigated to

Correct hints are necessary and were never sufficient on Android. **A screen you *navigate to* is one
the OS will not offer autofill on**, and for a while that was this app's login screen: nothing appeared
on either field, from 1Password or from Gboard.

Android builds its autofill view structure per *activity*, and a native-stack navigation replaces that
activity's content without telling `AutofillManager`. The documented remedy is
`AutofillManager.cancel()`, which neither React Navigation nor react-native-screens calls and which no
JS API reaches. So the fill session stays pinned to the screen you navigated away from, the fields you
navigated *to* are not in it, and the OS answers "Content can't be autofilled". Open upstream on both
sides with no fix — react-native-screens#349 and #3130, react-navigation#12210 and #12717.

**The tell takes five seconds on a phone: background the app and come back.** Resuming the activity is
the other thing that rebuilds the structure, so autofill works for the rest of that launch. A fill
prompt that appears only after that round-trip is this bug and not the hints.

So being signed out is a **state of the app, not a destination inside it**.
`components/LoginScreen.tsx` is rendered by `app/_layout.tsx` *in place of* the navigator, and the
`(auth)` route group is gone — a file under `app/` is a route whether or not anything links to it, and
a route is arrived at by navigating. Two consequences worth keeping:

- **Signing out unmounts the navigator**, so the previous account's screens and their queries go with
  it. The `router.replace('/(auth)/login')` this replaced did that too; a login screen layered *over*
  the navigator would not, which is why it is not one.
- **`settings.tsx` returns to the tab root before signing out**, because whatever route was last on
  screen is where the navigator remounts on the next sign-in.

**The hints were never the problem**, and it is worth not working that out again: RN's JS layer rewrites
`current-password` → `password` and `new-password` → `password-new` before they reach Android's
`autofillHints` (`autoCompleteWebToAutoCompleteAndroidMap` in RN's `TextInput.js`), so the
iOS-flavoured spellings on that screen are right on both platforms. Passing an Android-invalid value
would be silent and total, though — RN logs one line to logcat and calls
`setImportantForAutofill(IMPORTANT_FOR_AUTOFILL_NO)`, hiding the field from the framework outright.

**App ↔ site association is a separate mechanism.** It is what makes a saved
`dodone.byebrianwong.com` login match the *app*, rather than the app being its own vault item. It needs
all three of:

1. `ios.associatedDomains: ["webcredentials:dodone.byebrianwong.com"]` in
   `apps/mobile/app.config.ts` (already set; EAS syncs the capability at build).
2. `APPLE_APP_ID` (`<TeamID>.com.beamer408.dodone`) in the web deployment, served at
   `/.well-known/apple-app-site-association`.
3. `ANDROID_CERT_FINGERPRINTS` (comma-separated SHA-256, usually the EAS upload key *and* the Play
   app-signing key), served at `/.well-known/assetlinks.json`.

Both routes 404 when their env var is unset, because a malformed association file is worse than a
missing one — Apple and Google cache them. `/.well-known` is in `PUBLIC_PATHS` in `proxy-helper.ts`;
Apple's spec forbids a redirect there.

**Neither env var is set yet**, and the iOS entitlement needs a fresh `eas build` to take effect.
Checklist with commands and verification steps:
[`docs/autofill-setup.md`](docs/autofill-setup.md).

> Test autofill in a preview/release build, and make sure 1Password is selected under Android
> Settings → Passwords & accounts → Autofill service.
