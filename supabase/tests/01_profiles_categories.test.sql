begin;
\ir helpers.inc
select plan(12);

select tests.create_user('alice@test.fr', 'Alice') as alice \gset
select tests.create_user('bob@test.fr', 'Bob') as bob \gset

select is((select first_name from profiles where id = :'alice'), 'Alice', 'profile created by trigger');
select is((select language from profiles where id = :'alice'), 'fr', 'language defaults to fr');
select is((select role from profiles where id = :'alice'), 'user', 'role defaults to user');

select tests.act_as(:'alice');
select is((select count(*) from profiles)::int, 1, 'user sees only own profile row');
select is((select count(*) from public_profiles)::int, 2, 'public view shows everyone');
select lives_ok($$ update profiles set bio = 'Hello' where id = auth.uid() $$, 'can edit own bio');
select throws_ok($$ update profiles set role = 'admin' where id = auth.uid() $$, '42501', null, 'cannot self-promote');
select throws_ok($$ update profiles set phone_verified = true where id = auth.uid() $$, '42501', null, 'cannot self-verify phone');
select throws_ok($$ update profiles set supporter = true where id = auth.uid() $$, '42501', null, 'cannot self-grant supporter');
select throws_ok($$ insert into category_requests (user_id, requested_name, status) values (auth.uid(), 'Origami', 'approved') $$,
  '42501', null, 'cannot self-approve a category request');

select tests.act_as_anon();
select is((select count(*) from profiles)::int, 0, 'anon cannot read profiles base table');
select lives_ok($$ select * from categories $$, 'anon can read categories');

select * from finish();
rollback;
