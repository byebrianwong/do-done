-- do-done: Row Level Security policies
-- All tables restricted to authenticated users accessing their own data

alter table tasks enable row level security;
alter table projects enable row level security;
alter table locations enable row level security;
alter table task_locations enable row level security;
alter table calendar_sync enable row level security;
alter table user_preferences enable row level security;

-- ── Tasks ──────────────────────────────────────────────

create policy "tasks_select" on tasks
  for select to authenticated
  using (user_id = auth.uid());

create policy "tasks_insert" on tasks
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "tasks_update" on tasks
  for update to authenticated
  using (user_id = auth.uid());

create policy "tasks_delete" on tasks
  for delete to authenticated
  using (user_id = auth.uid());

-- ── Projects ───────────────────────────────────────────

create policy "projects_select" on projects
  for select to authenticated
  using (user_id = auth.uid());

create policy "projects_insert" on projects
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "projects_update" on projects
  for update to authenticated
  using (user_id = auth.uid());

create policy "projects_delete" on projects
  for delete to authenticated
  using (user_id = auth.uid());

-- ── Locations ──────────────────────────────────────────

create policy "locations_select" on locations
  for select to authenticated
  using (user_id = auth.uid());

create policy "locations_insert" on locations
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "locations_update" on locations
  for update to authenticated
  using (user_id = auth.uid());

create policy "locations_delete" on locations
  for delete to authenticated
  using (user_id = auth.uid());

-- ── Task Locations ─────────────────────────────────────

create policy "task_locations_select" on task_locations
  for select to authenticated
  using (task_id in (select id from tasks where user_id = auth.uid()));

create policy "task_locations_insert" on task_locations
  for insert to authenticated
  with check (task_id in (select id from tasks where user_id = auth.uid()));

create policy "task_locations_delete" on task_locations
  for delete to authenticated
  using (task_id in (select id from tasks where user_id = auth.uid()));

-- ── Calendar Sync ──────────────────────────────────────

create policy "calendar_sync_select" on calendar_sync
  for select to authenticated
  using (user_id = auth.uid());

create policy "calendar_sync_insert" on calendar_sync
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "calendar_sync_update" on calendar_sync
  for update to authenticated
  using (user_id = auth.uid());

create policy "calendar_sync_delete" on calendar_sync
  for delete to authenticated
  using (user_id = auth.uid());

-- ── User Preferences ───────────────────────────────────

create policy "user_preferences_select" on user_preferences
  for select to authenticated
  using (user_id = auth.uid());

create policy "user_preferences_insert" on user_preferences
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "user_preferences_update" on user_preferences
  for update to authenticated
  using (user_id = auth.uid());
