# Handoff — do-done

**For a new Claude Code instance picking up this project.** Read this end-to-end before doing anything; current state is non-trivial and there's work parked in multiple places.

Last updated: 2026-05-02 by Claude (Sonnet 4.5).

---

## TL;DR — where things live right now

- **`main`**: clean of pet work. Has uncommitted mobile changes parked in a stash (see "Stashed work" below).
- **`worktree-agent-a4c491c2921b01921`** (where this doc lives): the pet feature in 4 stacked commits. Worktree path: `<repo>/.claude/worktrees/agent-a4c491c2921b01921`.
- **No PR open. No merge has happened yet.** User wanted to review the pet feature before merging.
- **`docs/pet-feature.md`** is the source of truth for the implementation plan; this file is the source of truth for *current execution state*.

---

## In-flight: Pet feature ("Pip")

### Vision (one paragraph, do not relitigate)

do-done's "AI-native" framing means Claude (via MCP) drives most task management with the user, not just the user alone. To give web-app users a reason to come back when they're not in Claude, we added Pip — a procedural pet that gets fed by completed tasks. The hard creative problem was: if Claude completes tasks via MCP, who earns the gamification reward? **Resolution: Pip is a shared object between user and Claude.** Both can feed Pip, every event is tagged with `actor = 'user' | 'claude' | 'system'`, and the activity log is honest about who did the work. Claude isn't competing for credit; Claude is co-parenting Pip.

### Aesthetic decision (committed)

**Aesthetic E** — Apple Notes / Tweek soft. Yellow legal-pad cream background (`#fffbe6`), rounded everything, pastel stat bars (peach / mint / lavender), pastel-pink goal card, `ui-rounded` system font. Selected via `/design-shotgun` from a 7-variant comparison; comparison HTML at `/Users/brian/.gstack/projects/byebrianwong-do-done/designs/pip-pet-panel-20260501/comparison.html` if you want context on rejected directions.

The broader app aesthetic still defaults to Things-3-clean (indigo / Inter). **Pip lives in his own warm corner inside the existing chrome.** If you decide to migrate the whole app toward warm/Claude visual language later, the pet panel is your reference; don't drag the rest of the app there without an explicit instruction.

### Branch state — 4 commits

```
7c247ac feat(pet): MCP tools — get_pet_state, propose_pet_goal, accept_pet_goal, narrate_task_completion, get_pet_history
ff84c29 feat(pet): wire PetPanel into web app shell
7b5edf7 feat(pet): Pip procedural SVG + PetPanel UI + Storybook stories (aesthetic E)
f69c73a feat: pet feature foundations (migrations, schemas, decay math, PetsApi)
```

Each commit is independently reviewable. Together they implement plan days 1–8.

### What's done

#### Day 1–2: foundations (`f69c73a`)
- `supabase/migrations/20260501000001_create_pet_tables.sql` — `pets`, `pet_goals`, `pet_events`
- `supabase/migrations/20260501000002_create_pet_rls_policies.sql` — RLS via `auth.uid() = user_id`
- `supabase/migrations/20260501000003_create_pet_indexes.sql`
- `packages/shared/src/schemas.ts` — appended `Pet*`, `AppearanceSeed`, 7 new enums
- `packages/shared/src/pet-decay.ts` — pure decay/mood/feeding math
- `packages/shared/src/pet-decay.test.ts` — 28 vitest cases (all passing)
- `packages/shared/vitest.config.ts` — new (shared had none)
- `packages/api-client/src/pets.ts` — `PetsApi` class
- `packages/api-client/src/tasks.ts` — `update`/`complete` accept optional `actor`; lazy-imports `PetsApi` to feed Pip on `status → done`

#### Day 3: web UI (`7b5edf7`)
- `apps/web/src/components/pet/Pip.tsx` — pure procedural SVG. 6 body shapes × 4 eye styles × 6 mood overlays. No hooks, no `"use client"` — server-component-safe.
- `apps/web/src/components/pet/PetPanel.tsx` — pastel right-side panel UI, presentational only.
- `apps/web/src/components/pet/pip.stories.tsx` + `pet-panel.stories.tsx` — **17 stories** total covering each mood, body shape, eye style, hue, goal proposer, log shape, stat extreme.
- `apps/web/src/components/__stories__/mocks.ts` — extended with `makePet` / `makePetEvent` / `makePetGoal` / `makePetState` / `SAMPLE_PET_EVENTS` / `SAMPLE_APPEARANCE_SEED`.

#### Day 6–7: layout integration (`ff84c29`)
- `apps/web/src/app/(app)/layout.tsx` — main + new pet aside live in flex container; panel only renders for signed-in users, only at `xl:` (>1280px) widths. Below xl, layout reverts to today's full-width main.
- `apps/web/src/components/pet/PetPanelContainer.tsx` — client wrapper. Polls every 30s, refetches after goal accept/decline. **Fails gracefully** — if `PetsApi.getState` errors (migrations not applied, RLS rejects), the panel hides itself rather than breaking the whole page.
- `apps/web/src/lib/supabase/pets-client.ts` — `getClientPetsApi`, mirrors `getClientTasksApi` exactly.
- `packages/api-client/src/pets.ts` — added `declineGoal` (only updates rows where `status='open'` so re-clicks are safe no-ops).

