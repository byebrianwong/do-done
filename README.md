# DoDone

AI-native task management — a Todoist replacement where an AI agent is a first-class user. Turborepo monorepo with a Next.js web app, a React Native / Expo mobile app, a custom MCP server, and shared TypeScript packages on Supabase.

Live in production at **https://dodone.byebrianwong.com**.

> **The brand is DoDone** (closed compound, medial capital) in all UI, docs, and marketing. The lowercase hyphenated `do-done` is reserved for internal identifiers only (repo name, npm scope `@do-done/*`, Expo slug, deep-link scheme).

---

## Read this first — what this README is for

**This README is written primarily for AI coding agents** (Claude Code and friends) so they can get enough context to complete real tasks — most often *adding a new feature* — without re-deriving the architecture every time. It is also perfectly readable by humans, but where there's a tension, it optimizes for "an agent landing here cold can find the right file and not break an invariant."

If you are an agent, read this file, then the two companion docs below, before editing anything:

| Doc | What it gives you |
|---|---|
| [`README.md`](README.md) (this file) | The map: architecture, where features live, how a change flows through the layers, the rules you must not break. |
| [`CLAUDE.md`](CLAUDE.md) | Canonical project instructions — code style, naming, commands, design system, native-build setup. **These override defaults; follow them exactly.** |
| [`AGENTS.md`](AGENTS.md) | Agent path ownership + coordination rules for parallel work (backend / web / mobile lanes). |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | Living execution state — what's shipped, production URLs/IDs, gotchas, open work. The source of truth for *current* status. |

The rest of `docs/` holds feature design records (task-input redesign, pet feature, mobile roadmap).

---

## The mental model (read before adding a feature)

DoDone is a **layered monorepo**. A feature almost never lives in one place — it flows outward from a shared core to one or more surfaces. The dependency arrows only point one way; respect them and the build stays clean.

```
            ┌─────────────────────────────────────────────┐
            │  packages/shared   (leaf — Zod schemas,      │
            │  types, constants, pure utils, display)      │
            └─────────────────────────────────────────────┘
                 ▲            ▲              ▲
                 │            │              │
   ┌─────────────┴──┐  ┌──────┴───────┐  ┌──┴──────────────┐
   │ api-client     │  │ task-engine  │  │ ui              │
   │ Supabase +     │  │ NLP parser,  │  │ design tokens   │
   │ TasksApi etc.  │  │ focus algo   │  │ (colors/spacing)│
   └────────┬───────┘  └──────┬───────┘  └──┬──────────────┘
            │                 │             │
   ┌────────┴─────────────────┴─────────────┴────────────┐
   │  surfaces (apps)                                     │
   │  apps/web  ·  apps/mobile  ·  apps/mcp               │
   └─────────────────────────────────────────────────────┘
                 ▲
                 │ all read/write the same data
   ┌─────────────┴───────────────────────────────────────┐
   │  supabase/  — Postgres + RLS + migrations + edge fns │
   └─────────────────────────────────────────────────────┘
```

**The golden rules** (also in `CLAUDE.md` / `AGENTS.md`, repeated here because breaking one breaks the build or the data model):

1. **Types and schemas live in `@do-done/shared` only.** Every entity is a Zod schema with its type inferred via `z.infer<>`. Never redefine a `Task`/`Project` shape in an app or another package.
2. **All data access goes through `@do-done/api-client`.** Apps never call Supabase tables directly. Every API method returns `{ data, error }` and never throws — always check `.error`.
3. **Design comes from `@do-done/ui`.** No hardcoded colors or spacing; pull tokens from `theme.ts` (accent is indigo-500 `#6366f1`, 4px spacing grid, Inter).
4. **Strict TypeScript, no `any`.** ES modules — local imports use the `.js` extension even from `.ts` files.
5. **Stay in your lane** when coordinating (see `AGENTS.md`): backend = `packages/*` + `apps/mcp` + `supabase`; web = `apps/web` + `packages/ui`; mobile = `apps/mobile`.

---

## Repo layout

