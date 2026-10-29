-- Pre-launch security review, Task 4 batch 4b.
--
-- AUTH-1 / AUTH-2: the spec says "Passwords: none" (section 18.1), but GoTrue keeps its password
-- endpoints open while the email provider is on, and config.toml has no "email code only" switch:
-- POST /signup with a password, PUT /user with a password, and grant_type=password all work. Someone
-- holding a stolen session could set a password and keep the account for good; someone could register
-- a victim's address with their own password before the victim signs up.
-- GoTrue stores the password hash in auth.users.encrypted_password. This trigger empties it on every
-- insert and every change, so no password can ever verify (the bcrypt comparison against an empty
-- hash fails with invalid_credentials) and an attacker's pre-registered password is gone before the
-- real owner confirms the address. Accounts made by email code or Google already have an empty hash.
-- It runs as the table's trigger, so it works on the hosted project the same way the handle_new_user
-- trigger already does. The password endpoints still answer, but what they store is unusable;
-- config.toml also turns on email confirmation, so a password sign-up gets no session.

create function private.auth_no_passwords() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.encrypted_password := '';
  return new;
end $$;
revoke all on function private.auth_no_passwords() from public, anon, authenticated;

create trigger auth_users_no_passwords before insert or update of encrypted_password on auth.users
  for each row execute function private.auth_no_passwords();

-- ---------------------------------------------------------------------------------------------
-- Avatar cap (carried from the batch 4a review): migration 39 counted every object in the person's
-- avatars folder, including files already queued in storage_deletions that storage-cleanup has not
-- removed yet. With the function not deployed, queued files never leave and the person is locked out
-- of changing their photo for good. Objects queued for deletion (same bucket and path) no longer count.
-- The policies keep calling the same function, which only changes here.
create or replace function private.my_storage_objects(p_bucket text, p_since timestamptz) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from storage.objects o
   where o.bucket_id = p_bucket
     and (storage.foldername(o.name))[1] = auth.uid()::text
     and o.created_at >= p_since
     and not exists (select 1 from public.storage_deletions d where d.bucket = o.bucket_id and d.path = o.name);
$$;

-- ---------------------------------------------------------------------------------------------
-- Embeddings (carried from the batch 4a review): collectifs already hides its embedding columns from
-- anon. The activities vector and its fingerprint are only used by the nightly job and the search
-- functions (security definer), so signed-out visitors lose the column grant too. Nothing in web/src
-- or the app's signed-out screens reads these columns (grep: no match outside database.types).
revoke select (embedding, embedding_hash) on public.activities from anon;
