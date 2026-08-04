# Handoff — do-done

**For a Claude Code instance (or human) picking this project up cold.** The app is
live in production and there is open work that will bite you if you assume it's
finished. Read "Where things stand" before touching anything.

Last rewritten: **2026-08-04**, against `main` at PR #169. The previous version of
this file had drifted ~150 PRs out of date and confidently described deleted files
and shipped-as-missing features; it was rewritten from scratch against the actual
tree rather than edited.

## How to read this

Every factual claim below is marked:

- **[verified]** — checked against the repo or a live request during the rewrite.
- **[unverified]** — carried over from earlier notes, plausible but *not* checkable
  from a sandboxed container (Vercel/Supabase/DNS/EAS state, anything needing a
  logged-in CLI or a device). Treat as a lead, not a fact.

`CLAUDE.md` at the repo root is the authority on architecture, code style and
subsystem design. This file is about *execution state*: what's half-done, what's
unverified, and what will waste your afternoon. Where they overlap, CLAUDE.md wins.

---

## Orientation

DoDone — AI-native task manager, "Todoist replacement where an AI agent is a
first-class user". Live at **https://dodone.byebrianwong.com** (returns 200 and
redirects to `/login` — **[verified]** by request during the rewrite).

Turborepo + pnpm workspace, 8 packages **[verified]**:

```
apps/web       Next.js 16 (App Router) — also hosts the MCP HTTP endpoint at /api/mcp
apps/mobile    React Native / Expo (expo-router)
apps/mcp       thin stdio entry point for the MCP server
packages/shared       Zod schemas, constants, date/tz utils      (leaf)
packages/api-client   Supabase client + TasksApi/ProjectsApi/LocationsApi/PetsApi/…
packages/task-engine  NLP parser, focus algorithm, scheduler
packages/mcp-server   15 MCP tools + resources, shared by both transports
packages/ui           design tokens
supabase/             26 migrations, RLS policies
```

---

## Where things stand — 2026-08-04

### ⚠️ Location reminders have never run on a device

The most important thing on this page. Shipped in PRs #160/#162: a task can carry
reminders at saved places ("buy milk when I get to Tesco"). Geofence registration,
the dwell filter, the cooldown, the Android notification channel and all three
permission prompts are **unverified outside a type-checker** — none of it executes
in Expo Go or in CI. It needs an EAS dev-client or preview build on real hardware.
Treat it as *written*, not *working*.

Check in this order, because each step fails silently and "no notification"
otherwise has four indistinguishable causes:

1. **Does the permission flow complete?** Task editor → 📍 row → toggle "Arriving".
   Three surfaces should appear: foreground location, then (Android 11+) a
   **deep-link into system settings** where "Allow all the time" must be chosen by
   hand, then notifications. If that middle step reads as a dead end to a real
   user, that's a UX bug worth fixing — it's the step most likely to lose people.
2. **Does a region register?** `registerUserGeofences()` returns
   `{registered, skipped, error}` and **every caller currently discards it**. Log it.
   `error: 'permission_not_granted'` means step 1 silently didn't finish.
3. **Does a notification fire, and after the right delay?** Expect
   ~`GEOFENCE_DWELL_SECONDS` (90 s) *after* crossing the boundary, not on crossing.
   Nothing at all points at the Android channel or the POST_NOTIFICATIONS grant —
   neither existed before #162, so there is no prior art proving they work here.
4. **Does a drive-by stay silent?** The dwell filter is the design's whole claim.
   Drive past a saved place without stopping; nothing should arrive.

Tuning lives in `packages/shared/src/constants.ts`. If reminders land late or not
at all, **widen the radius before touching the dwell** — a typical urban fix is
20–60 m off, which is why the floor is 100 m. Design rationale for dwell, cooldown
and the region cap is in CLAUDE.md under "Location reminders".

**Related, and easy to misread as a regression:** location permission is no longer
requested at sign-in. It used to prompt for foreground *and* background on every
login, before checking whether the user had any saved places — which they never
did, since no UI existed to create one. `registerUserGeofences()` now never
prompts. `requestGeofencePermissions()` is the only prompting path and belongs in
the reminder-setup flow. **Don't "fix" the missing prompt by moving it back to
startup.**