```
apps/
  web/      Next.js 16 (App Router, Tailwind, Storybook + Chromatic)
  mobile/   React Native / Expo 54 (expo-router, native widgets/geofencing/voice)
  mcp/      MCP server — exposes tasks to Claude Code over stdio
packages/
  shared/        @do-done/shared       Zod schemas, types, constants, utils (leaf, no workspace deps)
  api-client/    @do-done/api-client   Supabase clients + TasksApi/ProjectsApi/LocationsApi/PetsApi/UserPrefsApi
  task-engine/   @do-done/task-engine  NLP parser, focus algorithm, scheduler, categorizer, recurrence
  ui/            @do-done/ui           Design tokens (theme.ts)
supabase/
  migrations/    Timestamped SQL — tables, RLS policies, indexes
docs/            Design records + HANDOFF.md (current state)
.github/workflows/  chromatic.yml · eas-update.yml (mobile OTA) · mobile-e2e.yml
```

### What each package exports (quick reference)

- **`@do-done/shared`** — `TaskSchema`, `ProjectSchema`, `LocationSchema`, `UserPreferencesSchema`, … plus enums (`TaskStatus`, `TaskPriority`, `WhenBucket`); constants (`PRIORITY_CONFIG`, `STATUS_CONFIG`, `FOCUS_SCORES`); utils (`todayLocalISO()`, `isOverdue()`, `formatWhenTime()`); and the sort/group/filter `display` engine shared by web + mobile.
- **`@do-done/api-client`** — `createAnonClient()` (apps, RLS-scoped) / `createServiceClient()` (MCP, service role + explicit userId); `TasksApi` (`list`, `getById`, `create`, `update`, `complete`, `getInbox`, `getToday`, `getUpcoming`, `search`), `ProjectsApi`, `LocationsApi`, `PetsApi`, `UserPrefsApi`; the `useAutoSaveTask()` React hook.
- **`@do-done/task-engine`** — `parseTaskInput()` (free text → structured task: `p1`, `#size`, `/today`, `/Project`, NLP dates), `generateFocusList()`, `generateWeeklySummary()`, `scheduleTasks()`, `detectRecurrence()`.
- **`@do-done/ui`** — `colors`, `spacing`, `typography`, `radius` design tokens (`as const`).

---

## Getting started

Prereqs: Node 20+, `pnpm` (repo pins `pnpm@10.33.0` via `packageManager`).

```bash
pnpm install                 # install the whole workspace
cp .env.example .env.local   # then fill in Supabase + Google keys (see below)

pnpm dev                     # all dev servers (turbo)
pnpm --filter web dev        # web only  → http://localhost:3000
pnpm --filter mobile start   # Expo dev server (then a=android, i=ios)
pnpm --filter @do-done/mcp build   # build the MCP server

pnpm build                   # build everything
pnpm typecheck               # type-check everything  ← run before you call a change done
pnpm test                    # run all tests
pnpm lint
```

