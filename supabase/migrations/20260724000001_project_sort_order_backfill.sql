-- do-done: Give projects a stable, user-editable ordering.
--
-- `projects.sort_order` has existed since the initial schema but every row
-- defaulted to 0, so ordering was effectively arbitrary. Backfill it from
-- creation time (per user) so existing projects get a sensible starting order
-- that drag-to-reorder can then rewrite. New projects are appended past the end
-- by the API layer (ProjectsApi.create).

-- Only touch rows that were never explicitly ordered (all still at the 0
-- default). This keeps the migration a no-op for anyone who already has
-- distinct sort_order values.
update projects p
set sort_order = ranked.rn * 1000
from (
  select
    id,
    row_number() over (
      partition by user_id
      order by created_at, id
    ) as rn
  from projects
) ranked
where p.id = ranked.id
  and p.sort_order = 0;

-- Composite index for the ordered per-user read in ProjectsApi.list()
-- (`where user_id = ? order by sort_order`).
create index if not exists idx_projects_user_sort
  on projects (user_id, sort_order);
