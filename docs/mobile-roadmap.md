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

### 0.3 — Introduce a shared client cache (TanStack Query or a Zustand store)
Today the `Today`, `Inbox`, `Completed`, `Projects` screens each hold their own
`useState` list and re-fetch in full on focus. A single normalized task cache means:
tabs share data, mutations patch the cache (no full refetch), and refetches become
background + deduped. This is the backbone for 0.2 generalised. **Effort: M–L.**

### 0.4 — Move pet feeding off the write path
The extra `SELECT` before every `update` (`tasks.ts:113`) doubles mobile write
latency. A Postgres trigger / edge function for pet events makes writes
single-round-trip. **Effort: M.**

---

## Phase 1 — Native mobile affordances (P0/P1)

The web app leans on drag-and-drop; mobile copied it (drag handle on Today) but
skipped the gestures phones are good at.

- **1.1 — Swipe actions on rows.** Swipe-right = complete, swipe-left =
  schedule/delete. _The_ missing mobile interaction. Use `react-native-gesture-handler`
  Swipeable (already a dep). **Effort: M.**
- **1.2 — Haptics.** Zero haptic feedback anywhere. Add `expo-haptics` on complete,
  reorder pickup/drop, swipe-commit, and slider detents. **Effort: S.**
- **1.3 — Memoize `TaskItem` + stabilize callbacks.** Not `React.memo`'d, so every
  `load()` re-renders the whole list. **Effort: S.**
- **1.4 — Consistent reorder.** Today's drag persists via `bulkUpdate` then a **full
  reload** (`index.tsx`) — janky. Patch the cache, persist in background.
  **Effort: S.**

---

## Phase 2 — Close feature-parity gaps (P1)

Mobile has 4 tabs (Today/Inbox/Projects/Settings); web has far more.

- **2.1 — Search / command palette.** Mobile has **no search at all**.
  `TasksApi.search()` exists; web has ⌘K. Add a search affordance. **Effort: M.**
- **2.2 — Upcoming view (14-day).** Exists on web, absent on mobile.
  `TasksApi.getUpcoming()` is ready. **Effort: M.**
- **2.3 — Project detail.** Projects-tab rows **aren't tappable** — `Pressable` has no
  `onPress` (`projects.tsx`). Can't open a project, see its tasks, or create one.
  **Effort: M.**
- **2.4 — Settings is a dead mockup.** Every `SettingsRow` and "Connect Google
  Calendar" have no `onPress` (`settings.tsx`); only sign-out works. Wire them up or
  hide them. **Effort: M.**
- **2.5 — Calendar / week view & All-by-status.** Lower urgency on a phone.
  **Effort: M–L.**
- **2.6 — Pet / gamification surface.** The whole `PetsApi` (state, goals, mood,
  history) is unused on mobile. A compact "Pip" surface is a differentiator.
  **Effort: M.**

---

## Phase 3 — Capture & AI input (P1 — the product's wedge)

- **3.1 — Live parse preview in quick-add.** Mobile's `QuickAddBar` submits blind;
  show parsed chips (date/priority/tags) before submit. **Effort: S–M.**
- **3.2 — Voice capture, finished.** Voice only works in a dev-client, only fills the
  textbox, never auto-confirms (`QuickAddBar.tsx`). Make it first-class: transcript →
  parse → confirm chips → save. **Effort: M.**
- **3.3 — Recurrence UI.** `detectRecurrence` understands rich patterns, but mobile's
  editor has _no_ recurrence field. Add a repeat picker. **Effort: S–M.**
- **3.4 — Location-based tasks UI.** Geofencing is fully wired in the background
  (`geofencing.ts`) and `LocationsApi` exists, but there's **no UI** to create a
  location or attach one to a task. The plumbing is done; the surface is missing.
  **Effort: M.**

---

## Phase 4 — Polish & correctness (P2, cheap wins)

- **4.1 — Dark mode is claimed but not implemented.** Every screen hardcodes light
  hex; `useColorScheme` is imported but unused in screens; the `@do-done/ui` token
  package isn't consumed. Implement real theming or stop advertising it. **Effort: M.**
- **4.2 — Timezone bug in "Today" filtering.** List screens compute today with
  `new Date().toISOString().split('T')[0]` (**UTC** — `index.tsx`, `TaskItem.tsx`),
  but the editor's `ymd()` uses **local** date (`TaskEditModalV2.tsx`). A task
  scheduled "today" can fail to appear in the Today list near midnight in non-UTC
  zones. Unify on local. **Effort: S.**
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
