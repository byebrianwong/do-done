-- Two security advisor warnings on what 20261120000001_task_order.sql added.
--
-- 1. place_task, adopt_task_order, task_order_renumber and task_rank_between
--    had no fixed search_path (`function_search_path_mutable`). They resolve
--    `tasks` and each other by name, so a caller that changed its search_path
--    could point them at other objects. Pinned to `public`, the same setting
--    `task_sync_is_list_item` uses.
--
-- 2. task_place_new is SECURITY DEFINER and was executable by anon and
--    authenticated, which the advisor reads as reachable through
--    /rest/v1/rpc. Postgres refuses to run a trigger function outside a
--    trigger, so it was not callable in practice; revoking EXECUTE makes that
--    explicit. A trigger still fires: Postgres checks EXECUTE when a trigger
--    is created, not when it runs.
--
-- NUMBERING. Past every version in the ledger at the time of writing
-- (20261120000001). Re-check `supabase migration list --linked` at merge time.

alter function task_rank_between(double precision, double precision) set search_path = public;
alter function task_order_renumber(uuid) set search_path = public;
alter function place_task(uuid, uuid, uuid) set search_path = public;
alter function adopt_task_order(uuid[]) set search_path = public;

revoke execute on function task_place_new() from public, anon, authenticated;
