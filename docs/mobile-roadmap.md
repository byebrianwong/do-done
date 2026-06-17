# do-done Mobile — Roadmap to "fast and powerful"

_Last updated: 2026-06-07_

A product + technical plan to make the React Native / Expo app feel **faster than
the web app**, leaning into the affordances a phone actually has (swipe, haptics,
voice, location) rather than porting the web's drag-and-drop interaction model.

The roadmap is ordered by return-on-effort. **Phase 0 is ~80% of the
perceived-speed win** and reuses pieces that already exist.

---

## The core diagnosis: why it _feels_ slow

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
**Effort: M.** _(Status: ✅ complete/reopen done; reschedule + reorder follow.)_

### 0.3 — Introduce a shared client cache (TanStack Query) ✅
All list screens now read from a single TanStack Query cache (`lib/task-queries.ts`,
`lib/query-client.ts`). Tabs share data and show instantly; refetch is background +
deduped, with an AppState focus integration. Mutations are module-level functions
that run through the singleton client (so an optimistic row removal that unmounts
the row can't strand the rollback/reconcile on a dead observer). This generalises
0.2 — the per-screen `onOptimisticToggle` plumbing is gone. **Effort: M–L.**
_(Status: ✅ done.)_

### 0.4 — Move pet feeding off the write path
The extra `SELECT` before every `update` (`tasks.ts:113`) doubles mobile write
latency. A Postgres trigger / edge function for pet events makes writes
single-round-trip. **Effort: M.**

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

Mobile has 4 tabs (Today/Inbox/Projects/Settings); web has far more.

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
- **2.4 — Settings.** ✅ Replaced the dead mockup rows with working ones: Completed
  (nav), Google Calendar (honest "web only" note), and an About/version row; sign-out
  unchanged. **Effort: M.** _(Status: ✅ done.)_
- **2.5 — Calendar / week view & All-by-status.** Lower urgency on a phone.
  **Effort: M–L.**
- **2.6 — Pet / gamification surface.** The whole `PetsApi` (state, goals, mood,
  history) is unused on mobile. A compact "Pip" surface is a differentiator.
  **Effort: M.**

---

## Phase 3 — Capture & AI input (P1 — the product's wedge)

- **3.1 — Live parse preview in quick-add.** ✅ `QuickAddBar` shows a live row of
  parsed chips (date / deadline / priority / estimate / repeat / tags) above the
  input as you type — new `components/ParsePreview.tsx`. **Effort: S–M.**
  _(Status: ✅ done.)_
- **3.2 — Voice capture, finished.** Voice only works in a dev-client, only fills the
  textbox, never auto-confirms (`QuickAddBar.tsx`). Make it first-class: transcript →
  parse → confirm chips → save. **Effort: M.**
- **3.3 — Recurrence UI.** ✅ The editor has a Repeat row with preset chips
  (None / Daily / Weekdays / Weekly / Monthly) that set `recurrence_rule`, plus a ↻
  badge on recurring task rows. Typed `every …` syntax still parses. **Effort: S–M.**
  _(Status: ✅ done.)_
- **3.4 — Location-based tasks UI.** Geofencing is fully wired in the background
  (`geofencing.ts`) and `LocationsApi` exists, but there's **no UI** to create a
  location or attach one to a task. The plumbing is done; the surface is missing.
  **Effort: M.**

---

## Phase 4 — Polish & correctness (P2, cheap wins)

- **4.1 — Dark mode is claimed but not implemented.** Every screen hardcodes light
  hex; `useColorScheme` is imported but unused in screens; the `@do-done/ui` token
  package isn't consumed. Implement real theming or stop advertising it. **Effort: M.**
- **4.2 — Timezone bug in "Today" filtering.** ✅ Fixed at the source:
  `@do-done/shared` now exports `todayLocalISO` / `addDaysLocalISO` and `isOverdue` /
  `isDueToday` use local date instead of UTC `toISOString()`. Mobile screens
  (`index.tsx`, `TaskItem.tsx`, `OverdueSection.tsx`) all use the shared helpers, so
  "today" is consistent across the app. (Also fixes the same UTC bug on web.)
  **Effort: S.** _(Status: ✅ done.)_
- **4.3 — Inconsistent staleness.** `Inbox` uses `useEffect` (mount-only) so it goes
  stale after a widget add; `Today` uses `useFocusEffect`. Standardize (moot once 0.3
  lands). **Effort: S.**
- **4.4 — Silent error swallowing.** Loads do `setTasks(data ?? [])` with no error
  handling — a failed fetch looks like an empty list. Surface errors/retry.
  **Effort: S.**
- **4.5 — Empty/loading polish + a11y.** Bare centered text; add skeletons and richer
  empty states. Accessibility labels missing on most controls. **Effort: S–M.**

---

## The one big architectural bet: offline-first

`POWERSYNC_URL` is in the env contract and CLAUDE.md, but **nothing in the repo uses
PowerSync**. For a to-do app, local-first (instant reads _and_ writes, background
sync queue, works offline) is the difference between "good" and "feels better than
the web app." Phase 0.3's cache is a stepping stone; PowerSync (or SQLite + a sync
layer) is the destination. Highest ceiling, highest effort — worth a dedicated spike.
**Effort: L.**

---

## Suggested sequencing

| Order | Theme | Why first |
|---|---|---|
| 1 | Phase 0.1 + 0.2 + 0.3 | Directly fixes "slow"; everything rides on the cache |
| 2 | Phase 1 (swipe + haptics + memo) | Makes it _feel_ native, low effort |
| 3 | Phase 3.1 + 3.2 (capture/voice) + 2.1 (search) | The actual differentiators |
| 4 | Phase 2.3 / 2.4 / 2.2 (projects, settings, upcoming) | Parity + removes dead-ends |
| 5 | Phase 4 polish, then the PowerSync spike | Correctness, then the moat |
