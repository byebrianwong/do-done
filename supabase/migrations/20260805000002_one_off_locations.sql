-- One-off places: a place attached to a task inline, without filing it under
-- Saved places.
--
-- Capture is the reason. Typing "Target", picking the nearest one and getting
-- on with it is the common case; naming a place and keeping it is the rare one.
-- Both still write a `locations` row — geofence registration, the dwell filter
-- and the notification copy all key on `locations.id`, and giving ad-hoc places
-- their own storage would mean a second path through every one of them.
--
-- What `is_saved = false` changes is reach, not behaviour: one-off rows are
-- hidden from the place picker and from Settings → Saved places, and they are
-- deleted as soon as their last task link goes (trigger below), so a year of
-- "remind me at this one shop" leaves nothing behind to scroll past.

alter table locations
  add column if not exists is_saved boolean not null default true;

comment on column locations.is_saved is
  'true = in the user''s Saved places. false = one-off, attached to a single task inline: hidden from pickers, and deleted when its last task_locations row goes away.';

-- Both readers that matter ask for "this user's saved places".
create index if not exists idx_locations_user_saved
  on locations(user_id, is_saved);

-- ── Orphan cleanup ─────────────────────────────────────
--
-- A one-off place is owned by its links, and they can go away three ways: the
-- user switches the reminder off, the user deletes the task (cascade), or the
-- location itself is deleted (cascade, a no-op here). Only the first is a
-- client action, so client-side cleanup would leak a row on the other two —
-- and a leaked one-off place is invisible by construction, since nothing lists
-- it. Hence a trigger: the rule lives where every path has to pass.
--
-- SECURITY DEFINER because RLS on `locations` is per-user and this runs inside
-- someone else's DELETE. It can only ever remove an unsaved row that no link
-- points at, which is unreachable from every surface in the app.
create or replace function prune_one_off_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from locations
   where id = old.location_id
     and is_saved = false
     and not exists (
       select 1 from task_locations where location_id = old.location_id
     );
  return null;
end;
$$;

drop trigger if exists task_locations_prune_one_off on task_locations;
create trigger task_locations_prune_one_off
  after delete on task_locations
  for each row execute function prune_one_off_location();
