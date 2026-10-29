-- Pre-launch security review (Task 4, batch 4b): AUTH-1/2, passwords can never be stored.
begin;
\ir helpers.inc
select plan(3);
select tests.create_user('pw@au.fr', 'Pia') as pia \gset

-- ---- AUTH-1 / AUTH-2: a password hash can never be stored in auth.users ----------------------------
select lives_ok($$ update auth.users set encrypted_password = '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234' where email = 'pw@au.fr' $$,
  'AUTH-1: a password change goes through without an error');
select is((select encrypted_password from auth.users where email = 'pw@au.fr'), '', 'AUTH-1: but the stored hash stays empty, so grant_type=password can never succeed');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pw2@au.fr',
  '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234', '{}', '{"first_name":"Pol"}');
select is((select encrypted_password from auth.users where email = 'pw2@au.fr'), '', 'AUTH-2: a password sign-up is stored with an empty hash too');

select * from finish();
rollback;
