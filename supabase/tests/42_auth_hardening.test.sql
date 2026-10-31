-- Pre-launch security review (Task 4, batch 4b): AUTH-1/2 (passwords unusable), avatar cap versus the
-- deletion queue, and anon access to the activities embedding columns.
begin;
\ir helpers.inc
select plan(11);
select tests.create_user('pw@au.fr', 'Pia') as pia \gset

-- ---- AUTH-1 / AUTH-2: a password hash can never be stored in auth.users ----------------------------
select lives_ok($$ update auth.users set encrypted_password = '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234' where email = 'pw@au.fr' $$,
  'AUTH-1: a password change goes through without an error');
select is((select encrypted_password from auth.users where email = 'pw@au.fr'), '', 'AUTH-1: but the stored hash stays empty, so grant_type=password can never succeed');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pw2@au.fr',
  '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234', '{}', '{"first_name":"Pol"}');
select is((select encrypted_password from auth.users where email = 'pw2@au.fr'), '', 'AUTH-2: a password sign-up is stored with an empty hash too');

-- Migration 49: the trigger has no column list, so any update of a row empties the hash, and the
-- (bucket, path) lookup used by the avatar cap has an index.
select is((select count(*)::int from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'auth_users_no_passwords'
  and pg_get_triggerdef(oid) not like '%UPDATE OF%' and pg_get_triggerdef(oid) like '%INSERT OR UPDATE ON%'), 1,
  'AUTH-1: the password-blanking trigger fires on every insert and update, with no column list');
update auth.users set encrypted_password = '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234', updated_at = now() where email = 'pw@au.fr';
select is((select encrypted_password from auth.users where email = 'pw@au.fr'), '', 'AUTH-1: still empty after an update that sets the hash together with other columns');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'storage_deletions'
  and indexdef like '%(bucket, path)%'), 'storage_deletions has an index on (bucket, path)');

-- ---- avatar cap: objects already queued for deletion do not count ----------------------------------
insert into storage.objects (bucket_id, name, owner)
select 'avatars', :'pia' || '/' || repeat(to_hex(n), 32)::text || '.jpg', :'pia' from generate_series(1, 5) n;
select tests.act_as(:'pia');
select throws_ok(format($q$insert into storage.objects (bucket_id, name, owner) values ('avatars', %L, %L)$q$, :'pia' || '/' || repeat('a', 32) || '.jpg', :'pia'),
  '42501', null, 'avatar cap: a sixth live avatar is refused');
select tests.act_as_superuser();
insert into public.storage_deletions (bucket, path)
select 'avatars', name from storage.objects where bucket_id = 'avatars' and name like :'pia' || '/%' order by name limit 2;
select tests.act_as(:'pia');
select lives_ok(format($q$insert into storage.objects (bucket_id, name, owner) values ('avatars', %L, %L)$q$, :'pia' || '/' || repeat('a', 32) || '.jpg', :'pia'),
  'avatar cap: two files are queued for deletion, so a new upload is accepted before storage-cleanup runs');
select tests.act_as_superuser();

-- ---- anon cannot read the activities embedding columns ---------------------------------------------
select tests.act_as_anon();
select throws_ok($$ select embedding from activities $$, '42501', null, 'anon cannot read activities.embedding');
select throws_ok($$ select embedding_hash from activities $$, '42501', null, 'anon cannot read activities.embedding_hash');
select lives_ok($$ select title from activities $$, 'anon still reads the public columns');
select tests.act_as_superuser();
select * from finish();
rollback;
