-- APP-1, APP-2 and ruling H (pre-launch security review): avatars keep a public bucket, but
--   * every avatar file gets an unguessable name, <uid>/<32 random hex>.jpg, chosen by the app per
--     upload, so knowing a person's id no longer yields their photo (DB-1, DB-2);
--   * profiles.photo_url stores that object name (not a URL) and can only name the person's own
--     avatar, so it can no longer point at an outside server (tracking) or carry megabytes; the app
--     builds the public URL from it;
--   * a person keeps at most five avatar files at once, cannot overwrite one, and choosing a photo
--     queues every other file of their folder for deletion;
--   * the two private buckets accept at most ten uploads per person per day (their orphans are
--     already removed after seven days by the nightly retention job, migration 32).
--
-- Existing files: Storage objects cannot be renamed from SQL on the hosted project (a moved row
-- leaves the backing file behind, see migration 32), so old <uid>/avatar.jpg files are not renamed.
-- They are queued for deletion through storage_deletions (the storage-cleanup function removes them
-- with the Storage API) and the profiles that pointed at them lose their photo: the person uploads
-- it again. This runs before the first public release, so only test accounts are affected, and no
-- guessable avatar path survives the migration.

-- ---------------------------------------------------------------------------------------------
-- 1. Existing avatars: queue every file with an old-style name, clear photo_url values that are not
--    an own new-style name.
insert into public.storage_deletions (bucket, path)
select o.bucket_id, o.name from storage.objects o
 where o.bucket_id = 'avatars' and o.name !~ '^[0-9a-f-]{36}/[0-9a-f]{32}\.jpg$'
on conflict (bucket, path) do nothing;

update public.profiles set photo_url = null
 where photo_url is not null and photo_url !~ ('^' || id::text || '/[0-9a-f]{32}\.jpg$');

alter table public.profiles add constraint profiles_photo_url_own_avatar
  check (photo_url is null or photo_url ~ ('^' || id::text || '/[0-9a-f]{32}\.jpg$'));

-- ---------------------------------------------------------------------------------------------
-- 2. Upload counts for the storage policies. In the private schema (not exposed through the API);
--    counts only the caller's own folder, so it reveals nothing about anyone else.
create function private.my_storage_objects(p_bucket text, p_since timestamptz) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from storage.objects o
   where o.bucket_id = p_bucket
     and (storage.foldername(o.name))[1] = auth.uid()::text
     and o.created_at >= p_since;
$$;
revoke all on function private.my_storage_objects(text, timestamptz) from public, anon;
grant execute on function private.my_storage_objects(text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Avatar policies: exact name shape, at most five files, no overwrite (each upload is a new name,
--    so the app never upserts). Select and delete of the own folder are unchanged.
drop policy avatars_insert_own on storage.objects;
drop policy avatars_update_own on storage.objects;
create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars'
    and name ~ ('^' || auth.uid()::text || '/[0-9a-f]{32}\.jpg$')
    and private.my_storage_objects('avatars', '-infinity') < 5);

-- Private buckets: own folder as before, at most ten uploads a day.
drop policy claim_documents_insert_own on storage.objects;
drop policy feedback_screenshots_insert_own on storage.objects;
create policy claim_documents_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'claim-documents' and (storage.foldername(name))[1] = auth.uid()::text
    and private.my_storage_objects('claim-documents', now() - interval '1 day') < 10);
create policy feedback_screenshots_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'feedback-screenshots' and (storage.foldername(name))[1] = auth.uid()::text
    and private.my_storage_objects('feedback-screenshots', now() - interval '1 day') < 10);

-- ---------------------------------------------------------------------------------------------
-- 4. Choosing (or removing) a photo queues every other file of the person's avatar folder, which
--    also sweeps uploads whose profile update failed.
create function public.profiles_queue_old_avatars() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.storage_deletions (bucket, path)
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'avatars'
     and (storage.foldername(o.name))[1] = new.id::text
     and o.name is distinct from new.photo_url
  on conflict (bucket, path) do nothing;
  return null;
end $$;
revoke all on function public.profiles_queue_old_avatars() from public, anon, authenticated;
create trigger profiles_queue_old_avatars after update of photo_url on public.profiles
  for each row when (old.photo_url is distinct from new.photo_url)
  execute function public.profiles_queue_old_avatars();