### ⚠️ The Android quick-add widget has also never been confirmed on a phone

Same shape of problem, different feature. PR #154 rewrote the 1×1 widget's artwork
and keyboard behaviour; #161 refactored the chips into `QuickAddFields.tsx`. Every
install attempt so far ran an APK built from a stale checkout, which is
indistinguishable from a broken fix. Checklist, the `ImageWidget` fallback if
`SvgWidget` doesn't render, and the build gotchas that burned three install cycles:
[`docs/android-widget-verification.md`](android-widget-verification.md).

### Password-manager autofill: code shipped, config open

PR #159 shipped the field metadata on both login screens. App↔site association is
still unfinished — needs `ANDROID_CERT_FINGERPRINTS` + `APPLE_APP_ID` in the web
deployment and a fresh `eas build` for the iOS `associatedDomains` entitlement.
Until then 1Password fills the screens but treats the app as a separate vault item
from the website. Both `/.well-known` routes 404 while their env var is unset,
deliberately — a malformed association file is worse than a missing one, since
Apple and Google cache them. Checklist: [`docs/autofill-setup.md`](autofill-setup.md).

### Open, unowned

1. **Web has no awareness of locations at all.** A task with a location reminder
   renders as unscheduled on web — no indicator, no way to view or edit the link.
   Geofencing has no browser equivalent worth shipping, but read-only display of
   task↔location links is a real gap. `docs/mobile-web-parity-plan.md` §B2.
2. **`ACCESS_BACKGROUND_LOCATION` needs a Play Store justification.** It's now
   genuinely used, so it's no longer a spurious declaration — but it requires a
   written justification and a demo video at review. Budget time before the next
   production submission.
3. **`registerUserGeofences()`'s return value is discarded everywhere.**
   `skipped > 0` (places dropped for the platform region cap) surfaces only as a
   "Paused" label on the saved-places screen.
4. **`experiment/lower-hungry-threshold`** is pushed but was never PR'd
   **[verified]** — lowers `deriveMood`'s hungry trigger from `hunger < 30` to
   `<= 10`, plus boundary tests. Ship, tune, or delete it.
5. **Mobile E2E is manual-only.** `.github/workflows/mobile-e2e.yml` is
   `workflow_dispatch` only and needs repo secrets that don't exist yet
   (`EXPO_PUBLIC_SUPABASE_*`, `E2E_EMAIL`, `E2E_PASSWORD`) **[verified]**.
6. **~70 stale remote branches** **[verified]**, nearly all merged. Harmless, but
   `git ls-remote` output is unreadable. A prune would be kind.

---

## Running the repo

### Commands that actually work **[verified]**

```bash
pnpm install
./node_modules/.bin/turbo run test --force        # 9 tasks; 4 suites, 417 tests
./node_modules/.bin/turbo run typecheck --force   # 12 tasks
pnpm --filter web lint                            # 0 errors, 19 known warnings
pnpm --filter web dev                             # → localhost:3000
pnpm --filter mobile start                        # then a=android, i=ios
pnpm --filter web storybook                       # → localhost:6006
```

Current green baseline, so you can tell your breakage from inherited breakage:
**shared 167, task-engine 82, api-client 72, web 96.**

Two commands do *not* exist and their absence is intentional or historical:

- **`apps/mobile` has no `typecheck` script**, so `pnpm typecheck` skips it
  **[verified]**. Check it explicitly:
  `./node_modules/.bin/tsc -p apps/mobile/tsconfig.json --noEmit`.
  (`apps/web` *does* have one now — older notes claiming otherwise are wrong.)
- **Only `apps/web` has a `lint` script.** Mobile is unlinted; don't expect
  ESLint to catch anything there.

### Two very different environments

Older notes in this repo assume a local macOS machine with `gh`, `vercel`,
`supabase` and `eas` installed and authenticated. **A Claude Code web/remote
session has none of those** **[verified]**: `gh`, `vercel`, `supabase`, `eas` are
all absent; you get `git` (via an auth proxy), `node` 22, `pnpm` 10.33.0, and
GitHub access through MCP tools instead of the `gh` CLI.

Practical consequences in a remote session:

