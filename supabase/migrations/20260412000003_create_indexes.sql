-- do-done: Performance indexes

-- Tasks: primary query patterns
create index idx_tasks_user_status on tasks(user_id, status);
create index idx_tasks_user_due_date on tasks(user_id, due_date);
create index idx_tasks_user_project on tasks(user_id, project_id);
create index idx_tasks_user_priority on tasks(user_id, priority);
create index idx_tasks_calendar_event on tasks(calendar_event_id) where calendar_event_id is not null;

-- Tasks: full-text search
create index idx_tasks_fts on tasks using gin(fts);

-- Tasks: tags (array contains)
create index idx_tasks_tags on tasks using gin(tags);

-- Projects
create index idx_projects_user on projects(user_id);

-- Locations
create index idx_locations_user on locations(user_id);
