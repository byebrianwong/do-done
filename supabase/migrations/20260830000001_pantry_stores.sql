-- An item can be sold in more than one place, so the pantry remembers all of
-- them rather than the last one.
--
-- `list_pantry.store` held a single shop, matching the single `at:` tag an item
-- was allowed to carry. An item may now carry several, so putting one back from
-- the drawer with one shop attached would silently drop the others, and the
-- user would re-add them at the shelf every week.
--
-- NUMBERING. Supabase keys `schema_migrations` on the 14-digit prefix alone.
-- This number is past every version in the tree at the time of writing
-- (20260829000001). If a sibling branch lands another 20260830 migration first,
-- this file is silently skipped and reported as applied. Re-check
-- `supabase migration list --linked` at merge time, not just the files on this
-- branch. `tools/check-migrations.mjs` catches the in-tree collision.

alter table list_pantry
  add column if not exists stores text[] not null default '{}';

comment on column list_pantry.stores is
  'Every shop the item was last bought at, in the order they were named on the item.';

-- Carry the single stores forward. A row bought at one shop keeps that shop.
update list_pantry
   set stores = array[store]
 where store is not null and stores = '{}';

-- `store` is left in place, unread and unwritten from here on. Dropping it in
-- the same migration would break any client still running the previous bundle,
-- which selects it by name; a select of a missing column fails the whole read,
-- and `PantryApi.load` reports a failed read as an empty pantry. The column is
-- three characters wide on a table with one row per item per list, so leaving
-- it costs nothing until a later migration removes it.

-- ── Recording a buy ────────────────────────────────────
--
-- Same statement as before, with the store list replacing the scalar. Kept as a
-- separate overload rather than a replacement so a client running the previous
-- bundle still records its buys: PostgREST picks the function by the argument
-- names in the request body, so `p_store` and `p_stores` resolve to different
-- functions with no ambiguity.

create or replace function record_pantry_buy(
  p_list_id uuid,
  p_term text,
  p_title text,
  p_stores text[]
) returns void
language plpgsql
as $$
declare
  v_prev timestamptz;
  v_gap smallint;
  v_gaps smallint[];
  v_stores text[];
begin
  if auth.uid() is null then
    return;
  end if;

  -- An item that named no shop leaves the remembered ones alone, the same way
  -- the single-store column did with `coalesce(p_store, store)`. Buying milk
  -- without saying where says nothing about where milk comes from, and the
  -- remembered shop is still the best guess the drawer has for putting it back.
  -- Naming shops replaces the set, so narrowing two down to one is recorded.
  v_stores := coalesce(p_stores, '{}');

  select last_bought_at, gaps into v_prev, v_gaps
  from list_pantry
  where user_id = auth.uid() and list_id = p_list_id and term = p_term;

  if v_prev is null then
    insert into list_pantry (user_id, list_id, term, title, stores)
    values (auth.uid(), p_list_id, p_term, p_title, v_stores)
    on conflict (user_id, list_id, term) do nothing;
    return;
  end if;

  v_gap := greatest(0, (now()::date - v_prev::date))::smallint;

  -- Two ticks on the same day count as one shop. This also makes
  -- tick / untick / tick harmless: it cannot inflate the count or record a
  -- zero-day gap.
  if v_gap = 0 then
    update list_pantry
       set title = p_title,
           stores = case when cardinality(v_stores) > 0 then v_stores else stores end,
           updated_at = now()
     where user_id = auth.uid() and list_id = p_list_id and term = p_term;
    return;
  end if;

  v_gaps := coalesce(v_gaps, '{}') || v_gap;
  if array_length(v_gaps, 1) > 10 then
    v_gaps := v_gaps[array_length(v_gaps, 1) - 9 : array_length(v_gaps, 1)];
  end if;

  update list_pantry
     set title = p_title,
         last_bought_at = now(),
         buy_count = buy_count + 1,
         gaps = v_gaps,
         stores = case when cardinality(v_stores) > 0 then v_stores else stores end,
         updated_at = now()
   where user_id = auth.uid() and list_id = p_list_id and term = p_term;
end;
$$;

comment on function record_pantry_buy(uuid, text, text, text[]) is
  'Records that an item was bought: upserts the pantry entry, counts the buy, appends the gap since the previous one, and stores every shop it was bought at. Same-day repeats are ignored.';

grant execute on function record_pantry_buy(uuid, text, text, text[]) to authenticated;

-- The single-store overload stays, so a client on the previous bundle keeps
-- recording. It writes the new column, so nothing it records is lost when that
-- client updates.

create or replace function record_pantry_buy(
  p_list_id uuid,
  p_term text,
  p_title text,
  p_store text default null
) returns void
language plpgsql
as $$
begin
  perform record_pantry_buy(
    p_list_id,
    p_term,
    p_title,
    case when p_store is null then '{}'::text[] else array[p_store] end
  );
end;
$$;

comment on function record_pantry_buy(uuid, text, text, text) is
  'Single-store form, kept for clients running a bundle from before an item could name more than one shop. Delegates to the text[] version.';
