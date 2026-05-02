-- do-done: Pet ("Pip") tables
-- Three tables to power the gamification layer: pets, pet_goals, pet_events.
-- Stats decay-on-read: stored values are "value at last_seen_at"; current value
-- is computed in the API layer using the elapsed time since last_seen_at.

-- ── Pets ───────────────────────────────────────────────

create table pets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Pip' check (char_length(name) between 1 and 30),
  birthed_at timestamptz not null default now(),

  -- Stats are stored as "value at last_seen_at"; current value is computed
  -- on read with decay applied via the API layer.
  hunger_at_last_seen integer not null default 80
    check (hunger_at_last_seen between 0 and 100),
  happiness_at_last_seen integer not null default 80
    check (happiness_at_last_seen between 0 and 100),
  energy_at_last_seen integer not null default 80
    check (energy_at_last_seen between 0 and 100),
  last_seen_at timestamptz not null default now(),

  -- Cached procedural render seed; recomputed when project/tag corpus shifts.
  appearance_seed jsonb not null default '{}'::jsonb,

  level integer not null default 1 check (level >= 1),
  xp integer not null default 0 check (xp >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Pet Goals ──────────────────────────────────────────

create table pet_goals (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  description text not null check (char_length(description) between 1 and 200),
  proposed_by text not null check (proposed_by in ('claude', 'pet', 'user')),
  status text not null default 'open'
    check (status in ('open', 'accepted', 'completed', 'declined', 'expired')),
  task_id uuid references tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ── Pet Events ─────────────────────────────────────────

create table pet_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null
    check (event_type in (
      'fed',
      'goal_proposed',
      'goal_accepted',
      'goal_completed',
      'evolved',
      'sad',
      'narrated'
    )),
  task_id uuid references tasks(id) on delete set null,
  actor text not null check (actor in ('user', 'claude', 'system')),
  delta_hunger integer not null default 0,
  delta_happiness integer not null default 0,
  delta_energy integer not null default 0,
  delta_xp integer not null default 0,
  narrative text,
  created_at timestamptz not null default now()
);

-- ── Auto-update updated_at trigger ─────────────────────

create trigger pets_updated_at
  before update on pets
  for each row execute function update_updated_at();
