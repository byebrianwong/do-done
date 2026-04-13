-- do-done: Core database schema
-- All tables use UUID primary keys and have RLS enabled

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ── Projects ───────────────────────────────────────────

create table projects (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  color text not null default '#6366f1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon text check (char_length(icon) <= 10),
  parent_project_id uuid references projects(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Locations ──────────────────────────────────────────

create table locations (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_meters double precision not null default 100 check (radius_meters > 0),
  address text check (char_length(address) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Tasks ──────────────────────────────────────────────

create table tasks (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  description text check (char_length(description) <= 5000),
  status text not null default 'inbox'
    check (status in ('inbox', 'todo', 'in_progress', 'done', 'archived')),
  priority text not null default 'p4'
    check (priority in ('p1', 'p2', 'p3', 'p4')),
  project_id uuid references projects(id) on delete set null,
  due_date date,
  due_time time,
  duration_minutes integer check (duration_minutes > 0),
  recurrence_rule text,
  calendar_event_id text,
  tags text[] not null default '{}',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  -- Full-text search vector (auto-generated)
  fts tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored
);

-- ── Task Locations (geofence triggers) ─────────────────

create table task_locations (
  task_id uuid not null references tasks(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('enter', 'exit')),
  primary key (task_id, location_id, trigger_type)
);

-- ── Calendar Sync ──────────────────────────────────────

create table calendar_sync (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  google_refresh_token text not null,
  google_access_token text,
  last_sync_token text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── User Preferences ───────────────────────────────────

create table user_preferences (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  default_view text not null default 'today'
    check (default_view in ('inbox', 'today', 'upcoming')),
  theme text not null default 'system'
    check (theme in ('light', 'dark', 'system')),
  timezone text not null default 'America/New_York',
  focus_hours_start integer not null default 9
    check (focus_hours_start between 0 and 23),
  focus_hours_end integer not null default 17
    check (focus_hours_end between 0 and 23),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Auto-update updated_at trigger ─────────────────────

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tasks_updated_at
  before update on tasks
  for each row execute function update_updated_at();

create trigger projects_updated_at
  before update on projects
  for each row execute function update_updated_at();

create trigger locations_updated_at
  before update on locations
  for each row execute function update_updated_at();

create trigger calendar_sync_updated_at
  before update on calendar_sync
  for each row execute function update_updated_at();

create trigger user_preferences_updated_at
  before update on user_preferences
  for each row execute function update_updated_at();
