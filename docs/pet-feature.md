# Pet feature ("Pip") — v1 design

## Why this exists

The product is positioned as AI-native (Claude drives task management via MCP, web app and Claude stay in sync). For users who *do* open the web app, we want a gamification layer that makes them want to add and complete tasks — not because the queue demands it, but because something is alive on the other side of the screen.

The hard creative problem: **if Claude completes tasks on the user's behalf via MCP, who earns the gamification reward?** If the pet thrives silently from agent-completed tasks, the reward feels hollow. If only human-completed tasks count, the AI integration becomes a punishment.

The resolution shaping every decision below: **Pip is a shared object between user and Claude.** Both can feed Pip. Every event records who did the work. Claude isn't competing for credit; Claude is co-parenting.

## Scope of v1

**In:**
- One pet per user, procedurally rendered (no art budget).
- Three stats with decay-on-read: hunger, happiness, energy.
- Task completion feeds Pip; properties of the task drive which stats move.
- Pet has 1–3 active goals at any time, proposed by Claude from task patterns.
- Right-side panel on web app showing Pip + stats + current goal.
- New MCP tools so Claude can read pet state and propose goals.
- Honest activity log: every event tagged `actor: 'user' | 'claude'`.

**Out (parking lot for v2+):**
- Multiple pets / project-bound creatures.
- Streak mechanics with pet evolution.
- Social features (friends seeing your pet, trades).
- Mobile pet UI (tab on mobile shows web stats only, no rendering).
- Time-of-day rituals (morning triage / evening tuck-in).
- Pet "death" or any punishment — explicitly never.

## Data model

Three new tables. Conventions match existing migrations: UUID PKs, `user_id` FK to `auth.users`, RLS via `auth.uid() = user_id`, `created_at` / `updated_at` defaults.

```sql
-- supabase/migrations/<timestamp>_create_pet_tables.sql

create table pets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Pip' check (char_length(name) between 1 and 30),
  birthed_at timestamptz not null default now(),

  -- Stats are stored as "value at last_seen_at"; current value is computed on read with decay.
  hunger_at_last_seen integer not null default 80 check (hunger_at_last_seen between 0 and 100),
  happiness_at_last_seen integer not null default 80 check (happiness_at_last_seen between 0 and 100),
  energy_at_last_seen integer not null default 80 check (energy_at_last_seen between 0 and 100),
  last_seen_at timestamptz not null default now(),

  -- Cached procedural render seed; recomputed when project/tag corpus shifts noticeably.
  appearance_seed jsonb not null default '{}'::jsonb,

  level integer not null default 1 check (level >= 1),
  xp integer not null default 0 check (xp >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pet_goals (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  description text not null check (char_length(description) between 1 and 200),
  proposed_by text not null check (proposed_by in ('claude','pet','user')),
  status text not null default 'open'
    check (status in ('open','accepted','completed','declined','expired')),
  task_id uuid references tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table pet_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null
    check (event_type in ('fed','goal_proposed','goal_accepted','goal_completed','evolved','sad','narrated')),
  task_id uuid references tasks(id) on delete set null,
  actor text not null check (actor in ('user','claude','system')),
  delta_hunger integer not null default 0,
  delta_happiness integer not null default 0,
  delta_energy integer not null default 0,
  delta_xp integer not null default 0,
  narrative text,
  created_at timestamptz not null default now()
);

create index pet_events_user_created_idx on pet_events(user_id, created_at desc);
create index pet_goals_user_status_idx on pet_goals(user_id, status);
```

RLS policies follow the existing pattern in [supabase/migrations/20260412000002_create_rls_policies.sql](../supabase/migrations/20260412000002_create_rls_policies.sql) — `for select/insert/update/delete to authenticated using (user_id = auth.uid())` per table.

### Decay-on-read

No cron job. Stats decay over time; the database stores `*_at_last_seen` plus `last_seen_at`. On any read:

```ts
const hoursSince = (now - last_seen_at) / 3600_000;
const hunger = clamp(0, 100, hunger_at_last_seen - HUNGER_DECAY_PER_HOUR * hoursSince);
// HUNGER_DECAY_PER_HOUR = 2 (full → empty over 50h of neglect)
```

When a task is completed, the API recomputes current stats, applies the delta from the task, and writes back `*_at_last_seen` + `last_seen_at = now()`. Atomic, RLS-safe, no background work.

### Feeding rules (initial; tune later)

