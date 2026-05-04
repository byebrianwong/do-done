-- do-done: RLS policies for pet tables
-- All pet data restricted to authenticated users accessing their own rows.

alter table pets enable row level security;
alter table pet_goals enable row level security;
alter table pet_events enable row level security;

-- ── Pets ───────────────────────────────────────────────

create policy "pets_select" on pets
  for select to authenticated
  using (user_id = auth.uid());

create policy "pets_insert" on pets
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "pets_update" on pets
  for update to authenticated
  using (user_id = auth.uid());

create policy "pets_delete" on pets
  for delete to authenticated
  using (user_id = auth.uid());

-- ── Pet Goals ──────────────────────────────────────────

create policy "pet_goals_select" on pet_goals
  for select to authenticated
  using (user_id = auth.uid());

create policy "pet_goals_insert" on pet_goals
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "pet_goals_update" on pet_goals
  for update to authenticated
  using (user_id = auth.uid());

create policy "pet_goals_delete" on pet_goals
  for delete to authenticated
  using (user_id = auth.uid());

-- ── Pet Events ─────────────────────────────────────────

create policy "pet_events_select" on pet_events
  for select to authenticated
  using (user_id = auth.uid());

create policy "pet_events_insert" on pet_events
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "pet_events_delete" on pet_events
  for delete to authenticated
  using (user_id = auth.uid());