**Environment variables** (`.env.example` → `.env.local`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `POWERSYNC_URL`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (Calendar OAuth), and `DO_DONE_USER_ID` for the MCP server.

---

## Adding a feature — the cross-cutting playbook

Most features touch several layers. Work **inside-out** so each layer compiles before the next depends on it. Skip the layers your feature doesn't need.

### 1. Data & schema (`packages/shared` + `supabase/`)
- New field or entity? Add/extend the Zod schema in `packages/shared/src/schemas.ts` and any enums/constants in `constants.ts`. The inferred type flows everywhere automatically.
- Needs a column/table? Add a **new** timestamped migration in `supabase/migrations/` (e.g. `20260616000001_add_thing.sql`) — never edit an applied one. All tables use UUID PKs + `user_id` and are protected by **RLS**; add matching policies. Follow the pattern in existing `*_create_rls_policies.sql`.

### 2. Data access (`packages/api-client`)
- Add the query method to the relevant API class (`tasks.ts`, `projects.ts`, …). Return `{ data, error }`; never throw. Add a `*.test.ts` beside it (vitest).

### 3. Domain logic (`packages/task-engine`, optional)
- Pure, side-effect-free logic (parsing, scoring, scheduling) goes here so web, mobile, and MCP all share one implementation.

### 4. Surfaces — implement on each app the feature targets

**Web — `apps/web`** (Next.js App Router)
- Routes live in `src/app/(app)/<name>/page.tsx` — these are **server components** that fetch data via the server Supabase helpers in `src/lib/supabase/` and pass props down.
- UI lives in `src/components/<name>-view.tsx` (client components); mutations call `@do-done/api-client`. Add a `*.stories.tsx` and, where it makes sense, a `*.test.tsx`.
- Auth: protected pages sit under the `(app)` route group; login/OAuth is under `(auth)` + `src/app/auth/`.

**Mobile — `apps/mobile`** (Expo Router)
- Screens are file-based under `app/` (`(tabs)/` for the tab bar). Components in `components/`.
- Data fetching uses **TanStack Query** hooks in `lib/task-queries.ts` (not server components). Auth via `lib/auth-context.tsx`.
- Native features: Android widgets in `widgets/`, geofencing in `lib/geofencing.ts`, config plugins in `plugins/`. Native changes need a fresh EAS build (see `CLAUDE.md`); JS-only changes ship over-the-air.

**Agent / MCP — `apps/mcp`**
- Expose the capability to Claude as a tool in `src/tools/index.ts` (tasks) or `src/tools/pets.ts`, or a resource in `src/resources/index.ts`. Tool input schemas reuse the `@do-done/shared` enums so they never drift. Handlers return `{ content: [{ type: "text", text }] }`, serialize errors as text, log via `console.error` (stdout is the protocol channel), and tag writes with `actor: "claude"`. Rebuild + restart the MCP after changes.

### 5. Verify (see next section), then ship
Run `pnpm typecheck` and the relevant tests. For multi-phase work the maintainer prefers **stacked PRs per phase** over one growing branch.

---

## Verifying your work

The web app is **auth-gated**, so the live preview is a login wall — you usually can't screenshot a feature through the running app. Verify components instead via:

- **Storybook** (`pnpm --filter web storybook`, port 6006) — components render with mocked Supabase. ~18 stories cover the main surfaces (TaskItem, TaskEditModalV2, TaskForm, WeekView, TodayView, SidebarNav, ScheduleButton, the pet panel, …). Add a story for new components.
- **Vitest** unit/component tests across packages and apps (`pnpm test`, or `pnpm --filter <pkg> test`).
- **Chromatic** runs on every push/PR for visual regressions. `main` is gated by a **"UI Tests" check** — pending visual diffs block merge until baselines are accepted in the Chromatic UI.
- **Mobile** — component tests in `components/__tests__/`; Maestro E2E flows run in CI (`mobile-e2e.yml`). Native modules (widgets, geofencing, voice) only run in a custom EAS dev client, not Expo Go.

---

## Data model (high level)

Supabase Postgres, every table UUID-keyed with `user_id` + RLS. Core tables: `tasks`, `projects`, `locations`, `task_locations`, `calendar_sync`, `user_preferences`, plus pet tables (`pet_state`, goals, events).

A few `tasks` concepts worth knowing before you touch scheduling:

- **`when_date` vs `due_date`** — `when_date` is "I plan to *do* this on day X" (a soft do-date, with optional `when_time`); `due_date` is a hard deadline. They are independent.
- **`when_bucket`** — a fuzzy window (`today` / `tomorrow` / `this_week` / `next_week` / `later` / `someday`), mutually exclusive with `when_date`.
- **Subtasks** — `parent_task_id` + `depth`; a task tree max 3 levels deep, enforced by a DB trigger.
- **Status** — `inbox` / `not_started` / `next` / `in_progress` / `done` / `cancelled`; priorities `p1`–`p4`. Dates are stored as local-timezone `YYYY-MM-DD` strings, so use the `*LocalISO` helpers in `@do-done/shared`, not raw UTC.

---

## Gotchas

- **Dates are local, not UTC.** "Today" depends on the user's timezone — always go through `todayLocalISO()` / `addDaysLocalISO()` and the timezone helpers in `@do-done/shared`. Several past bugs were UTC drift.
- **`.js` import suffix** is required on relative imports even in TypeScript (ES modules).
- **MCP is stdio.** `console.log` corrupts the protocol — log to `console.error`. Rebuild (`pnpm --filter @do-done/mcp build`) and restart the client after changing MCP source.
- **Mobile OTA vs native.** Merging JS/asset changes auto-publishes an EAS Update to the preview channel; native changes (new modules, plugin/app.config changes, SDK bumps) require a fresh `eas build` + reinstall.
- **Don't edit applied migrations.** Add a new one.

---

## License

Private project. Not currently licensed for redistribution.
