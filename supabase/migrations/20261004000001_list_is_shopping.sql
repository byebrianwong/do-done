-- A list is a shopping list or a plain checklist.
--
-- Until now every `kind = 'list'` project was treated as a shopping list:
-- items grouped by aisle, `@store` hints, the pantry and "Probably due". That
-- is wrong for a packing list or a reading list, where an aisle header over
-- "passport" is noise and ticking it off is not a purchase.
--
-- `is_shopping` turns those features on. It is also what puts a list into the
-- combined "All shopping" view, which shows the items of every shopping list
-- together for a shop that sells from more than one of them.
--
-- It defaults to true, so every existing list keeps behaving exactly as it did,
-- and so does a list created by a client running the previous bundle, which
-- never sends the column. The clients send `false` only when a user turns it
-- off, and send nothing at all for the default, so a rename from a bundle that
-- predates this migration does not name a column the table lacks.
--
-- It is meaningless on `kind = 'tasks'`. A column constraint tying the two
-- together would make converting a list back into a project a two-column write
-- for no gain, so readers go through `isShoppingList()` in `@do-done/shared`,
-- which checks the kind first.
--
-- No trigger. Unlike `kind`, this changes nothing about which rows a task read
-- can see: an item on a checklist is still `is_list_item`, still excluded from
-- every task view, and still only reachable through `TasksApi.readItems()`.
--
-- NUMBERING. Supabase keys `schema_migrations` on the 14-digit prefix alone.
-- This number is past every version in the tree at the time of writing
-- (20260830000001). Re-check `supabase migration list --linked` at merge time,
-- not just the files on this branch. `tools/check-migrations.mjs` catches the
-- in-tree collision.

alter table projects
  add column if not exists is_shopping boolean not null default true;

comment on column projects.is_shopping is
  'Only read when kind = ''list''. true = a shopping list (aisles, store hints, pantry, included in All shopping). false = a plain checklist.';
