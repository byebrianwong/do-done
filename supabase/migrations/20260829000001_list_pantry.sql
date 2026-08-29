-- The pantry: what has been bought on each list, and when.
--
-- A shopping list never finishes. It empties and refills, and most of what goes
-- on it has been on it before. None of that was knowable until now: "Put away"
-- soft-deletes the items and `purgeDeleted()` destroys them an hour later, so
-- anything derived by sweeping past items would forget the week that afternoon.
--
-- NUMBERING. Supabase keys `schema_migrations` on the 14-digit prefix alone.
-- This number is past every version in the tree at the time of writing
-- (20260815000003). If a sibling branch lands another 20260829 migration first,
-- this file is silently skipped and reported as applied. Re-check
-- `supabase migration list --linked` at merge time, not just the files on this
-- branch. `tools/check-migrations.mjs` catches the in-tree collision.
--
-- WHY A TABLE RATHER THAN KEEPING THE ROWS. Retaining the soft-deleted items
-- would work for a month and then degrade. Buying milk weekly for a year is 52
-- dead rows for one word, each with its own tags, attachments and sort order,
-- filtered out of every read but still stored. The drawer would have to group
-- them back into one line anyway, and "deleted" would stop meaning deleted.
--
-- WHY NOT FOLDED INTO list_term_aisles. That table is per user, not per list,
-- and that is correct: "bananas are produce" is a fact about the language and
-- holds on every list someone keeps. This table is per list, because "milk
-- comes from Trader Joe's" is a fact about one kind of shopping. Merging them
-- would scope the aisle memory down to a single list, which is a regression.
-- So the pantry stores no aisle, and `itemAisle` still answers that question.

create table if not exists list_pantry (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Per list, so Groceries and Hardware never suggest into each other.
  list_id uuid not null references projects(id) on delete cascade,
  -- The normalised item text from `learnableTerm`, the same key
  -- `list_term_aisles` uses, so "6 eggs" and "eggs" are one entry. Length-
  -- bounded because it is a key, not content.
  term text not null check (char_length(term) between 1 and 120),
  -- The title as last written, so putting an item back restores the user's own
  -- wording rather than the normalised key.
  title text not null check (char_length(title) between 1 and 500),
  last_bought_at timestamptz not null default now(),
  buy_count integer not null default 1 check (buy_count > 0),
  -- Days between the last few buys, oldest first, capped at ten by
  -- `record_pantry_buy`. Stored as an array rather than a running average
  -- because cadence needs a median: one holiday month would drag an average far
  -- enough to distort a weekly item's rhythm, where a median is unaffected.
  gaps smallint[] not null default '{}',
  -- Where it was last bought, so putting an item back restores its store.
  store text check (store is null or char_length(store) between 1 and 120),
  updated_at timestamptz not null default now(),

  -- The composite key handles concurrency the same way `list_term_aisles` does:
  -- two devices ticking milk settle on last-writer-wins rather than duplicating.
  primary key (user_id, list_id, term)
);

comment on table list_pantry is
  'What this user has bought on each shopping list, and when. Outlives the items, which are put away and purged after every shop.';

-- Every read loads one list's whole pantry, once per screen. The primary key
-- covers that, since user_id is the first column and list_id the second.

alter table list_pantry enable row level security;

create policy "list_pantry_select" on list_pantry
  for select to authenticated
  using (user_id = auth.uid());

create policy "list_pantry_insert" on list_pantry
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "list_pantry_update" on list_pantry
  for update to authenticated
  using (user_id = auth.uid());

create policy "list_pantry_delete" on list_pantry
  for delete to authenticated
  using (user_id = auth.uid());

-- ── Recording a buy ────────────────────────────────────
--
-- One atomic round trip. Reading the row, computing the gap in the client and
-- writing it back would take two round trips on one of the most repeated
-- actions in the app, and would lose a buy when two devices tick the same item
-- at once. Here the gap is computed in the same statement that stores it.
--
-- SECURITY INVOKER (the default), so the policies above still apply and this
-- cannot write another user's pantry however it is called.

create or replace function record_pantry_buy(
  p_list_id uuid,
  p_term text,
  p_title text,
  p_store text default null
) returns void
language plpgsql
as $$
declare
  v_prev timestamptz;
  v_gap smallint;
  v_gaps smallint[];
begin
  if auth.uid() is null then
    return;
  end if;

  select last_bought_at, gaps into v_prev, v_gaps
  from list_pantry
  where user_id = auth.uid() and list_id = p_list_id and term = p_term;

  if v_prev is null then
    insert into list_pantry (user_id, list_id, term, title, store)
    values (auth.uid(), p_list_id, p_term, p_title, p_store)
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
           store = coalesce(p_store, store),
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
         store = coalesce(p_store, store),
         updated_at = now()
   where user_id = auth.uid() and list_id = p_list_id and term = p_term;
end;
$$;

comment on function record_pantry_buy is
  'Records that an item was bought: upserts the pantry entry, counts the buy, and appends the gap since the previous one. Same-day repeats are ignored.';

grant execute on function record_pantry_buy(uuid, text, text, text) to authenticated;
