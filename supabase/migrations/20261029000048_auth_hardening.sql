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
