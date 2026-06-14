-- Cross-device persistence for the Display feature (sort/group/filter).
--
-- Each task view (all, inbox, today, upcoming, project, completed) remembers
-- its own DisplayConfig. Until now that lived only in the browser's
-- localStorage / the app's AsyncStorage — per device. This stores it in the
-- user's preferences row as a map of viewKey -> DisplayConfig, so the choices
-- follow the user across web + mobile.
--
-- Shape: { "all": { "group": "priority", "sort": [...], "filters": [...],
--          "showCompleted": false }, "today": { ... }, ... }

alter table user_preferences
  add column display_prefs jsonb not null default '{}'::jsonb;

-- Atomic single-view upsert. Doing this in SQL (rather than read-modify-write
-- in the client) keeps concurrent writes to *different* views from clobbering
-- each other, and inserts the prefs row on first write. Runs as the caller, so
-- the existing user_preferences RLS policies scope it to their own row.
create or replace function set_display_pref(p_view_key text, p_config jsonb)
returns void
language sql
as $$
  insert into user_preferences (user_id, display_prefs)
  values (auth.uid(), jsonb_build_object(p_view_key, p_config))
  on conflict (user_id) do update
    set display_prefs = jsonb_set(
          coalesce(user_preferences.display_prefs, '{}'::jsonb),
          array[p_view_key],
          p_config,
          true
        ),
        updated_at = now();
$$;

grant execute on function set_display_pref(text, jsonb) to authenticated;
