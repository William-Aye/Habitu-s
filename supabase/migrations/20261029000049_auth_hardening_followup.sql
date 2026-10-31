-- Pre-launch security review, Task 4 batch 4c (carried from the batch 4b review).
--
-- Wording fix for the header of migration 48 (not edited there: earlier migrations are never changed).
-- It says the trigger "empties" the hash "on every insert and every change". As created it was
-- "before insert or update of encrypted_password", so it fired on an update only when the statement
-- named that column in its SET list. That is enough for GoTrue, which always writes the column when
-- it sets a password, but it also meant a future Auth upgrade that runs
-- "ALTER COLUMN encrypted_password TYPE ..." on auth.users would fail while a trigger depends on that
-- column. The trigger below has no column list: it fires on every insert and every update of a row
-- and runs the same function (private.auth_no_passwords, unchanged), so the claim is now literally true.
--
-- storage_deletions(bucket, path): no new index is needed. The table's "unique (bucket, path)"
-- constraint (migration 32) already has a btree index on exactly those columns, and it serves the
-- "not exists" lookup in private.my_storage_objects.

drop trigger auth_users_no_passwords on auth.users;
create trigger auth_users_no_passwords before insert or update on auth.users
  for each row execute function private.auth_no_passwords();
