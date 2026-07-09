# DoDone Mobile ⇄ Web Parity Plan

_Last updated: 2026-07-08_

A full audit of where the web app (`apps/web`) and the mobile app (`apps/mobile`)
have drifted, and a phased plan to close the gaps — in **both** directions — while
keeping mobile's native advantages (widgets, geofencing, haptics, voice) ahead of
the web rather than merely equal to it.

This supersedes the gap sections of [`docs/mobile-roadmap.md`](mobile-roadmap.md)
(2026-06-07); that doc's Phase 0/1 performance work is done and its remaining open
items are folded in here with fresh status.

**How this was audited:** feature-by-feature inventory of both apps' source, a
commit-classification pass over the last ~80 commits (paired `feat(web)`/`feat(mobile)`
PRs vs. one-sided ones), and a usage matrix of every `@do-done/task-engine` /
`@do-done/api-client` export against both apps.

---

## TL;DR — the state of parity

The core loop is in good shape. The last two months of paired PRs (#86–#135) kept
the fundamentals in sync: both apps share the V2 autosave task modal, the NLP
quick-add parser, the Display engine (group/sort/filter, persisted cross-device via
`user_preferences.display_prefs`), Today's Focus/Other curation, drag-to-reschedule,
collapsible sections, overdue bulk-reschedule, the `later` status, and read-only
Google Calendar events in Today/Upcoming.

The drift is concentrated in **five one-sided feature clusters**:

| # | Cluster | Who's ahead | Size |
|---|---|---|---|
| 1 | Google Calendar *management* (connect, pick calendar, two-way sync, suggest-slots/"Find a time") | Web | L |
| 2 | Pet / Pip companion (whole `PetsApi` surface) | Web | M–L |
| 3 | Row-level power editing (context menu: inline priority/estimate/when editors, focus toggle, duplicate, copy link, deadline, undo-delete) | Web | M |
| 4 | Recurrence editing UI in the task modal | **Mobile** | S (port to web) |
| 5 | Locations / geofencing UI (mobile has the plumbing + background triggers; **neither** app has a management UI) | Mobile (plumbing only) | M |

Plus a tail of small gaps (Google OAuth sign-in on mobile, timezone setting,
deadline editor in the mobile modal, inbox-filter on Upcoming, week/calendar view)
and shared-code hygiene items, all catalogued below.

### Scope & priorities (this iteration)

Two deliberate calls shape the plan below:

- **Pip stays off mobile for now.** Cluster #2 is a real drift, but porting the
  gamification surface is explicitly **out of scope** for this iteration. Mobile
  should stay focused on making *core task functionality* excellent. The gap is
  documented (A2) but does **not** appear in any near-term phase.
- **Home-screen widgets are a flagship, native-first priority.** Beyond mere
  parity, the widgets are where mobile should feel *amazing* and clearly ahead of
  the web: a crisp 1×1 Quick Add tile that opens a near-instant capture sheet, and
  a family of task-view widgets that mirror the app's own views (Today, Upcoming, …)
  with grouping, resizing, and interactivity. This is elevated to **Phase 1**
  (see "Flagship: Home-screen widgets" below).

---

## Part 1 — Already at parity (don't re-do)

| Capability | Web | Mobile | Notes |
|---|---|---|---|
| V2 task edit modal (autosave via shared `useAutoSaveTask`, title `#tag` extraction, WhenCalendar + busyness dots, when_time half-hour picker, priority bars, estimate equalizer, status picker, project picker w/ inline create, subtasks ≤ depth 2, notes, delete) | ✅ | ✅ | Mobile's month picker is actually richer (#128) |
| Quick-add with NLP (`parseTaskInput`: priority, slash-dates, `#xs..#xxl`, `#tags`, chrono dates, recurrence) + live parse preview + chip overrides | ✅ | ✅ | Different surfaces, same engine |
| Display options (group None/Status/Priority/Project/Date/Tag, 8 sorts, priority/overdue/project/tag filters, show-completed, reset) persisted per-view in AsyncStorage/localStorage + `display_prefs` (cross-device) | ✅ | ✅ | Wired on Today/Upcoming/All on both |
| Today: Focus (top 3 via `partitionToday`) + Other, drag across boundary sets `focus_override`, overdue section w/ bulk reschedule, today's calendar-events card | ✅ | ✅ | |
| Upcoming: date sections, drag-to-day reschedules `when_date`, per-day calendar events | ✅ | ✅ | Web: 30-day columns; mobile: 14-day agenda + Later/Anytime |
| Inbox / All / Completed / Project detail / Search | ✅ | ✅ | Search: web = ⌘K palette, mobile = dedicated screen |
| Read-only Google Calendar events in Today + Upcoming, `show_calendar_events` toggle | ✅ | ✅ | Mobile fetches via web's `/api/calendar/events` (Bearer) — pattern to reuse |
| Undo toast on task completion | ✅ | ✅ | Web additionally undoes delete — see gap A3 |
| Drag reorder w/ persisted `sort_order`, cross-group drag re-statuses/reschedules, sorted-view → manual conversion | ✅ | ✅ | Different libs (dnd-kit vs DraggableFlatList), same semantics |

---

## Part 2 — Gap analysis

### A. Web → mobile gaps (parity debt on mobile)

**A1. Google Calendar management + scheduling — the biggest gap.**
Web has the whole stack: OAuth connect/disconnect, calendar picker, two-way sync
(outbox push trigger + webhook pull + etag echo-suppression, PRs #109–#130),
task↔event linking (`calendar_event_id` — 0 references in mobile), all-day
handling, "Sync now", and **"Find a time"** (`ScheduleButton` →
`POST /api/calendar/suggest-slots`, focus-hours + busy-aware slot suggestions).
Mobile is a read-only event viewer whose Settings row literally says "connect on
the web app". Nothing in the sync engine is client-specific — it's all server-side
API routes, so mobile needs *UI + route calls*, not a reimplementation.

**A2. Pet (Pip) — entire feature absent on mobile. → DEFERRED (out of scope this iteration).**
`PetsApi`, decay math, goals, and activity log are fully shared
(`packages/shared/src/pet-decay.ts`, `packages/api-client/src/pets.ts`) and already
consumed by web + MCP. Mobile has zero references. Mobile users still *feed* Pip
(feeding happens inside `TasksApi.create/update`) but can never see it — the
gamification loop is invisible on the device where quick capture happens most.
Blocker to port: `Pip.tsx` is a procedural web-SVG renderer → needs a
`react-native-svg` port. **Intentionally not scheduled** — mobile stays focused on
core task functionality first; revisit after the widget + core-parity work lands.

**A3. Row-level power editing.**
Web rows have a right-click context menu (schedule, priority, estimate,
add/remove-from-Focus, deadline, move-to-project, duplicate, copy link, delete)
plus inline popover editors and undo-delete via toast. Mobile's long-press menu
(`TaskItem.tsx` `rescheduleActions`) only covers Today/Tomorrow/This week/Remove
dates/Delete. Missing on mobile: **priority, estimate, focus toggle, duplicate,
move-to-project, deadline, copy link — and undo for delete** (mobile uses a
blocking confirm dialog instead of web's undoable delete).

**A4. Google sign-in.**
Web login has "Continue with Google" (`signInWithOAuth`); mobile login
(`app/(auth)/login.tsx`) is email/password only — no `AuthSession`/OAuth anywhere
in mobile. Worst-case a user who signed up on web with Google can't log in on
mobile at all without setting a password.

**A5. Deadline (`due_date`/`due_time`) editing in the modal.**
Web's `WhenCalendar` embeds a `DueDateField` (quick options + native date +
clear). Mobile's modal centers on `when_date`/`when_time` and has **no direct
due-date editor** — deadlines are only settable by typing NL into quick-add.

**A6. Timezone preference.**
Web settings has the IANA dropdown + auto-detect (`updateTimezone`, PR #124).
Mobile has no timezone UI and always uses the device zone. `user_preferences.timezone`
drives suggest-slots and calendar sync, so a mobile-only user can't fix a wrong TZ.

**A7. Calendar-event busyness dots in the modal.**
Web's modal calendar merges tasks + events via `/api/calendar/busyness`; mobile's
is tasks-only (`BusynessApi.getTasksRange` — explicitly deferred in the file
header). The Bearer pattern from `calendar-queries.ts` makes this a small fetch swap.

**A8. Week/calendar grid view.**
Web's `/calendar` week view (timed blocks, all-day strip, drag-to-day) has no
mobile counterpart. The old roadmap rated this "lower urgency on a phone" (2.5) —
still true, but as calendar events grow in importance it's worth a lightweight
version (day/3-day agenda rather than a 7-column grid).

**A9. Project management.**
Web: create/edit/delete projects with color, icon, description (`ProjectForm`,
`ProjectsApi.update/delete`). Mobile: create-with-color only (inside the picker
sheet); the Projects tab's empty state still says "Create projects on the web
app"; no edit/delete/icon anywhere.

**A10. Smaller gaps.**
- **Upcoming inbox-filter toggle** (`?inbox=hide` pill) — web only.
- **Display config on Inbox + Project detail** — web's `TaskDisplayView` gives
  these views group/sort/filter; mobile hardcodes flat/Open-Done layouts.
- **Task deep link** — web has `/task/[id]` + "Copy link"; mobile has no
  `dodone://task/<id>` route (also needed for notification taps, see D2).
- **Quick-add → full editor handoff** — web's "More options →" creates then opens
  the modal; mobile's composer/bar can't expand into the editor.
- **Completed screen rows are read-only** on mobile (web's completed view opens
  the modal to reopen/edit).
- **Duplicate task** — web context menu only.

### B. Mobile → web gaps (web is behind)

**B1. Recurrence editor.**
Mobile's modal has a full "↻ Repeat" `RepeatRow` (None/Daily/Weekdays/Weekly/
Monthly presets → RRULE). Web's `task-edit-modal-v2.tsx` has **zero** recurrence
UI — web users can only set recurrence by typing NL in quick-add and can never
change or clear it from the editor. Port the RepeatRow.

**B2. Locations UI (and web awareness of locations at all).**
Mobile has the full background half: `LocationsApi` + geofence registration +
enter/exit local notifications (`lib/geofencing.ts`). But **no UI exists anywhere**
— on either app — to create a location, set its radius/trigger, or attach it to a
task. The shared schema (`LocationSchema`, `TaskLocationSchema`) and API are done;
only the surface is missing. Mobile should get the management UI first (it's the
consumer); web should at least display/edit task↔location links.

**B3. Hygiene: mobile reimplements `recurrenceShortLabel`** locally instead of
importing the shared `formatRrule` — labels can drift from web's.

### C. Shared-code / architecture drift (maintenance risk, not user-visible)

- **C1. Fetch-path divergence.** Web pages use purpose-built server methods
  (`getToday`, `getUpcoming`, `listUndated`, `listOverdue`); mobile fetches
  `list()` and re-derives views client-side. A filtering fix to the server methods
  (like gotcha #16's `when_date OR due_date` rule) silently won't reach mobile.
  Either move mobile onto the same methods or extract the view predicates into
  `@do-done/shared` so both consume one definition.
- **C2. `taskDate()` helper** (effective-date resolution) used by web, not mobile.
- **C3. `@do-done/ui` tokens** — declared as a mobile dependency, never imported;
  mobile hardcodes hex (and `constants/Colors.ts` still has Expo-template blue
  `#2f95dc`, not brand indigo). Fold into the dark-mode work (D4).
- **C4. Expo template leftovers** — `app/modal.tsx` + `EditScreenInfo.tsx`
  (registered but unreachable), `StyledText`, template test. Delete.

### D. Dormant capability & native-first opportunities (mobile should be *better*)

- **D1. Dormant engine modules.** `scheduleTasks` (bin-packing scheduler) and
  `suggestCategories`/`suggestTags` (categorizer) are exported from
  `@do-done/task-engine` and consumed by **no** client; `generateWeeklySummary`
  only by MCP. Either surface them (tag autocomplete from the categorizer; weekly
  review screen from the summary) or prune them.
- **D2. Reminders — the biggest native win nobody has.** Tasks have
  `when_time`/`due_time`, mobile already ships `expo-notifications` (used only for
  geofences), yet **no time-based reminders exist on any platform**. Local
  notifications for "task at 3pm" are cheap on mobile and impossible on web
  (without push infra) — a true leapfrog feature.
- **D3. Voice capture** works only in dev-client builds and only fills the text
  box (roadmap 3.2 still open). Finish: transcript → parse → confirm chips → save.
- **D4. Dark mode** (roadmap 4.1) — still claimed by config, still not implemented.
- **D5. Home-screen widgets — the flagship native surface (see the dedicated
  section below).** Two Android widgets exist today; the goal is a polished,
  interactive widget *family*. iOS widgets remain out (stack is Android-only via
  `react-native-android-widget`) — a future SwiftUI/WidgetKit effort.
- **D6. Offline-first / PowerSync** — still the one big architectural bet
  (roadmap "moat" section); env contract exists, nothing wired.

---

## Flagship: Home-screen widgets (Android)

The single biggest "mobile should be *amazing*, not just at parity" opportunity.
The web app can never put a live task list or a one-tap capture button on the OS
home screen — mobile can, and should make it best-in-class.

### Current state (`apps/mobile/widgets/`, `app.config.ts`, `plugins/withQuickAddActivity.js`)

- **Quick Add (1×1)** — `QuickAddWidget.tsx`: an indigo rounded square with a white
  "+". Tapping fires `dodoneadd://open`, resolved by a dedicated translucent
  `QuickAddActivity` (generated by `plugins/withQuickAddActivity.js`, runs in its own
  task) that floats `QuickAddComposer` over the *live* home screen — no full app
  launch. `QuickAddComposer` already has title + When/Priority/Estimate chips + tags
  and NLP parsing. **The fast-capture flow is genuinely good already**; it needs
  polish, not a rebuild.
- **Today (250×180)** — `TodayWidget.tsx`: a static list of the top 4 focus tasks
  (`generateFocusList`), priority dot + title, whole-widget tap → `dodone://today`.
  **Fixed size, no per-task interaction, no grouping, thin empty state.**
- `widget-task-handler.ts` renders both and fetches task data for Today on
  `WIDGET_ADDED`/`UPDATE`/`RESIZED`.

### The vision

1. **Quick Add stays a crisp 1×1** but gets a real widget **preview image** (today it
   reuses the app icon `previewImage: "./assets/images/icon.png"`), tighter visuals,
   and a verified cold-tap→typing path that feels instant.
2. **A family of task-view widgets that mirror the app's own views.** Start with an
   upgraded **Today** and a new **Upcoming** widget grouped by day (Today / Tomorrow /
   next days, like `app/(tabs)/upcoming.tsx`). **Resizable** so a taller widget shows
   more rows; **overdue emphasis**, priority dots, per-group counts, proper empty
   states. Both share one widget-data helper.
3. **Interactivity where the platform allows it.** A header **"+"** that deep-links
   straight to quick-add (`dodone://quick-add`); **tappable rows** that open the task
   (needs a new `dodone://task/<id>` route — which also gives web-parity "Copy link"
   and notification-tap targets); and — the headline capability — a **complete
   checkbox** that finishes the task from the background handler via
   `react-native-android-widget` click actions routed through `widget-task-handler.ts`.

All widget work is **Android-only** and requires a **dev-client / preview EAS build**
to verify on a device (widgets don't run in Expo Go, and `expo-dev-client`
intercepts the translucent-activity launch in debug builds — test in a preview
build). Code can be typechecked in CI; behavior must be device-verified.

---

## Part 3 — The plan

Ordered by user impact per unit of effort. Each phase is shippable independently;
within a phase, items are roughly independent PRs.

### Phase 1 — Flagship: Home-screen widgets (native-first; Android)

The elevated priority. Ships in slices so each is independently mergeable; all
require a preview/dev-client EAS build to device-verify.

1. **Upcoming widget (new)** — `UpcomingWidget.tsx` grouped by day (Overdue / Today /
   Tomorrow / next days) over a short horizon, resizable, registered in
   `app.config.ts` + `widget-task-handler.ts`. Shares a new `widget-data.ts` helper
   with Today (fetch → derive Today set + Upcoming groups using shared date helpers).
2. **Today widget upgrade** — resizable (row count scales with height), overdue-first
   grouping, per-group counts, richer empty state, a header **"+"** that deep-links to
   `dodone://quick-add` (distinct tap target from the row area).
3. **Interactive rows** — tappable rows open the task via a new `dodone://task/<id>`
   route (also unlocks A10 "Copy link" + notification taps); **stretch:** a complete
   checkbox that calls `TasksApi.complete` from `widget-task-handler.ts` on a
   `WIDGET_CLICK` action and re-renders. (Device-verify carefully — background
   mutation.)
4. **Quick Add widget polish** — a dedicated widget **preview asset** (stop reusing
   the app icon), visual tightening, and a verified near-instant cold-tap→typing path
   through `QuickAddActivity` → `quick-add-root.tsx`.

### Phase 2 — Core task quick wins (all S/S–M; ~1 PR each)

5. **Mobile: extend the long-press menu to full context-menu parity** — add
   Priority, Estimate, Add/Remove from Focus (`focus_override`), Move to project,
   Deadline, Duplicate. Reuse `PickerSheet`/`ProjectPickerSheet` already in the
   modal. (Closes most of A3.)
6. **Mobile: undoable delete** — swipe/menu delete fires the existing `UndoToast`
   with a `toCreateInput` recreate (mirror web's context-menu delete); drop the
   blocking `Alert.alert`.
7. **Mobile: deadline editor in the modal** — port web's `DueDateField` into
   `TaskEditModalV2` (quick options + date + clear). (A5)
8. **Web: recurrence editor** — port mobile's `RepeatRow` presets into
   `task-edit-modal-v2.tsx`; both sides render labels via shared `formatRrule`,
   deleting mobile's local `recurrenceShortLabel`. (B1 + B3)
9. **Mobile: timezone row in Settings** — IANA picker + "use device" default via
   `UserPrefsApi.updateTimezone`. (A6)
10. **Mobile: calendar-event dots in the modal calendar** — swap
    `BusynessApi.getTasksRange` for the web `/api/calendar/busyness` route using the
    existing Bearer pattern in `lib/calendar-queries.ts`, falling back to tasks-only
    when `webAppUrl` is unset. (A7)
11. **Mobile: Upcoming inbox-filter pill; Display config on Inbox + Project detail;
    tappable Completed rows.** (A10)
12. **Hygiene:** delete Expo template leftovers (C4); adopt `taskDate()` on mobile (C2).

### Phase 3 — Calendar management flagship (M–L)

13. **Mobile: Google Calendar management + "Find a time"** (A1). All server logic
    exists as web API routes; mobile adds:
    - Settings: connect via `expo-web-browser` auth session pointed at
      `/api/calendar/connect` (add a `dodone://` redirect variant to the callback
      route), then calendar picker (`/api/calendar/list` + `/select`), "Sync now"
      (`/sync`), disconnect, last-synced — same Bearer-token auth as events.
    - Task rows/modal: "Find a time" button calling `/api/calendar/suggest-slots`
      and applying the picked slot via `TasksApi.update` (port of
      `schedule-button.tsx`).
    - Fixes the empty-`webAppUrl` dead end by making the web-app URL a first-class
      requirement of the mobile build.

_(Pip on mobile — the former "second flagship port" — is intentionally deferred; see
A2. Not scheduled this iteration.)_

### Phase 4 — Native-first (mobile pulls ahead)

14. **Time-based reminders** (D2): local notifications scheduled from
    `when_date`+`when_time`/`due_time`; reschedule on edit, cancel on
    complete/delete; notification tap → the `dodone://task/<id>` deep link added in
    Phase 1. Keep scheduling logic in a shared module so web push can reuse it later.
15. **Locations management UI on mobile** (B2): map/list screen to create
    locations (radius, enter/exit trigger) + a "Location" row in the modal to link
    tasks; geofencing already consumes the result. Web follow-up: read-only
    location chips + link management.
16. **Finish voice capture** (D3): transcript → `parseTaskInput` → confirm chips →
    save, in the dev-client build.
17. **Google OAuth sign-in on mobile** (A4): `signInWithOAuth` +
    `expo-auth-session`/`WebBrowser` with a `dodone://auth-callback` redirect.
    (Needs a dev-client build + Supabase redirect-URL config; do it alongside the
    other native-auth work.)

### Phase 5 — Structural / long-horizon

18. **Converge the fetch paths** (C1): extract Today/Upcoming/Inbox predicates
    into `@do-done/shared` or move mobile onto `getToday`/`getUpcoming`; one
    definition of every view on both clients.
19. **Mobile agenda/calendar view** (A8): day + 3-day agenda with timed blocks;
    skip the 7-column grid.
20. **Project editing on mobile** (A9): edit/delete + icon in a project sheet;
    fix the "Create projects on the web app" empty state.
21. **Dark mode + `@do-done/ui` token adoption on mobile** (C3, D4).
22. **Decide the dormant modules** (D1): tag autocomplete via categorizer, weekly
    summary screen, or delete `scheduler.ts`/`categorizer.ts` from the engine.
23. **PowerSync/offline spike** (D6) and **iOS widgets** (D5) — unchanged from the
    roadmap; still the highest-ceiling, highest-effort bets.

### Working agreement to stop future drift

- Any `feat(web)` PR that touches a shared surface (modal, rows, display engine,
  quick-add, calendar) must either include the mobile change or open a paired
  `feat(mobile)` issue in the same milestone — the #86–#135 paired-PR pattern
  worked; the drift above is exactly the PRs that skipped it.
- New view predicates/formatters go in `@do-done/shared` from day one (see C1/B3
  for the cost of not doing this).
- Server-dependent features (calendar, future push) should ship the API route and
  the Bearer-token mobile consumer together, per the `/api/calendar/events` pattern.
