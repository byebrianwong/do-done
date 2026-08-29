# do-done Mobile — Roadmap to "fast and powerful"

_Last updated: 2026-08-10_

> **See also:** [`mobile-web-parity-plan.md`](mobile-web-parity-plan.md)
> (2026-07-08) — the current web ⇄ mobile gap audit and phased parity plan. It
> folds in this roadmap's still-open items with fresh status; this doc remains
> the reference for the performance/data-layer diagnosis and the work already
> shipped.
>
> **What's actually left here: 0.4, 2.5, 2.6, 4.1, the a11y half of 4.5, and the
> PowerSync bet.** Everything else on this page has shipped — see
> [_Shipped since this roadmap was written_](#shipped-since-this-roadmap-was-written)
> for the large amount of mobile work that postdates it and never had a phase
> number.

A product + technical plan to make the React Native / Expo app feel **faster than
the web app**, leaning into the affordances a phone actually has (swipe, haptics,
voice, location) rather than porting the web's drag-and-drop interaction model.

The roadmap is ordered by return-on-effort. **Phase 0 is ~80% of the
perceived-speed win** and reuses pieces that already exist.

---

## The core diagnosis: why it _feels_ slow

> **Historical — this is the app as of 2026-06-07, and Phase 0 fixed it.** Steps
> 1 and 4 are gone (the user id comes from the cached session), step 5 is gone
> (TanStack Query serves the list and refetches in the background), and the tap
> no longer waits on any of it: the row checks instantly and reconciles behind
> the animation. Step 2 survives, for reasons that are no longer about pets — see
> 0.4. Kept because it's the diagnosis every Phase 0 item is an answer to.

It isn't rendering — it's the **data layer**. Trace one checkbox tap to complete a
task (`apps/mobile/components/TaskItem.tsx`):

1. `getTasksApi()` → `await supabase.auth.getUser()` — a **network round-trip to the
   auth server** just to learn the user id (`apps/mobile/lib/supabase.ts:27`).
2. `tasks.complete()` → `update()` does a `SELECT` of the prior row for pet feeding
   (`packages/api-client/src/tasks.ts:113`) — round-trip 2.
3. the `UPDATE` itself — round-trip 3.
4. `onChange()` → `load()` → `getTasksApi()` → **another `getUser()`** — round-trip 4.
5. `api.list({ limit: 100 })` re-fetches the **entire list** — round-trip 5.

~5 sequential network hops for one tap, with a spinner shown the whole time
(`TaskItem.tsx` `ActivityIndicator`) and **no optimistic update**. Every screen is
fetch-on-focus/mount with no shared cache, so switching tabs re-fetches everything.

---

## Phase 0 — Make every interaction feel instant (P0, highest ROI)

### 0.1 — Kill the per-action auth round-trip
`getTasksApi()` / `getProjectsApi()` call `getUser()` (network) on every read and
write. The user id is already available locally via the session. Cache it (kept in
sync with `onAuthStateChange`) and fall back to `getSession()` (local AsyncStorage,
no network) — never `getUser()` — on the hot path. Removes one network hop from
_every_ operation. **Effort: S.** _(Status: ✅ done — `apps/mobile/lib/supabase.ts`.)_

### 0.2 — Optimistic updates for high-frequency actions
Complete/reopen, reschedule, reorder, and field edits should mutate local state
_immediately_ and reconcile in the background — never spin and wait. Replace the
spinner checkbox with an instant check + animated strike-through/fade.
**Effort: M.** _(Status: ✅ done — all four. `toggleComplete`, `updateTask`,
`reorderTasks` and `moveTask` in `lib/task-queries.ts` each apply to the cache
first, snapshot for rollback, then write. The spinner checkbox became the shared
680ms completion gesture; see the Ticking-a-task-off section of CLAUDE.md.)_

### 0.3 — Introduce a shared client cache (TanStack Query) ✅
All list screens now read from a single TanStack Query cache (`lib/task-queries.ts`,
`lib/query-client.ts`). Tabs share data and show instantly; refetch is background +
deduped, with an AppState focus integration. Mutations are module-level functions
that run through the singleton client (so an optimistic row removal that unmounts
the row can't strand the rollback/reconcile on a dead observer). This generalises
0.2 — the per-screen `onOptimisticToggle` plumbing is gone. **Effort: M–L.**
_(Status: ✅ done.)_

### 0.4 — Move the pre-update `SELECT` off the write path
**Half done, and the remaining half is a different problem than it was.** The pet
work itself no longer blocks: `TasksApi.update` fires it as a detached
`void (async () => …)` after the row comes back, and swallows its failures, so a
sick `PetsApi` can't slow or break a task write.

The `SELECT` of the prior row is still there — but it is **no longer only for
pets**, so deleting it is not the local change it once was. It now also decides
whether this write is a first transition to `done` (to stamp `completed_at`) or
back out of it (to clear it), and it feeds `statusSyncPatch` the prior status and
`scheduled_date` so status ↔ schedule auto-sync can fold into the *same* `UPDATE`.
Removing it means moving all three into the database — a trigger, or an `UPDATE …
RETURNING` with the old values — not just relocating the pet call.

It also matters much less than it did: the write is off the interaction's critical
path entirely now that 0.2/0.3 landed, so this is throughput and correctness-under-
concurrency, not perceived speed. **Effort: M.** _(Status: 🟡 pet feeding
detached; the `SELECT` remains, and `completed_at` and status sync now
depend on it.)_

---

## Phase 1 — Native mobile affordances (P0/P1)

The web app leans on drag-and-drop; mobile copied it (drag handle on Today) but
skipped the gestures phones are good at.

- **1.1 — Swipe actions on rows.** Swipe-right = complete/reopen, swipe-left =
  Today + Delete. _The_ missing mobile interaction. Uses `ReanimatedSwipeable` from
  `react-native-gesture-handler`. **Effort: M.** _(Status: ✅ done — `TaskItem.tsx`.)_
- **1.2 — Haptics.** Added `expo-haptics` (`lib/haptics.ts`): success on complete +
  quick-add, light on reschedule, medium on delete + drag pickup. **Effort: S.**
  _(Status: ✅ done.)_
- **1.3 — Memoize `TaskItem` + stabilize callbacks.** `React.memo` + `useCallback`'d
  `onPress` per list, so opening the editor / one row's flip no longer re-renders the
  whole list. **Effort: S.** _(Status: ✅ done.)_
- **1.4 — Consistent reorder.** Today's drag now sets the local order immediately and
  persists `sort_order` in the background via `reorderTasks` (no full reload).
  **Effort: S.** _(Status: ✅ done.)_
- **1.5 — Interactive + draggable rows everywhere.** ✅ Today is now a single
  draggable list (Overdue rescue section + one `DraggableFlatList`); the old
  non-interactive Focus cards are gone — focus picks are merged in and marked with a
  ⭐ (a score-ranked section can't hold a hand-drag order). Inbox is draggable, and
  **All + Upcoming support drag _between_ sections** (drag a task to another day to
  reschedule it, or to another status group to restatus it) via a single
  `DraggableFlatList` with header rows as anchors (`components/SectionedDraggableList`).
  One-swipe **Tomorrow** alongside Today/Delete. **Effort: M.** _(Status: ✅ done.)_

---

## Phase 2 — Close feature-parity gaps (P1)

Written when mobile had 4 tabs (Today/Inbox/Projects/Settings) against web's far
larger surface. It now has 5 — Today · Inbox · Upcoming · All · Projects — with
Settings behind the gear in the Today header, plus routes for search, a project,
a tag, completed, saved places and status sync. 2.5 and 2.6 are the gap that's
left.

- **2.0 — All view (the surfacing fix).** ✅ New `app/(tabs)/all.tsx` tab lists
  **every active task grouped by status** (Inbox / In Progress / Next / Not Started).
  Before this, any active task that was undated or future-dated and not in an
  opened project was **invisible** — the app wasn't really usable. **Effort: M.**
  _(Status: ✅ done.)_
- **2.1 — Search.** ✅ Full-screen search (`app/search.tsx`) over `TasksApi.search`,
  reachable from a header icon on Today and All. **Effort: M.** _(Status: ✅ done.)_
- **2.2 — Upcoming view.** ✅ New `app/(tabs)/upcoming.tsx` tab: Overdue → Today →
  Tomorrow → each dated day in a 14-day horizon → Later (beyond the horizon) →
  Anytime (undated), all interactive rows. Day-to-day moves use the one-swipe Today/Tomorrow + reschedule
  menu (cross-day drag isn't supported across lists by the drag lib). Tab bar
  reorganized to Today · Inbox · Upcoming · All · Projects; Settings moved to a gear
  icon in the Today header. **Effort: M.** _(Status: ✅ done.)_
- **2.3 — Project detail.** ✅ Project rows are now tappable and route to
  `app/projects/[id].tsx` — a scoped Open/Done task list with quick-add that captures
  into the project. **Effort: M.** _(Status: ✅ done.)_
- **2.4 — Settings.** ✅ Replaced the dead mockup rows with working ones, and it
  has kept growing since: Tags, Completed tasks, Saved places, Status and schedule,
  a Calendar Integration section (connecting is still web-only, but "Show calendar
  events" and "Calendars to show" are live here), and a version block with channel,
  running bundle and a Check-for-updates action; sign-out unchanged.
  **Effort: M.** _(Status: ✅ done.)_
- **2.5 — Calendar / week view.** Still open, and now the only half left: the
  All-by-status side shipped as 2.0. Mobile has no week or agenda-grid screen —
  `ScheduleCalendar` is a month grid *inside* the task editor, and
  `app/calendars.tsx` is the which-Google-calendars-show-up setting, not a view.
  Lower urgency on a phone. **Effort: M–L.**
- **2.6 — Pet / gamification surface.** Still open, and untouched: `PetsApi`
  (state, goals, mood, history) has no importer anywhere under `apps/mobile`.
  Pip is web-only. A compact mobile surface is a differentiator. **Effort: M.**

---

## Phase 3 — Capture & AI input (P1 — the product's wedge)

- **3.1 — Live parse preview in quick-add.** ✅ The quick-add composer shows a
  live row of parsed chips (date / deadline / priority / estimate / repeat /
  tags) above the input as you type — new `components/ParsePreview.tsx`. (It
  first landed in the quick-add bar, and moved across when that bar became the
  plus button.) **Effort: S–M.**
  _(Status: ✅ done.)_
- **3.2 — Voice capture, finished.** ✅ Shipped larger than the item asked for: a
  recording produces **two** artefacts and DoDone keeps both — the transcript as the
  task's text, and the audio as an ordinary attachment, from one microphone session
  (`recordingOptions: { persist: true }`). `packages/shared/src/voice.ts` splits a
  transcript into title and description; `lib/voice-session.ts` (pure decisions),
  `lib/voice-capture.ts` (the native module, lazily required so Expo Go degrades to
  `supported: false`), `lib/voice-note.ts` (the upload) and `lib/use-voice-quick-add.ts`
  (the create-then-attach flow) sit under `components/VoiceRecorder.tsx`. Four doors
  reach it: a long press on a list screen's plus button, `dodone://quick-add?voice=1`,
  the **Voice task** launcher shortcut, and 🎙 Record in the task editor. No auto-submit, deliberately.
  **Still needs a dev-client/preview build** — `expo-speech-recognition` and
  `expo-audio` are native modules and will not arrive over OTA. **Effort: M.**
  _(Status: ✅ done — see the Voice notes section of CLAUDE.md. Superseded and
  closed PR #45, which proposed a smaller transcript-only version.)_
- **3.3 — Recurrence UI.** ✅ The editor has a Repeat row with preset chips
  (None / Daily / Weekdays / Weekly / Monthly) that set `recurrence_rule`, plus a ↻
  badge on recurring task rows. Typed `every …` syntax still parses. **Effort: S–M.**
  _(Status: ✅ done.)_
- **3.4 — Location-based tasks UI.** Reminders at saved places, attached from the
  task editor's 📍 row (`LocationReminderSheet`) and managed at Settings → Saved
  places (`app/locations.tsx`). Enter/exit triggers are dwell-filtered so a
  drive-by doesn't fire, rate-limited per task, and trimmed to the platform's
  region cap. **Effort: M.** _(Status: ✅ built — but **none of it has run on a
  device**. Geofences, the dwell filter, the notification channel and all three
  permission prompts execute in neither Expo Go nor CI, and every failure mode
  here is silent. See "Where things stand" in [`HANDOFF.md`](HANDOFF.md).)_

---

## Phase 4 — Polish & correctness (P2, cheap wins)

- **4.1 — Dark mode is claimed but not implemented.** Still true, and still the
  largest open polish item. Every screen hardcodes light hex; `useColorScheme`
  appears only in `app/_layout.tsx` and the untouched Expo-template `Themed.tsx`;
  `@do-done/ui` is a dependency in `apps/mobile/package.json` that **no mobile
  source file imports**. Implement real theming or stop advertising it. Note the
  home-screen widgets *do* ship a dark card (`widgets/widget-theme.ts`, one tree
  with the theme as an argument) — that's the pattern to copy, and it makes the
  app's light-only screens the odd one out on the same device. **Effort: M.**
- **4.2 — Timezone bug in "Today" filtering.** ✅ Fixed at the source:
  `@do-done/shared` now exports `todayLocalISO` / `addDaysLocalISO` and `isOverdue` /
  `isDueToday` use local date instead of UTC `toISOString()`. Mobile screens
  (`index.tsx`, `TaskItem.tsx`, `OverdueSection.tsx`) all use the shared helpers, so
  "today" is consistent across the app. (Also fixes the same UTC bug on web.)
  **Effort: S.** _(Status: ✅ done.)_
- **4.3 — Inconsistent staleness.** ✅ Done, and moot exactly as predicted: 0.3
  removed the hand-rolled loads, and every tab screen now shares the query cache
  behind one `useRefreshOnFocus`. **Effort: S.** _(Status: ✅ done.)_
- **4.4 — Silent error swallowing.** ✅ Done. `lib/list-load-state.ts` decides
  skeleton vs. empty vs. error once for every list, and `ListError` in
  `components/ListPlaceholder.tsx` draws it — without which an offline first launch
  pulsed a skeleton forever. **Effort: S.** _(Status: ✅ done.)_
- **4.5 — Empty/loading polish + a11y.** 🟡 **Loading polish done; a11y is what's
  left.** The cold-start work (see below) replaced the bare centered text with
  `ListSkeleton`, a self-delaying `UpdatingBar` for background refreshes, and the
  empty/skeleton distinction that stops the app opening on "Nothing scheduled
  today" before it has an answer. Accessibility is still thin — ~34
  `accessibilityLabel`s across all of `apps/mobile`, concentrated on the newer
  controls (the mic, swipe actions); most older rows and chips have none, and
  nothing has been checked with TalkBack or VoiceOver on a device. **Effort: S–M.**

---

## The one big architectural bet: offline-first

`POWERSYNC_URL` is in the env contract and CLAUDE.md, but **nothing in the repo uses
PowerSync** — still true; the name appears only in `README.md`, `CLAUDE.md`,
`.env.example` and these docs. For a to-do app, local-first (instant reads _and_
writes, background sync queue, works offline) is the difference between "good" and
"feels better than the web app."

Two stepping stones are in place now rather than one: Phase 0.3's cache, and
`lib/query-persist.ts`, which mirrors that cache into AsyncStorage so a launch
opens on the rows the user last saw. That covers cold **reads** offline. What's
still missing is the write half — a queue that survives being offline and
reconciles — which is the actual PowerSync (or SQLite + sync layer) bet. Highest
ceiling, highest effort — worth a dedicated spike. **Effort: L.**

---

## Shipped since this roadmap was written

Most of the mobile work of the last two months has no phase number here, because
it wasn't foreseen by this document. Listed so the roadmap isn't read as a
complete picture of the app. Each is described properly in `CLAUDE.md`:

| What | Where |
|---|---|
| **The two-slot task row** — ring for the project, gutter for urgency, one muted subline for everything else, shared with web and the widgets via `packages/shared/src/task-row.ts` | _The task row_ |
| **The completion gesture** — one 680ms envelope (flinch, spring, halo, strike-through, gated sparks, exit), constants shared so web and mobile can't drift | _Ticking a task off_ |
| **Home-screen widgets** — Today, Upcoming, a 4×1 Next up strip, and the 1×1 Quick Add tile that floats a composer over the launcher | _Android widget setup_ |
| **Launcher quick actions** — Add task / Voice task / Search / Today / Upcoming, each pinnable | _Launcher quick actions_ |
| **Attachments** — files, images and voice notes on a task, with Markdown rendered through `@do-done/shared`'s block tree | _Attachments_ |
| **Voice notes** — 3.2 above, and then some | _Voice notes_ |
| **Location reminders** — geofenced enter/exit triggers with dwell filtering; the 3.4 work, still unverified on a device | _Location reminders_ |
| **Cold start** — a persisted query cache, and one shared decision for skeleton vs. empty vs. error | _Cold start (mobile)_ |
| **Drag correctness** — `moveTask` makes a cross-section drop one optimistic apply and one invalidate, instead of three re-layouts | _Dragging a row (mobile)_ |
| **The editor sheet on the UI thread** — Reanimated worklets, a derived backdrop, pickers mounted only while up | _The task editor sheet (mobile)_ |
| **Swipe actions, corrected** — `panelForSwipe()` and per-id serialized completion writes so undo can't lose the race | _Swiping a task row (mobile)_ |
| **Tags** — a tag index and per-tag views, counted by the same `summarizeTags` every surface uses | _Seeing tags, and filtering by one_ |
| **Status ↔ schedule auto-sync** — opt-in promote/backfill, applied in `TasksApi` so all three clients inherit it | _Status ↔ schedule auto-sync_ |
| **Project icons** — a Phosphor set beside the emoji catalogue, in three weights | _`projects.icon` holds two kinds of thing_ |

---

## Suggested sequencing

Orders 1–4 are done. What remains, in the order it's worth doing:

| Order | Theme | Why |
|---|---|---|
| 1 | **4.1 dark mode** | The one thing the app claims and doesn't do; the widgets already have the pattern |
| 2 | **4.5's a11y half** | Cheap per control, and the newer surfaces already set the convention to follow |
| 3 | **2.6 Pip on mobile** | Pure differentiator, and the API is written and unused |
| 4 | **0.4 / 2.5** | Throughput and a week view — both real, neither felt day to day |
| 5 | **The PowerSync spike** | The moat, once the cheap wins are banked |

<details>
<summary>The original sequencing, for the record</summary>

| Order | Theme | Why first |
|---|---|---|
| 1 | Phase 0.1 + 0.2 + 0.3 | Directly fixes "slow"; everything rides on the cache |
| 2 | Phase 1 (swipe + haptics + memo) | Makes it _feel_ native, low effort |
| 3 | Phase 3.1 + 3.2 (capture/voice) + 2.1 (search) | The actual differentiators |
| 4 | Phase 2.3 / 2.4 / 2.2 (projects, settings, upcoming) | Parity + removes dead-ends |
| 5 | Phase 4 polish, then the PowerSync spike | Correctness, then the moat |

</details>
