# Handoff — do-done

**For a new Claude Code instance picking up this project.** Read this end-to-end before doing anything; the project is live in production and there's open work that needs care.

Last updated: 2026-05-10 by Claude (Opus 4.7, 1M context).

---

## TL;DR — where things stand right now

- **`main`** has pet + mobile real-data + mobile keyboard fixes merged. HEAD is `3b4889b` (squash merge of PR #3).
- **App is LIVE** at https://dodone.byebrianwong.com. Vercel auto-deploys main as production. SSL via Let's Encrypt, valid through 2 Aug 2026.
- **PR #2 merged** (squash `82b9b99`, 2026-05-10) — mobile projects screen wired to real data + project picker in TaskEditModal + Expo Go compatibility patch. Verified on real Android via Expo Go before merge.
- **PR #3 merged** (squash `3b4889b`, 2026-05-10) — mobile keyboard avoidance (QuickAddBar lifts above keyboard, login/edit modal fix Android `KAV behavior`), tappable Today focus cards, in-app `DevBanner` showing branch + sha while testing.
- **MCP wired into Claude Code** at user scope via `claude mcp add` — not via `claude_desktop_config.json` (see gotcha #11 below). Verified by calling `mcp__do-done__get_focus_tasks` end-to-end.
- **Mobile testing path** stays Expo Go for now. EAS dev client build still not done — flagged as "next step" before testing widgets, voice input, or geofencing (none of which run in Expo Go).

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
| GitHub PR #2 | merged 2026-05-10 (squash `82b9b99`) — mobile projects + Expo Go compat |
| GitHub PR #3 | merged 2026-05-10 (squash `3b4889b`) — mobile keyboard fixes + DevBanner + scrollable login |
| SSL cert | `cert_a8hWxl7Q5rHsJXDU3Rr5JV6s` — Let's Encrypt, expires 2 Aug 2026 |

### DNS (Porkbun, but using Cloudflare DNS infrastructure)

- `dodone.byebrianwong.com` — `CNAME → cname.vercel-dns.com.`
- `byebrianwong.com` — apex `ALIAS → 25a8e3ff….vercel-dns-017.com.` (different project — user's portfolio)
- `secondguess.byebrianwong.com` — `CNAME → b896b68936d10f2d.vercel-dns-017.com.` (yet another project)
- **Risky leftover**: `CNAME *.byebrianwong.com → uixie.porkbun.com` catches all undefined subdomains and dumps them on Porkbun parking. Should be removed (advised earlier; user hasn't done it yet).
- **Cosmetic leftovers**: two `_acme-challenge.byebrianwong.com` TXT records from past Let's Encrypt validations. Not harmful; can delete.

### Vercel env vars (set via CLI, encrypted)

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set for Production, Development, and Preview-on-`worktree-agent-a4c491c2921b01921`-branch. **The Preview scope is per-branch, not all-branches.** Practical effect: every other branch's Preview deploy fails the build, which shows as a red ❌ Vercel check on the PR. **Production deploys are unaffected** — both PR #2 and PR #3 went green for Production after merge. Treat the Vercel red on a PR as cosmetic unless you also see Production failing in `vercel inspect`.

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

## PR #2 — merged 2026-05-10 (squash `82b9b99`)

Mobile projects screen on real Supabase data + project picker in TaskEditModal + Expo Go compatibility patch. Three original commits, rebased onto post-pet main, then squash-merged. Rebase had no `CLAUDE.md` conflict in the end (the lines that worried us didn't actually overlap).

**Key files now on main**:
- [`apps/mobile/app/(tabs)/projects.tsx`](../apps/mobile/app/(tabs)/projects.tsx) — `ProjectsApi.listWithCounts()` for the projects screen.
- [`apps/mobile/components/TaskEditModal.tsx`](../apps/mobile/components/TaskEditModal.tsx) — project chip row.
- [`apps/mobile/lib/runtime.ts`](../apps/mobile/lib/runtime.ts) — `IS_EXPO_GO` helper. **Use this pattern for any future native-only feature.** Each native-dep file lazy-`require()`s and stubs out the API in Expo Go.

Affected files that no-op in Expo Go: `expo-speech-recognition` (mic in `QuickAddBar`), `expo-notifications` (removed from Expo Go in SDK 53), `react-native-android-widget` (custom JNI). Geofence registration also no-ops; Android widget handler skipped.

## PR #3 — merged 2026-05-10 (squash `3b4889b`)

Mobile keyboard avoidance + tappable Today focus cards + in-app DevBanner + scrollable login + `@types/node` for `app.config.ts`.

**What changed**:
- [`apps/mobile/components/QuickAddBar.tsx`](../apps/mobile/components/QuickAddBar.tsx) — subscribes to `Keyboard.addListener('keyboardWillShow'/'keyboardDidShow')` and lifts the absolute-positioned bar by `kbHeight + 8`. Without this, `edgeToEdgeEnabled: true` in `app.config.ts` made Android skip its default `adjustResize`, leaving the bar (and TextInput) behind the keyboard.
- [`apps/mobile/components/TaskEditModal.tsx`](../apps/mobile/components/TaskEditModal.tsx) and [`apps/mobile/app/(auth)/login.tsx`](../apps/mobile/app/(auth)/login.tsx) — `KeyboardAvoidingView` had `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`, which is a no-op on Android. Switched to `behavior="padding"` on both platforms.
- [`apps/mobile/app/(auth)/login.tsx`](../apps/mobile/app/(auth)/login.tsx) — wrapped the centered card in a `ScrollView` with `flexGrow: 1, justifyContent: 'center'` so the Sign-in button stays reachable when a tall keyboard shrinks the centered area.
- [`apps/mobile/app/(tabs)/index.tsx`](../apps/mobile/app/(tabs)/index.tsx) — focus cards in the Today tab were bare `<View>` with no `onPress` — couldn't tap to edit. Now wrapped in `<Pressable>` calling `setEditing(task)` (mirrors `TaskItem`).
- New: [`apps/mobile/components/DevBanner.tsx`](../apps/mobile/components/DevBanner.tsx) — small dark pill at the top of every screen, only renders when `__DEV__` is true. Reads `Constants.expoConfig.extra.git` (set in `app.config.ts` via `execSync('git rev-parse ...')` at metro start). Lets a tester confirm at a glance which branch + sha is running, since `pnpm start` from a different checkout silently serves stale code.
- [`apps/mobile/app.config.ts`](../apps/mobile/app.config.ts) — `extra.git = gitInfo()`. Added `@types/node` so the `child_process` import typechecks.

**No follow-ups outstanding** for either PR. Both verified manually on a real Android phone via Expo Go.

---

## MCP server in Claude Code

`do-done` MCP is registered at **user scope** via `claude mcp add` so it's available in every Claude Code session anywhere on the machine.

```bash
claude mcp add -s user do-done \
  -e SUPABASE_URL=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  -e DO_DONE_USER_ID=... \
  -- node /Users/brian/Projects/do-done/apps/mcp/dist/index.js
```

Verify: `claude mcp list` should show `do-done: ... ✓ Connected`. End-to-end test: ask Claude to *"List my open do-done tasks"* — should call `mcp__do-done__list_tasks` and return real Supabase data. Completing a task via Claude tags `actor='claude'` so Pip's activity log on the live web app shows ✨ Claude.

**13 tools** when fully loaded: 8 task tools (`list_tasks`, `create_task`, `update_task`, `complete_task`, `search_tasks`, `get_focus_tasks`, `get_weekly_summary`, `organize_tasks`) + 5 pet tools (`get_pet_state`, `propose_pet_goal`, `accept_pet_goal`, `narrate_task_completion`, `get_pet_history`).

If pet tools are missing from a fresh session, the dist is stale — see gotcha #12 below.

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

### 11. `claude_desktop_config.json` `mcpServers` does NOT work in this Claude Desktop

The current Claude Desktop (`com.anthropic.claudefordesktop`, see `Claude Helper` process args) reads `~/Library/Application Support/Claude/claude_desktop_config.json` only for its own preferences schema (`preferences.*`) and **strips unknown top-level keys** when it rewrites the file. Adding `mcpServers` there appears to work, but Claude Desktop's app prefs sync overwrites it and Claude Code never sees it. Logs at `~/Library/Logs/Claude/main.log` will show `[LocalMcpServerManager] Closing all (0 servers)` if you've fallen for this.

Use `claude mcp add -s user ...` instead (writes to `~/.claude.json`). This is what's wired up now — see "MCP server in Claude Code" above.

### 12. MCP `dist/` must be rebuilt after pet feature changes (or any `@do-done/api-client` change)

`apps/mcp/src/tools/index.ts` imports `registerPetTools` from `./pets.js`, which imports `PetsApi` from `@do-done/api-client`. If you build `@do-done/mcp` against a stale `@do-done/api-client/dist`, you get `error TS2305: Module '@do-done/api-client' has no exported member 'PetsApi'`. Order matters:

```bash
pnpm --filter "./packages/*" build      # rebuild api-client first
pnpm --filter @do-done/mcp build        # then mcp
```

Symptom in Claude Code: only 8 tools instead of 13 — pet tools missing. The MCP server you'd registered points at the old `dist/index.js` which never required `pets.js`. Rebuild + restart Claude Code (stdio MCPs cache for the session lifetime).

### 13. Force-push needs explicit per-action user approval

The harness blocks `git push --force-with-lease` to a branch with an open PR even when the action was approved at plan time — it requires fresh confirmation at the moment of execution. Workaround: ask the user, push, continue. PR merges via `gh pr merge` are similarly subject to harness checks. **`gh api -X PUT /repos/.../pulls/N/merge` works as a pure-API path** when local-git paths are blocked (e.g., Xcode license unaccepted, see #14).

### 14. Local `git` may need `sudo xcodebuild -license accept`

After macOS or Xcode updates, every `git` invocation (and anything that shells out to git, including `gh pr merge --delete-branch`) errors with `You have not agreed to the Xcode license agreements`. Fix: `sudo xcodebuild -license accept`. Until then, use `gh api` paths for GitHub ops (no local git).

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
| `apps/mobile/components/DevBanner.tsx` | In-app branch + sha pill (testing aid; `__DEV__`-only) |
| `apps/mobile/app.config.ts` | Adds `extra.git = gitInfo()` so DevBanner can read it via `Constants.expoConfig.extra` |
| `supabase/migrations/20260501*` | Pet tables, RLS, indexes (use `gen_random_uuid()`) |
| `.github/workflows/chromatic.yml` | Visual regression CI. Triggers on `push: branches: [main]` and `pull_request: branches: [main]` — i.e. doesn't fire for branches without an open PR |
| `~/.claude.json` | Where `claude mcp add -s user` writes — the actual MCP config Claude Code reads |

---

## Open work + likely next moves

In priority order:

1. **EAS dev client build** — still not done. Required to test widgets (`react-native-android-widget`), voice input (`expo-speech-recognition`), geofencing, push notifications — none of which run in Expo Go. Steps: `npm i -g eas-cli` → `eas login` → `cd apps/mobile && eas init` (replaces `"REPLACE_WITH_EAS_PROJECT_ID"` in `app.config.ts`) → `eas build --profile development --platform android`. ~15 min cloud build, free tier. After install on phone, run `pnpm --filter mobile start` and the dev client picks up metro automatically.
2. **Wire the `dodone://quick-add` deep link** — `widgets/QuickAddWidget.tsx` opens the app with `dodone://quick-add` but `app/_layout.tsx` has no `Linking` handler. Currently tapping the widget just lands on Today. Add a `Linking.addEventListener('url', ...)` + `Linking.getInitialURL()` in the root layout that focuses the QuickAddBar input or routes to a `/quick-add` modal.
3. **DNS cleanups** — remove the wildcard CNAME, add CAA records (`letsencrypt.org`), add DMARC, enable DNSSEC. Optional, none blocking.
4. **Tune pet feeding deltas** in `packages/shared/src/pet-decay.ts` based on real usage. Current numbers are first-pass; one round of "no overdue penalty" tuning was already done.
5. **Accept Chromatic baselines** for the mobile-related Storybook builds — PR #2 + PR #3 each flagged 30–40 visual diffs that need explicit acceptance in the Chromatic UI before subsequent builds compare against the new baseline.

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
- **Phone shows "Failed to download remote update"** after scanning QR: phone can't reach the Mac on `192.168.50.x` (different WiFi subnet, Mac firewall blocking metro's port, or router client isolation). Fall back to tunnel: `pnpm --filter mobile add -D @expo/ngrok` (one-time, the Expo CLI looks in `node_modules/`, not the global install) then `pnpm --filter mobile start --tunnel`.
- **Metro shows `Got unexpected undefined` after a `git checkout`**: HMR dependency graph corrupted. Kill metro, restart with `--clear`. Pressing `r` won't help — the bundler is in a bad state, not just stale.
- **DevBanner says `main · <sha>` when you expected your fix branch**: your local checkout didn't actually switch — `git checkout fix/...` may have failed silently (e.g. the branch is already checked out in a worktree). Run `git status` to confirm.
- **Pet MCP tools missing in Claude Code**: stale `apps/mcp/dist/`. See gotcha #12 — rebuild `packages/*` first, then `apps/mcp`, then restart Claude Code.
