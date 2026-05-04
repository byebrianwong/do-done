-- do-done: Performance indexes for pet tables

-- Pet events: fetched per-user ordered by recency for the activity log.
create index pet_events_user_created_idx
  on pet_events(user_id, created_at desc);

-- Pet goals: fetched per-user filtered by status to find open goals.
create index pet_goals_user_status_idx
  on pet_goals(user_id, status);
