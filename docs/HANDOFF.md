# Handoff — do-done

**For a new Claude Code instance picking up this project.** Read this end-to-end before doing anything; the project is live in production and there's open work that needs care.

Last updated: 2026-05-06 by Claude (Sonnet 4.5).

---

## TL;DR — where things stand right now

- **`main`** has the pet feature merged. HEAD is `b98c7cd` (merge commit of PR #1).
- **App is LIVE** at https://dodone.byebrianwong.com. Vercel auto-deploys main as production. SSL via Let's Encrypt, valid through 2 Aug 2026.
- **PR #2 is open** (`feat/mobile-projects-real-data`) — mobile projects screen wired to real data + project picker in TaskEditModal + Expo Go compatibility patch. Needs rebase against main (it was branched before the pet merge) before it can land.
- **Mobile testing in progress** via Expo Go on phone. EAS dev client build never done — flagged as "next step" once user finishes web side.

This doc is the source of truth for *current execution state*. The pet feature implementation plan is in [`docs/pet-feature.md`](pet-feature.md).

---

## What's live in production

### URLs and IDs

| | Value |
|---|---|
| Production URL | https://dodone.byebrianwong.com |
| Vercel preview alias | https://do-done-web-byebrianwongs-projects.vercel.app |
| Vercel project | `byebrianwongs-projects/do-done-web` (id `prj_3SyBcR1BcpJDuq33mIjr3R4mjpjl`) |
| Supabase project | `qvglgxixiwoolsxnmsag` (`do-done`, West US — North California) |
| GitHub repo | byebrianwong/do-done |
| GitHub PR #1 | merged — pet feature |
| GitHub PR #2 | open draft — mobile projects + Expo Go compat |
| SSL cert | `cert_a8hWxl7Q5rHsJXDU3Rr5JV6s` — Let's Encrypt, expires 2 Aug 2026 |

### DNS (Porkbun, but using Cloudflare DNS infrastructure)

- `dodone.byebrianwong.com` — `CNAME → cname.vercel-dns.com.`
- `byebrianwong.com` — apex `ALIAS → 25a8e3ff….vercel-dns-017.com.` (different project — user's portfolio)
- `secondguess.byebrianwong.com` — `CNAME → b896b68936d10f2d.vercel-dns-017.com.` (yet another project)
- **Risky leftover**: `CNAME *.byebrianwong.com → uixie.porkbun.com` catches all undefined subdomains and dumps them on Porkbun parking. Should be removed (advised earlier; user hasn't done it yet).
- **Cosmetic leftovers**: two `_acme-challenge.byebrianwong.com` TXT records from past Let's Encrypt validations. Not harmful; can delete.

### Vercel env vars (set via CLI, encrypted)

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set for Production, Development, and Preview-on-`worktree-agent-a4c491c2921b01921`-branch. **The Preview scope was set per-branch, not all-branches** (see "Quirks" below). For PR #2 to deploy preview successfully you may need to add Preview vars for `feat/mobile-projects-real-data` too.

### Deploy config

Vercel UI Root Directory is `apps/web`. The vercel.json that drives builds lives at [`apps/web/vercel.json`](../apps/web/vercel.json). It does:
- `installCommand: cd ../.. && corepack enable && pnpm install --frozen-lockfile`
- `buildCommand: cd ../.. && corepack enable && pnpm turbo run build --filter=web`
- `outputDirectory: .next`
- `framework: nextjs`

Three things matter here and you should know why:
1. **`cd ../..`** — Vercel runs commands from `apps/web` (the configured Root Directory), but pnpm install needs to run at the workspace root or it can't resolve workspace deps.
2. **`corepack enable`** — without this, Vercel uses its hardcoded older pnpm 10.x which has a workspace-deps bug. corepack reads `packageManager: pnpm@10.33.0` from package.json and uses our exact version.
3. **`framework: nextjs`** — keeps Vercel's ISR / edge handling on even though we override commands.

---

## Database

### Supabase CLI is now linked

`supabase` CLI v2.95.4 is installed (via brew) and authenticated. Project `do-done` (`qvglgxixiwoolsxnmsag`) is linked locally. `supabase db push` works.

### Migration history is now tracked properly

The original migrations (`20260412*`) had been applied via the dashboard before CLI linkage, so they weren't in the `supabase_migrations.schema_migrations` table. We ran:

```bash
supabase migration repair --status applied 20260412000001 20260412000002 20260412000003
```

to mark them as applied without re-running. Then `supabase db push` applied the new pet migrations cleanly.

### Pet migrations gotcha — uuid_generate_v4 → gen_random_uuid

The pet migrations originally used `uuid_generate_v4()`. Supabase installs the `uuid-ossp` extension into the `extensions` schema (not in default search_path), so unqualified calls fail. Fixed by switching to `gen_random_uuid()` (built-in to Postgres 13+, no extension needed). See [`supabase/migrations/20260501000001_create_pet_tables.sql`](../supabase/migrations/20260501000001_create_pet_tables.sql).

**Use `gen_random_uuid()` for any new tables.** Don't reach for `uuid_generate_v4()`.

---

## PR #2 — open draft, needs rebase

Branch: `feat/mobile-projects-real-data`. Three commits on top of pre-pet main (`19ac733`):

```
fec34ce  fix(mobile): make app Expo-Go-tolerant (lazy-load native-only modules)
0101206  docs(claude.md): fix mobile dev command (it's `start`, not `dev`)
35f732f  feat(mobile): wire projects screen to real data + add project picker
```

### What each commit does

**`35f732f` — main feature (146 +/19−)**
- `apps/mobile/app/(tabs)/projects.tsx` — replace `MOCK_PROJECTS` array with `ProjectsApi.listWithCounts()` from `@do-done/api-client`. Real Supabase data, color dots, optional icon glyph, "X open · Y done" counts, pull-to-refresh, empty state.
- `apps/mobile/components/TaskEditModal.tsx` — add a "Project" chip row between Priority and Due Date. None chip + one chip per project. Persists `project_id` on save.

**`0101206` — CLAUDE.md fix (1 line)**
The doc said `pnpm --filter mobile dev` but mobile only has `start`/`android`/`ios`/`web` scripts. Fixed to `pnpm --filter mobile start`.

**`fec34ce` — Expo Go compatibility (4 files)**
The app couldn't load in Expo Go because three native-only modules were imported statically:
- `expo-speech-recognition` — third-party native module
- `expo-notifications` — removed from Expo Go in SDK 53
- `react-native-android-widget` — custom Java/Kotlin code

**Pattern**: new helper [`apps/mobile/lib/runtime.ts`](../apps/mobile/lib/runtime.ts) exports `IS_EXPO_GO` (uses `Constants.appOwnership === 'expo'`). Each problematic file lazy-`require()`s its native dep only when not in Expo Go, with the JS surface stubbed to no-ops in Expo Go. Mic button on QuickAddBar hides; geofence registration becomes a no-op; Android widget handler skipped. Full functionality preserved in dev clients and standalone builds.

**Use this pattern for any future native-only feature.** Don't add `import x from 'native-only-module'` at the top of a file that runs at app boot.

### Rebase needed

PR #2 was branched from `19ac733` (pre-pet-merge). Main has 13 new commits. To merge cleanly:

```bash
git checkout feat/mobile-projects-real-data
git rebase origin/main
# resolve any CLAUDE.md conflict (main now has different content than what PR #2 modified)
git push --force-with-lease origin feat/mobile-projects-real-data
```

**The rebase will conflict on `CLAUDE.md`** because main has a newer version (with mobile section etc.) and PR #2 changed a different line. Resolve by keeping main's content + applying PR #2's `start` fix.

After rebase, the diff is small and clean. Mark ready and merge.

### Manual testing status

User has been running `pnpm --filter mobile start` and loading the app in **Expo Go** on their phone. After commit `fec34ce`, the bundle should succeed. As of last check, user was about to test the projects + picker changes. If they confirm visually, PR #2 is green for merge.

---

## Critical gotchas (read these)

### 1. Don't push to `main` directly

PR #1 was merged via `gh pr merge`. The same pattern works for #2 once it's rebased. Direct pushes to main aren't blocked but go through the PR flow for review trail.

### 2. Force-push is denied to branches with open PRs

The harness will block `git push --force-with-lease` if there's an open PR on the branch. Use a regular commit instead, or rebase locally + only force-push after PR is closed.

### 3. Local main can drift from origin

If you check out main locally and there's a diff against origin (untracked files in tracked paths, etc.), `git pull --ff-only` aborts. Symptom: "Please move or remove them before you merge." Cause: untracked `docs/`, `.claude/worktrees/`, `supabase/.temp/` directories that conflict with committed files. Fix: `rm -rf docs/` (or whichever conflicts), then pull.

### 4. Vercel CLI auth lives in macOS Application Support

`~/Library/Application Support/com.vercel.cli/auth.json`. The user has run `vercel login` so the CLI is authenticated for this session. If `vercel` commands prompt for login, the auth file may have rotated.

### 5. Supabase CLI auth is separate

`supabase login` was done; tokens live in `~/.supabase/`. Same caveat — if it prompts again, it's expired.

### 6. Vercel's preview env vars need a branch

Adding env vars to `preview` scope without specifying a branch hits an interactive prompt the CLI doesn't accept in agent mode. Workaround: add per-branch with `vercel env add NAME preview <branch> --value <value> --yes`, OR add via Vercel UI's "All Preview Branches" toggle.

### 7. `IS_EXPO_GO` is the gate for native modules in apps/mobile

Any new module that's not in Expo Go's bundled runtime must be lazy-loaded inside `if (!IS_EXPO_GO)`. The pattern is in [`apps/mobile/lib/geofencing.ts`](../apps/mobile/lib/geofencing.ts). Import the helper from `@/lib/runtime`.

### 8. Web/mobile have no `typecheck` script in turbo

`pnpm typecheck` only runs typecheck on `packages/*` and `apps/mcp` (the ones that have a `typecheck` script in package.json). For `apps/web` and `apps/mobile`, run `npx tsc --noEmit` directly from the app directory.

### 9. The wildcard CNAME is dangerous

`CNAME *.byebrianwong.com → uixie.porkbun.com` swallows typos and undefined subdomains, sending them to a parking page. Recommend removing it — the user agreed in principle but hasn't done it yet.

### 10. Storybook is web-only

There's no React Native Storybook setup. Pet UI (`Pip`, `PetPanel`) has Storybook coverage. Mobile screens do not. To see mobile changes visually, run the actual app via Expo Go or an EAS dev client.

---

## Critical files (cheat sheet)

| Path | Purpose |
|---|---|
| `docs/HANDOFF.md` | This file |
| `docs/pet-feature.md` | Pet feature implementation plan |
| `apps/web/vercel.json` | Vercel deploy config (lives in apps/web because of Vercel UI Root Directory) |
| `apps/mobile/lib/runtime.ts` | `IS_EXPO_GO` helper |
| `apps/mobile/lib/geofencing.ts` | Reference impl of native-module guard pattern |
| `apps/mobile/components/QuickAddBar.tsx` | Same pattern — voice input lazy-load |
| `apps/mobile/app/_layout.tsx` | Same pattern — Android widget lazy-load |
| `packages/shared/src/pet-decay.ts` | Pure pet decay/mood/feeding math (Finch model — no overdue penalty) |
| `packages/api-client/src/pets.ts` | `PetsApi` |
| `apps/web/src/components/pet/Pip.tsx` | Procedural SVG renderer |
| `apps/web/src/components/pet/PetPanel.tsx` | Right-side panel UI |
| `apps/web/src/app/(app)/layout.tsx` | Layout integration of PetPanel |
| `apps/mcp/src/tools/pets.ts` | 5 pet MCP tools |
| `supabase/migrations/20260501*` | Pet tables, RLS, indexes (use `gen_random_uuid()`) |
| `.github/workflows/chromatic.yml` | Visual regression CI (works — passes on push to PR + main) |

---

## Open work + likely next moves

In priority order:

1. **Rebase + merge PR #2** once user confirms the mobile changes work in Expo Go.
2. **EAS dev client build** — never done. Path to native feature testing (voice, geofencing, widgets). Steps: `npm i -g eas-cli` → `eas login` → `cd apps/mobile && eas init` → `eas build --profile development --platform android`. ~15 min cloud build, free tier. The placeholder `"REPLACE_WITH_EAS_PROJECT_ID"` in `apps/mobile/app.config.ts` gets replaced after `eas init`.
3. **Apply MCP server to Claude Desktop** — never done. Build via `pnpm --filter @do-done/mcp build`, point Claude Desktop config at `apps/mcp/dist/index.js`, set env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DO_DONE_USER_ID). Then ask Claude to complete a task and watch ✨ Claude show in Pip's activity log.
4. **DNS cleanups** — remove the wildcard CNAME, add CAA records (`letsencrypt.org`), add DMARC, enable DNSSEC. Optional, none blocking.
5. **Tune pet feeding deltas** in `packages/shared/src/pet-decay.ts` based on real usage. Current numbers are first-pass; one round of "no overdue penalty" tuning was already done.

## Verify the repo compiles cleanly

```bash
pnpm install
pnpm typecheck                                   # 9/9 should pass
pnpm --filter @do-done/shared test               # 29/29 should pass
cd apps/web && npx tsc --noEmit                  # web typecheck
cd apps/mobile && npx tsc --noEmit               # mobile typecheck
pnpm --filter web build-storybook                # exercises pet stories
```

## How to run things

```bash
# Web dev (needs apps/web/.env.local with NEXT_PUBLIC_* Supabase vars)
pnpm --filter web dev                            # → http://localhost:3000

# Mobile dev (needs Expo Go on phone, or EAS dev client for native features)
pnpm --filter mobile start                       # then `a` for Android, `i` for iOS

# Storybook (web only)
pnpm --filter web storybook                      # → http://localhost:6006

# Vercel CLI (already linked from this repo)
vercel list do-done-web                          # see deployments
vercel inspect <url> --logs                      # debug failures
vercel env ls                                    # see env vars

# Supabase CLI (already linked)
supabase migration list                          # see applied migrations
supabase db push                                 # apply new migrations
```

## If something breaks

- **Vercel build fails on `pnpm install`**: probably the corepack/lockfile pattern broke. Check `apps/web/vercel.json` — install command must `cd ../..` and `corepack enable`.
- **App spins forever on Expo Go**: a new native module got imported without the `IS_EXPO_GO` guard. Read recent diffs and apply the lazy-`require()` pattern.
- **HTTPS is "not secure"** for a new subdomain: Vercel didn't auto-provision SSL. Run `vercel certs issue <domain>` to trigger manually.
- **`PetPanelContainer` hides silently**: it suppresses errors by design (panel is non-critical chrome). Check browser network tab for failed `/rest/v1/pets` calls.
- **Mobile build fails on import**: probably hitting an Expo Go limit. Check the metro bundler output for "Cannot find native module".
