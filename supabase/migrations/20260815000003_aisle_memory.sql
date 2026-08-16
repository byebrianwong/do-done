-- Aisle memory: what the user has taught DoDone about their own words.
--
-- NUMBERED 000003, NOT 000002, AND THAT MATTERS. This file first landed as
-- `20260815000002_aisle_memory.sql`, and a concurrent branch
-- (`status_sync_sweep_watermark`) had already applied its own migration under
-- that same prefix. Supabase keys the ledger on the numeric prefix alone — not
-- the name, not the contents — so `db push` read 20260815000002 as applied,
-- skipped this file, and reported success while `list_term_aisles` did not
-- exist. Renumbering is the whole fix; nothing in the SQL changed.
--
-- `food.ts` guesses an item's aisle from a built-in lexicon, and the user can
-- move any item to a different one. Until now that correction was a tag on the
-- row, which fixed *that* row and nothing else — and a shopping list is
-- standing, so the same words come back every week and were guessed wrong
-- every week.
--
-- The correction cannot be learned from history, which is the obvious idea and
-- does not work here: "Clear bought" soft-deletes the items, and
-- `purgeDeleted()` destroys them an hour later. Anything derived by sweeping
-- past items would forget everything the user taught it by the end of the
-- afternoon. So the lesson is stored where it can outlive the item.

create table if not exists list_term_aisles (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The normalised item text the lesson is keyed on — see `learnableTerm`.
  -- Bounded because it is a key, not content: a pasted paragraph must not
  -- become one.
  term text not null check (char_length(term) between 1 and 120),
  aisle text not null check (
    aisle in (
      'produce', 'bakery', 'meat', 'dairy', 'frozen', 'pantry',
      'snacks', 'drinks', 'household', 'personal', 'baby', 'pets'
    )
  ),
  updated_at timestamptz not null default now(),

  -- The composite primary key is the concurrency story: teaching is an upsert
  -- on (user_id, term), so two devices correcting the same word race to a
  -- last-writer-wins outcome rather than to a duplicate row. A surrogate id
  -- plus a unique index would do the same thing with an extra column and an
  -- extra decision at every call site.
  primary key (user_id, term)
);

comment on table list_term_aisles is
  'Per-user corrections to the shopping-list aisle lexicon, keyed on the normalised item text. Outlives the items themselves, which are cleared and purged every shop.';

-- Every read is "all of this user's terms", loaded once and held for the
-- session — the map is small and is consulted per keystroke-ish, so a
-- per-lookup query would be the wrong shape entirely. The PK already covers it.

alter table list_term_aisles enable row level security;

create policy "list_term_aisles_select" on list_term_aisles
  for select to authenticated
  using (user_id = auth.uid());

create policy "list_term_aisles_insert" on list_term_aisles
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "list_term_aisles_update" on list_term_aisles
  for update to authenticated
  using (user_id = auth.uid());

create policy "list_term_aisles_delete" on list_term_aisles
  for delete to authenticated
  using (user_id = auth.uid());

-- `updated_at` is maintained by the shared trigger every other table here uses,
-- so "what have I taught it lately" stays answerable without the app writing
-- the column by hand on the upsert path.
drop trigger if exists list_term_aisles_updated_at on list_term_aisles;
create trigger list_term_aisles_updated_at
  before update on list_term_aisles
  for each row execute function update_updated_at();