- GitHub operations go through `mcp__github__*` tools, not `gh`. Old notes about
  `gh api -X PUT .../merge` as a workaround are irrelevant there.
- You cannot inspect Vercel, Supabase or EAS state at all. Anything about
  deployments, applied migrations or build profiles is **[unverified]** by
  construction — say so rather than guessing.
- Outbound HTTPS goes through an egress proxy that terminates TLS, so
  `openssl s_client` against production returns *the proxy's* certificate, not the
  origin's. Certificate checks from a container are meaningless.

---

## Gotchas that are still true

Renumbered and re-verified; the old list had entries about deleted files.

1. **`IS_EXPO_GO` gates every native module.** Anything outside Expo Go's bundled
   runtime must be lazy-`require()`d inside `if (!IS_EXPO_GO)`. Reference impl:
   `apps/mobile/lib/geofencing.ts`. Helper: `@/lib/runtime`. Skipping this makes
   the app hang at splash in Expo Go with a bundler error that names the wrong file.
2. **Use `gen_random_uuid()`, never `uuid_generate_v4()`** in migrations. Supabase
   installs `uuid-ossp` into the `extensions` schema, off the default search_path,
   so unqualified calls fail at apply time.
3. **React hooks in shared packages need `"use client"` on line 1.**
   `packages/api-client/src/use-autosave-task.ts` has it. The package's index is
   also imported by server components, so without the directive the *production*
   Next build fails with "You're importing a module that depends on `useEffect`
   into a React Server Component". TypeScript preserves the prologue into `dist/`.
4. **Date views must match both date columns and the full open-status set.**
   Scheduling writes `when_date`; legacy tasks have `due_date`. Queries in
   `packages/api-client/src/tasks.ts` use
   `.not("status","in","(done,cancelled,archived)")` **[verified]** — note
   `cancelled`, which older notes omit; `archived` is a legacy value migrated to
   `cancelled` and kept in the exclusion list defensively. Use the exported
   `taskDate(t)` (`when_date ?? due_date ?? null`) for display. Narrowing to one
   column or to `IN ('todo','in_progress')` was the single most common bug of the
   redesign series.
5. **Keep the whole workspace on one vitest.** `@testing-library/jest-dom` is a
   direct dependent of no package here, so its `/vitest` entry resolves `vitest`
   through its own store path and extends whatever copy it lands on. With web on 4
   and packages on 3, it extended a copy no test used and all 26
   `toBeInTheDocument()` assertions died with `Invalid Chai property`. Fixed in
   #167 by aligning on 4.1.5 *and* pinning `@types/node` to `^20.19.39` across the
   packages — one version isn't enough, because pnpm peer-splits a single version
   into two physical copies, and two copies are two module instances.
   `apps/mobile` stays on `^25` deliberately; it has no vitest, so it can't split.
6. **`pnpm test -- --force` sends `--force` to vitest, not turbo**, and fails
   confusingly. Call the binary: `./node_modules/.bin/turbo run test --force`.
7. **`ls node_modules/.pnpm | grep '^vitest@'` over-reports on a dirty tree.**
   pnpm leaves stale version directories that nothing links to. Only
   `rm -rf node_modules && pnpm install --frozen-lockfile` gives a trustworthy count
   (should be exactly 1).
8. **Rebuild `packages/*` before `apps/mcp`.** The MCP entry point compiles against
   `@do-done/api-client/dist`; a stale one gives
   `error TS2305: Module '@do-done/api-client' has no exported member '…'`.
   `pnpm --filter "./packages/*" build` then `pnpm --filter @do-done/mcp build`.
   Stdio MCP servers are cached for the session — restart Claude Code after.
   *(The tools themselves live in `packages/mcp-server/src/tools/`, not
   `apps/mcp/src/tools/`, which no longer exists **[verified]**.)*