| Task property | Stat affected | Delta |
|---|---|---|
| Any task done | hunger | +15 |
| Done before due date | happiness | +10 |
| Quick task (<15min duration) | energy | +8 |
| p1 done | hunger +20, happiness +15, xp +50 |
| p4 done | hunger +5, xp +5 |
| Overdue task done | hunger +15, happiness −5 (still net positive) |
| Task done by Claude (`actor='claude'`) | same deltas, narrative tagged "Claude fed Pip while you were busy" |

XP thresholds drive level. Level affects nothing functional in v1 (no evolution yet) — it's a number Claude can talk about.

## Procedural rendering

SVG component rendered client-side from `appearance_seed` + current stats. No image generation, no API calls.

**Seed derivation** (recomputed weekly server-side, or on-demand if seed is empty):

```ts
type AppearanceSeed = {
  bodyHue: number;        // 0–360, derived from most-used project's color
  bodyShape: 'blob' | 'sprout' | 'orb' | 'tuft' | 'wisp' | 'pebble';  // hash of most common tag
  eyeStyle: 'dot' | 'sparkle' | 'sleepy' | 'wide';                    // birthed_at day-of-year mod 4
  accessories: string[];  // unlocked at xp milestones: 100, 500, 2000, 10000
};
```

**Mood states** (driven by current computed stats):
- `happy` — hunger+happiness+energy >= 200
- `content` — default
- `tired` — energy < 30
- `hungry` — hunger < 30
- `sad` — happiness < 30 (but never angry — no negative reinforcement)
- `sleeping` — last user activity > 8h AND it's nighttime in user's tz

The SVG component is one file: `apps/web/src/components/pet/Pip.tsx`. Six mood overlays on top of one seeded body. Soft animation (breathing loop, blink every 4–8s) via Framer Motion or CSS keyframes — no new dep needed if we use CSS.

Total v1 art surface: 6 body shapes × 4 eye styles × ~5 accessories × infinite hue = thousands of unique pets. One developer-week of SVG path tweaking.

## New MCP tools

Pattern-matched to [apps/mcp/src/tools/index.ts](../apps/mcp/src/tools/index.ts) — same `server.tool(name, description, schema, handler)` registration, same `{ content: [{ type: "text", text }] }` return shape. All tools instantiate a new `PetsApi(supabase, userId)` (added to `@do-done/api-client`).

| Tool | Description | Input | Returns |
|---|---|---|---|
| `get_pet_state` | Read Pip's current stats, mood, goals, recent narrative beats | none | text summary + JSON |
| `propose_pet_goal` | Generate a goal from task patterns; queues for user accept | `{ description: string }` | confirmation |
| `accept_pet_goal` | Convert an open goal into a real task | `{ goal_id: uuid }` | created task |
| `narrate_task_completion` | When Claude completes a task on user's behalf, record the narrative beat (writes pet_event with actor='claude') | `{ task_id, narrative }` | event id |
| `get_pet_history` | Recent pet_events for context — what Claude has done lately, what user has done | `{ limit?: number }` | event log |

Feeding is **implicit**: it happens server-side inside `TasksApi.update` when status transitions to `done`. No tool exposes raw stat manipulation — that would let Claude cheat for the user.

## API client

New file `packages/api-client/src/pets.ts` exporting `PetsApi`. Methods:
- `getState()` → current decayed stats + mood + appearance + active goals + recent events
- `feedFromTask(taskId, actor)` → applies deltas, writes pet_event, returns updated state. **Called automatically from `TasksApi.update` when status flips to `done`.** No public web caller.
- `proposeGoal(description, proposedBy)` → inserts pet_goal
- `acceptGoal(goalId)` → creates real task via TasksApi, links via task_id, marks accepted
- `getHistory(limit)` → recent pet_events
- `regenerateAppearanceSeed()` → recomputes from current task corpus

`TasksApi.update` gains a side effect: when status transitions to `done`, call `pets.feedFromTask`. Pass `actor='user'` from web app, `actor='claude'` from MCP server. The actor field is the honesty mechanic — don't elide it.

## Shared schemas

Add to [packages/shared/src/schemas.ts](../packages/shared/src/schemas.ts):
- `PetSchema`, `PetGoalSchema`, `PetEventSchema`
- `PetMoodEnum`, `PetGoalStatusEnum`, `PetEventActorEnum`
- `AppearanceSeedSchema`
- `CreatePetGoalInput`

## Web integration