#### Day 8: MCP tools (`7c247ac`)
- `apps/mcp/src/tools/pets.ts` (new) — 5 pet tools:
  - `get_pet_state` — markdown summary of stats / mood / level / goals / recent events
  - `propose_pet_goal` — Claude-authored suggestion, surfaces in panel for accept/decline
  - `accept_pet_goal` — converts open goal to real task on user's behalf
  - `narrate_task_completion` — writes `event_type='narrated'` with `actor='claude'`
  - `get_pet_history` — structured event log dump
- `apps/mcp/src/tools/index.ts` — `complete_task` and `update_task` now pass `actor='claude'` to `TasksApi`. **Honest credit attribution is now end-to-end.**
- `packages/api-client/src/pets.ts` — added `recordNarrative` for the narrated-event insertion path.

### What's left — day 10 (human-in-the-loop only)

1. Apply migrations: `supabase db push` from main checkout (not the worktree — env vars).
2. `pnpm --filter web dev` → visit `/inbox` at xl+ width → confirm Pip renders after the brief skeleton state, stats look right, recent activity log populates as you complete tasks.
3. Build the MCP server (already done in CI; rebuild if you change anything): `pnpm --filter @do-done/mcp build`. Wire into Claude Desktop config (see `apps/mcp/CLAUDE.md`):
   ```jsonc
   {
     "mcpServers": {
       "do-done": {
         "command": "node",
         "args": ["<repo>/.claude/worktrees/agent-a4c491c2921b01921/apps/mcp/dist/index.js"],
         "env": {
           "SUPABASE_URL": "...",
           "SUPABASE_SERVICE_ROLE_KEY": "...",
           "DO_DONE_USER_ID": "..."
         }
       }
     }
   }
   ```
4. Ask Claude (in Claude Desktop, not Claude Code) to do something real: *"Check on Pip and complete one of my p4 tasks for me, then narrate what you did."* Confirm the activity log shows ✨ Claude badge with the narrative.
5. Tune `packages/shared/src/pet-decay.ts` numbers based on feel. The constants and feeding rules are first-pass guesses — see `HUNGER_DECAY_PER_HOUR`, `applyTaskDeltas`, etc.

### Critical files (cheat sheet)

| Path | Purpose |
|---|---|
| `docs/pet-feature.md` | Implementation plan |
| `docs/HANDOFF.md` | This file |
| `packages/shared/src/pet-decay.ts` | Feeding rules + decay math (tune here) |
| `packages/shared/src/schemas.ts` | All Pet types + enums |
| `packages/api-client/src/pets.ts` | `PetsApi` |
| `packages/api-client/src/tasks.ts` | Where `actor` flows through to feeding |
| `apps/web/src/components/pet/Pip.tsx` | Procedural SVG |
| `apps/web/src/components/pet/PetPanel.tsx` | Panel UI |
| `apps/web/src/components/pet/PetPanelContainer.tsx` | Client wrapper, polls every 30s |
| `apps/web/src/app/(app)/layout.tsx` | Layout integration |
| `apps/mcp/src/tools/pets.ts` | 5 pet MCP tools |
| `apps/mcp/src/tools/index.ts` | `actor='claude'` wiring |
| `supabase/migrations/20260501*` | Pet tables, RLS, indexes |

### Open decisions worth re-litigating only with reason

These were judgment calls. **Don't relitigate without a concrete reason** — but if a real reason appears, this is where to push back.

1. **Mood priority order** when multiple thresholds fire: `sleeping > hungry > tired > sad > happy > content` (`packages/shared/src/pet-decay.ts`). Hunger wins because it's the dominant interaction loop. Reasonable, not the only valid ordering.
2. **Bonus stats for goal-derived tasks** — not implemented. Plan suggested ~+30% delta. No data yet.
3. **Mobile pet rendering** — not implemented; mobile sees no Pip. Plan calls this out as v2 explicitly.
4. **"Maybe later" / decline UI** — `PetsApi.declineGoal` is wired but no UI surfaces declined goals or lets the user re-propose. Probably fine; flag if users complain.
5. **Typography** — `ui-rounded` system font (SF Pro Rounded on macOS, falls through to system elsewhere). For consistent rendering across platforms, swap to `next/font` with Nunito — single-file change in `PetPanel.tsx`.
6. **Pip's name is hardcoded "Pip"** — the `pets.name` column allows rename but no UI exposes it. Plan suggested "let Claude propose 3 names at first sign-in based on task corpus" as v2.

---

## In-flight: Mobile projects work (parked in stash)

Earlier in the session, mobile project pages were partially wired up — but the user reverted them deliberately. Current state:

- **Stashed**: `git stash list` shows `wip: mobile projects + TaskEditModal + lock file`. Stash contains:
  - `apps/mobile/app/(tabs)/projects.tsx` — wired to `ProjectsApi.listWithCounts()` (real data, not mock)
  - `apps/mobile/components/TaskEditModal.tsx` — added a project picker chip row
  - `.claude/scheduled_tasks.lock` — just a lock file deletion
- **On main**: both files are at their pre-edit state (mock data, no project picker).
- **System hint flagged the post-stash state as intentional.** **Do not pop the stash unless the user explicitly asks.**

If the user asks to resume that work: `git stash pop` from main, then run `cd apps/mobile && npx tsc --noEmit` to confirm. The stashed work was typechecked clean before being stashed.

---

## Other artifacts you might encounter

### `/design-shotgun` comparison HTML
- `/Users/brian/.gstack/projects/byebrianwong-do-done/designs/pip-pet-panel-20260501/comparison.html` — 7 aesthetic variants for the pet panel. Aesthetic E was selected. Open in a browser if you want context on rejected directions.
- The gstack `design` binary requires an OpenAI API key that wasn't configured during this session — **fell back to handcrafted HTML/CSS sketches**. To enable AI-generated mockups in the future: `~/.claude/skills/gstack/design/dist/design setup`.

### gstack skills
- The user has `gstack` skills installed (`/ship`, `/qa`, `/review`, `/design-shotgun`, `/codex`, etc.). They are NOT proactive — only invoke when the user asks or when the explicit trigger words match.
- `gstack-config get proactive` was `true`, but `proactive` is the global flag; individual skills still have their own trigger logic.
- An upgrade is available (`UPGRADE_AVAILABLE 0.15.2.1 1.25.1.0`). User declined to engage during this session; don't push.

---

## Quirks worth knowing

- **No `.env.local` in the worktree.** `next build` and `next dev` need Supabase env vars. Run them from main checkout, or copy `.env.local` over.
- **Circular import workaround**: `packages/api-client/src/tasks.ts` lazy-imports `PetsApi` inside `update` to dodge a circular dep at module load. **Don't "fix" this without thinking** — it's intentional. The cleaner long-term path is moving feed-on-done into a Postgres trigger.
- **Web/mobile have no `typecheck` script** — they're not picked up by `pnpm typecheck` (turbo). Run `npx tsc --noEmit` directly from `apps/web` or `apps/mobile` to type-check those.
- **`packages/shared/tsconfig.json` excludes `*.test.ts`** from build output (necessary because `composite: true` was including tests in dist).
- **gitleaks pre-commit hook** runs on every commit on this branch — clean so far. Don't try to commit secrets; investigate any failure rather than `--no-verify`.
- **`apps/web/AGENTS.md` warns**: "This is NOT the Next.js you know" with a pointer to `node_modules/next/dist/docs/`. Read it before writing Next-specific code.

---

## Verify the worktree compiles cleanly

```bash
cd <repo>/.claude/worktrees/agent-a4c491c2921b01921

pnpm typecheck                                   # 9/9 should pass
pnpm --filter @do-done/shared test               # 28/28 should pass
pnpm --filter @do-done/api-client build          # rebuild after API changes
pnpm --filter @do-done/mcp build                 # rebuild MCP dist
cd apps/web && npx tsc --noEmit                  # web typecheck (not in turbo)
pnpm --filter web build-storybook                # exercises pet stories
```

To see Pip in Storybook:
```bash
pnpm --filter web storybook   # http://localhost:6006 → Pet/Pip and Pet/PetPanel
```

---

## Most likely next moves

In priority order:

1. **Apply migrations + run web dev + click around.** Confirm the panel actually looks like Storybook when fed real data. (~10 min)
2. **Wire MCP into Claude Desktop, do a real task with Claude.** Confirm the activity log shows ✨ for Claude completions. (~15 min)
3. **Tune `packages/shared/src/pet-decay.ts` numbers** based on feel.
4. **Open a PR or merge to main.** Branch is clean and stacked; simplest path is `git checkout main && git merge worktree-agent-a4c491c2921b01921`. (Mobile stash stays as-is.)
5. **Pop the mobile stash** if revisiting that work, or `git stash drop` to discard.

---

## If something breaks during day-10 verification

- **`PetPanelContainer` hides itself silently on error.** That's intentional — pet feature must never break the whole page. So failures are quiet. Check the browser network tab for failed `/rest/v1/pets` calls and Supabase logs.
- **Migrations not applied** is the most likely failure mode. Symptom: panel never appears (it's stuck in error-hidden state).
- **Auth not wired up** — `PetsApi.ensurePet` requires a userId; without auth it can't insert.
- **Claude Desktop tool list stale** — restart Claude Desktop after rebuilding `apps/mcp/dist/`.
- **Storybook stories show but production doesn't** — likely a server/client component issue. `Pip.tsx` has no `"use client"` (deliberate); `PetPanel.tsx` and `PetPanelContainer.tsx` do. Don't add `"use client"` to `Pip.tsx`.
