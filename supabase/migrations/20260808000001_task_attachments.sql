-- Attachments: files that belong to a task.
--
-- Two halves that have to agree with each other:
--
--   1. `task_attachments` — the metadata row (name, mime type, size). This is
--      what the app lists and what cascades when a task is deleted.
--   2. A private Storage bucket holding the bytes.
--
-- The bytes live at `{user_id}/{task_id}/{uuid}.{ext}`. That leading user-id
-- segment is not decoration: Storage RLS can only see the object's path, so
-- putting the owner first is what lets a policy authorize a read without
-- joining back to `tasks`. The metadata row carries `user_id` for the same
-- reason — the app's own policies never have to walk the FK.
--
-- The bucket is PRIVATE. Every read goes through a short-lived signed URL, so
-- an attachment can't leak by URL-guessing the way a public bucket allows.

create table if not exists task_attachments (
  -- gen_random_uuid(), not uuid_generate_v4(): the latter comes from uuid-ossp
  -- and is not on the search path a migration runs under, which is why every
  -- table added since the original 2026-04 schema uses the built-in.
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Object key inside the `task-attachments` bucket. Unique so a retried
  -- upload can never leave two rows pointing at the same bytes — deleting one
  -- would then break the other.
  storage_path text not null unique,
  -- The name the user chose. Kept separate from storage_path so the download
  -- can be served under the original filename while the key stays opaque.
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now()
);

-- Listing an attachment set is always "everything for one task, oldest first".
create index if not exists task_attachments_task_idx
  on task_attachments (task_id, created_at);

alter table task_attachments enable row level security;

create policy "task_attachments_select" on task_attachments
  for select to authenticated
  using (user_id = auth.uid());

create policy "task_attachments_insert" on task_attachments
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "task_attachments_delete" on task_attachments
  for delete to authenticated
  using (user_id = auth.uid());

-- ── Storage bucket ─────────────────────────────────────

-- `public = false` — see the header. 10 MB ceiling is enforced here as well as
-- in the client so a hand-rolled request can't push a 2 GB video into the
-- bucket; the client-side check exists only to fail fast with a good message.
insert into storage.buckets (id, name, public, file_size_limit)
values ('task-attachments', 'task-attachments', false, 10485760)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- Storage policies authorize on the first path segment, which is the owner's
-- user id. `storage.foldername(name)` splits the key on "/", so [1] is that
-- segment. No update policy: an attachment is immutable — replacing one means
-- deleting it and uploading again, which keeps the metadata row and the bytes
-- from drifting apart.
--
-- Dropped first because `storage.objects` is shared by every bucket in the
-- project: unlike the tables above, a policy name here can already exist from
-- some earlier hand-run SQL, and CREATE POLICY has no IF NOT EXISTS — one
-- collision would abort the whole migration.
drop policy if exists "task_attachments_objects_select" on storage.objects;
drop policy if exists "task_attachments_objects_insert" on storage.objects;
drop policy if exists "task_attachments_objects_delete" on storage.objects;

create policy "task_attachments_objects_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'task-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "task_attachments_objects_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'task-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "task_attachments_objects_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'task-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

comment on table task_attachments is
  'Files attached to a task. Bytes live in the private `task-attachments` Storage bucket at {user_id}/{task_id}/{uuid}.{ext}; deleting a task cascades this row but NOT the object — TasksApi.delete() clears the objects first.';