[apps/web/src/app/(app)/layout.tsx](../apps/web/src/app/(app)/layout.tsx) currently has left sidebar + main. Wrap main + new right panel in a flex container:

```tsx
<div className="ml-64 flex">
  <main className="flex-1 p-8">{children}</main>
  <aside className="w-80 border-l border-gray-200 p-6 hidden xl:block">
    <PetPanel />
  </aside>
</div>
```

`xl:block` keeps it off small screens; below xl, Pip moves to a Cmd+P modal (one keystroke, doesn't fight the layout). No mobile rendering in v1.

`PetPanel` shows:
1. The Pip SVG (animated)
2. Three stat bars (hunger, happiness, energy)
3. Active goal card (if any) with accept/decline
4. "Recent" — last 3 events with actor badges (you / Claude)

Data: poll `PetsApi.getState()` every 30s + refetch on TasksApi mutations (event bus or just `useSWR` mutate). No realtime — the project doesn't use it elsewhere and v1 doesn't need it.

## Critical files

**New:**
- `supabase/migrations/<ts>_create_pet_tables.sql`
- `supabase/migrations/<ts>_create_pet_rls_policies.sql`
- `packages/shared/src/schemas.ts` (add Pet*, AppearanceSeed types — same file, append)
- `packages/api-client/src/pets.ts` (new `PetsApi`)
- `packages/api-client/src/index.ts` (export `PetsApi`)
- `apps/mcp/src/tools/index.ts` (add 5 pet tools)
- `apps/web/src/components/pet/Pip.tsx` (procedural SVG)
- `apps/web/src/components/pet/PetPanel.tsx` (panel UI)
- `apps/web/src/components/pet/pip.stories.tsx` (Storybook for all moods)
- `apps/web/src/lib/pet-decay.ts` (pure decay math, shared with mobile later)

**Modified:**
- `apps/web/src/app/(app)/layout.tsx` (insert `<aside>` for PetPanel)
- `packages/api-client/src/tasks.ts` (`update` calls `pets.feedFromTask` on status→done)
- `apps/mcp/src/tools/index.ts` (call `narrate_task_completion`-equivalent on agent-completed tasks)

## Verification

1. **Storybook** — `Pip.stories.tsx` exports stories for each of the 6 moods + 4 stat extremes. Visual review confirms procedural variation is legible and the moods are distinct.
2. **Migration round-trip** — `supabase db reset` + `supabase db push`; insert a test user; confirm RLS prevents cross-user reads.
3. **Decay math unit tests** — `apps/web/src/lib/pet-decay.test.ts` covers: zero hours, 1h, 24h, 100h, clamps to [0,100], integer rounding.
4. **End-to-end task → pet flow**:
   - Sign in on web → PetPanel renders with default stats.
   - Complete a p1 task → hunger jumps, recent events shows "you fed Pip (+20 hunger from p1)".
   - Have Claude complete a task via MCP → recent events shows "Claude fed Pip" with actor badge.
   - Wait (or fast-forward `last_seen_at`) → stats decay correctly on next read.
5. **Goal acceptance flow** — Claude calls `propose_pet_goal` → goal appears in panel → user accepts → real task is created and linked → completing the task closes the goal.
6. **Aesthetic decision check** — once Pip renders in Storybook, decide whether the broader app aesthetic shifts toward warm/Claude-style (per design directions doc). Pip's home dictates the aesthetic of its room.

## Open decisions before building

1. **Where does Pip live on mobile?** v1 says "nowhere visible." Counter: mobile is half the audience and gamification probably retains better there. Cheapest mobile option is a tab badge that shows hunger emoji.
2. **Naming** — "Pip" is a placeholder. Could let the user rename. Suggest letting Claude propose 3 names at first sign-in based on task corpus ("Sage" for someone with lots of learning tasks, etc.).
3. **Does completing a goal-derived task give bonus stats?** Yes seems obvious, say +30% delta. Confirm.
4. **Aesthetic commit** — does Pip force the whole app toward warm/Claude visual language, or stay in its corner with current Things-3-clean? This is the big question and Storybook is the place to answer it.

## Effort estimate

Two weeks single-dev, conservatively:
- Days 1–2: migrations, schemas, PetsApi, decay math + tests
- Days 3–5: Pip.tsx procedural rendering + Storybook stories
- Days 6–7: PetPanel + layout integration + feeding side effect in TasksApi
- Days 8–9: MCP tools + Claude narration plumbing
- Day 10: End-to-end test, polish, aesthetic decision