9. **`apps/web/vercel.json` drives the build, and its oddities are load-bearing**
   **[unverified — can't reach Vercel from a container]**: `cd ../..` because
   Vercel's Root Directory is `apps/web` but pnpm must install from the workspace
   root; `corepack enable` because Vercel's bundled pnpm has a workspace-deps bug;
   `framework: nextjs` to keep ISR/edge handling despite the command overrides.
10. **Storybook is web-only.** No React Native Storybook. Mobile changes can only
    be seen by running the app.
11. **Claude Desktop strips `mcpServers` from `claude_desktop_config.json`.** Use
    `claude mcp add -s user …` (writes `~/.claude.json`). Symptom of falling for
    it: `[LocalMcpServerManager] Closing all (0 servers)` in the Desktop logs.

---

## Production **[unverified — nothing below is checkable from a container]**

| | Value |
|---|---|
| Production URL | https://dodone.byebrianwong.com — live, 200 **[verified]** |
| Vercel project | `byebrianwongs-projects/do-done-web` (`prj_3SyBcR1BcpJDuq33mIjr3R4mjpjl`) |
| Supabase project | `qvglgxixiwoolsxnmsag` (`do-done`, West US — North California) |
| GitHub repo | `byebrianwong/do-done` |

Vercel Root Directory is `apps/web`; `main` auto-deploys to production.

**Correction to the old notes:** they recorded an SSL cert expiring *2 Aug 2026*,
which has now passed. Production still serves 200, so it evidently renewed —
Vercel manages this automatically. The cert ID and expiry in the old table were
stale and are dropped rather than carried forward.

**Preview deploys may show red on PRs.** `NEXT_PUBLIC_SUPABASE_*` were scoped to
Production, Development, and Preview *on a single branch*, so other branches' preview
builds fail. Production is unaffected. Treat Vercel red on a PR as cosmetic unless
production is also failing.

Env vars the app expects (from `.env.example` **[verified]**): `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `POWERSYNC_URL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CALENDAR_CRON_SECRET`, `APP_URL`,
`DO_DONE_USER_ID`, `MCP_BEARER_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `APPLE_APP_ID`, `ANDROID_CERT_FINGERPRINTS`.
Mobile additionally needs `EXPO_PUBLIC_WEB_APP_URL` — **unset means mobile
silently hides calendar events entirely**, with no error.

### DNS **[unverified]**

`dodone.byebrianwong.com` is a `CNAME → cname.vercel-dns.com.` on Porkbun.
A wildcard `CNAME *.byebrianwong.com → uixie.porkbun.com` still catches every
undefined subdomain and dumps it on a parking page — recommended for removal
repeatedly, still there as far as anyone knows.

---

## Database

26 migrations in `supabase/migrations/`, latest `20260724000001_project_sort_order_backfill`
**[verified]**. Core tables: `tasks`, `projects`, `locations`, `task_locations`,
`calendar_sync`, `user_preferences`, plus pet tables. UUID PKs, `user_id` for RLS,
RLS on everything.

Task status enum is **`inbox | later | not_started | next | in_progress | done |
cancelled`** **[verified]**. `todo` → `not_started` and `archived` → `cancelled`
were migrated; `packages/api-client/src/tasks.ts` still normalises the legacy values
on read.

The Supabase CLI was linked on the original dev machine and `db push` worked there
**[unverified]**. Early `20260412*` migrations predate CLI linkage and were marked
applied with `supabase migration repair --status applied …` rather than re-run.

---

## CI **[verified]**

| Workflow | Trigger | Notes |
|---|---|---|
| `chromatic.yml` | push + PR to `main` | Visual regression. Needs `CHROMATIC_PROJECT_TOKEN`. Baseline approvals happen in the Chromatic UI and can sit unapproved for a long time. |
| `eas-update.yml` | push to `main`, paths `apps/mobile/**` | OTA update publish. |
| `mobile-e2e.yml` | `workflow_dispatch` **only** | Maestro on an Android emulator. Disabled on PRs until its secrets exist and it's run green a few times manually. |

---

## Critical files **[all verified present]**

| Path | Purpose |
|---|---|
| `CLAUDE.md` | Architecture + subsystem design. Read before this file. |
| `apps/web/vercel.json` | Deploy config (lives here because of Vercel's Root Directory) |
| `apps/mobile/lib/runtime.ts` | `IS_EXPO_GO` |
| `apps/mobile/lib/geofencing.ts` | Geofence engine + the native-guard reference pattern |
| `apps/mobile/lib/location-queries.ts` | Location query hooks + mutations; every write resyncs geofences |
| `apps/mobile/components/LocationReminderSheet.tsx` | The only surface in the app that prompts for location |
| `apps/mobile/app/locations.tsx` | Saved-places management |
| `apps/mobile/components/QuickAddFields.tsx` | Shared chips for all three mobile capture surfaces |
| `apps/mobile/app/_layout.tsx` | Root nav; widget + geofence registration on sign-in |
| `apps/web/src/components/task-edit-modal-v2.tsx` | V2 task modal (web) |
| `apps/mobile/components/TaskEditModalV2.tsx` | V2 task modal (mobile) |
| `packages/api-client/src/tasks.ts` | `getToday`/`getUpcoming` date logic, `taskDate()` |
| `packages/api-client/src/use-autosave-task.ts` | Shared autosave hook — **has `"use client"`, don't remove** |
| `packages/shared/src/constants.ts` | Geofence dwell/cooldown/radius + focus scoring constants |
| `packages/shared/src/pet-decay.ts` | Pet decay/mood/feeding math |
| `packages/mcp-server/src/tools/` | All 15 MCP tools |
| `apps/web/src/app/api/mcp/route.ts` | MCP over Streamable HTTP |
| `apps/web/vitest.setup.ts` | jest-dom registration — see gotcha 5 before touching |

Reference docs: [`autofill-setup.md`](autofill-setup.md),
[`android-widget-verification.md`](android-widget-verification.md),
[`mobile-web-parity-plan.md`](mobile-web-parity-plan.md),
[`mobile-roadmap.md`](mobile-roadmap.md), [`pet-feature.md`](pet-feature.md),
[`task-input-design/`](task-input-design/).

---

## Corrections to the pre-2026-08 notes

If you find an older copy of this file, or notes quoting it, these were wrong:

- **Subtasks UI and recurrence editing were listed as unbuilt.** Both ship in the
  V2 modal on web and mobile **[verified]** — `SubtasksSection` and `RepeatRow`.
- **`apps/mcp/src/tools/pets.ts`** doesn't exist. MCP tools consolidated into
  `packages/mcp-server`, which serves both the stdio and HTTP transports.
- **`apps/web` has no typecheck script** — it does.
- **Test counts** (83/52/17) were roughly a third of current (167/82/72, plus web 96).
- **"MCP has 13 tools"** — 15.
- **`status NOT IN (done, archived)`** — the set is `(done, cancelled, archived)`.
- **Deleted files still cited as current**: `TaskEditModal.tsx` (mobile),
  `task-edit-dialog.tsx` (web). Removed in PR #17.
- **PR-by-PR archaeology for #1–#21** has been dropped. `git log` is the record and
  doesn't go stale.

---

## Troubleshooting

- **Web build fails with "useEffect into a React Server Component"** → a hook landed
  in a shared package without `"use client"` on line 1. Gotcha 3.
- **All web tests fail with `Invalid Chai property: toBeInTheDocument`** → vitest
  copies diverged. Gotcha 5, then 7 to confirm the fix.
- **App spins forever in Expo Go** → a native module imported without the
  `IS_EXPO_GO` guard. Gotcha 1.
- **Metro `Got unexpected undefined` after a checkout** → HMR graph corrupted. Kill
  metro, restart with `--clear`; pressing `r` won't help.
- **Phone can't load the bundle** → different WiFi subnet / firewall / client
  isolation. `pnpm --filter mobile add -D @expo/ngrok` then
  `pnpm --filter mobile start --tunnel`.
- **DevBanner shows the wrong branch** → the checkout didn't switch (often because
  the branch is checked out in another worktree). `git status`.
- **"I scheduled a task but Today/Upcoming is empty"** → the date queries got
  narrowed to one column or the wrong status set. Gotcha 4.
- **"Upcoming" misses a far-future task** → `getUpcoming(days)` is bounded to
  `today..today+days`, default 30.
- **Trigger throws "cannot nest deeper than 3 levels"** → intentional subtask depth
  cap. The UI should hide "+ add subtask" at depth 2; if it doesn't, that's the bug.
- **Mobile shows no calendar events at all** → `EXPO_PUBLIC_WEB_APP_URL` unset. It
  fails silently by design.
- **Pet MCP tools missing in Claude Code** → stale `apps/mcp/dist/`. Gotcha 8.
