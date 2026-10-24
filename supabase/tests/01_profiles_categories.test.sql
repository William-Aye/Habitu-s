begin;
\ir helpers.inc
select plan(30);

select tests.create_user('alice@test.fr', 'Alice') as alice \gset
select tests.create_user('bob@test.fr', 'Bob') as bob \gset
select tests.create_user('root@test.fr', 'Root') as root \gset

insert into categories (slug, name_fr, name_en, icon) values ('chess', 'Echecs', 'Chess', 'crown');
insert into category_requests (user_id, requested_name) values (:'alice', 'Origami');

select is((select first_name from profiles where id = :'alice'), 'Alice', 'profile created by trigger');
select is((select language from profiles where id = :'alice'), 'fr', 'language defaults to fr');
select is((select role from profiles where id = :'alice'), 'user', 'role defaults to user');
select hasnt_view('public', 'public_profiles', 'public_profiles no longer exists');
select is(has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE'), false, 'authenticated cannot truncate profiles');
select is(has_table_privilege('authenticated', 'public.categories', 'TRUNCATE'), false, 'authenticated cannot truncate categories');
select is(has_table_privilege('anon', 'public.profiles', 'TRUNCATE'), false, 'anon cannot truncate profiles');
select is(has_table_privilege('anon', 'public.categories', 'TRUNCATE'), false, 'anon cannot truncate categories');

select tests.act_as(:'alice');
select is((select count(*) from profiles)::int, 1, 'user sees only own profile row');
select is((select count(*) from profiles where id = :'bob')::int, 0, 'alice cannot read bob profile');
select throws_ok($$ select count(*) from public_profiles $$, '42P01', null, 'public_profiles cannot be read');
select lives_ok($$ update profiles set bio = 'Hello' where id = auth.uid() $$, 'can edit own bio');
select is((select bio from profiles where id = auth.uid()), 'Hello', 'bio actually changed');
with u as (update profiles set bio = 'x' where id = :'bob' returning 1)
select is((select count(*) from u)::int, 0, 'alice cannot update bob profile');
select throws_ok($$ update profiles set role = 'admin' where id = auth.uid() $$, '42501', null, 'cannot self-promote');
select throws_ok($$ update profiles set phone_verified = true where id = auth.uid() $$, '42501', null, 'cannot self-verify phone');
select throws_ok($$ update profiles set supporter = true where id = auth.uid() $$, '42501', null, 'cannot self-grant supporter');
select throws_ok($$ insert into category_requests (user_id, requested_name, status) values (auth.uid(), 'Origami', 'approved') $$,
  '42501', null, 'cannot self-approve a category request');

select lives_ok(format($f$ insert into user_interests (user_id, category_id, level) select %L, id, 'love' from categories where slug = 'chess' $f$, :'alice'),
  'alice can add her own interest');
select throws_ok(format($f$ insert into user_interests (user_id, category_id, level) select %L, id, 'love' from categories where slug = 'chess' $f$, :'bob'),
  '42501', null, 'alice cannot add interest for bob');
select throws_ok($$ insert into categories (slug, name_fr, name_en, icon) values ('x', 'x', 'x', 'x') $$, '42501', null, 'non-admin cannot insert category');
select throws_ok($$ insert into tags (slug, label_fr, label_en) values ('x', 'x', 'x') $$, '42501', null, 'non-admin cannot insert tag');

select tests.act_as(:'bob');
select is((select count(*) from user_interests)::int, 0, 'bob does not see alice interests');

select tests.act_as_superuser();
update profiles set role = 'admin' where id = :'root';
select tests.act_as_admin(:'root');
select lives_ok($$ insert into categories (slug, name_fr, name_en, icon) values ('go', 'Go', 'Go', 'circle') $$, 'admin can insert category');
select is((select count(*) from category_requests)::int, 1, 'admin reads all category requests');
select is((select count(*) from profiles)::int, 3, 'admin reads all profiles');

select tests.act_as_anon();
select is((select count(*) from profiles)::int, 0, 'anon cannot read profiles base table');
select lives_ok($$ select * from categories $$, 'anon can read categories');
select throws_ok($$ insert into category_requests (user_id, requested_name) values (gen_random_uuid(), 'Origami') $$, '42501', null, 'anon cannot insert category request');
select throws_ok($$ update profiles set bio = 'x' $$, '42501', null, 'anon cannot update profiles');

select * from finish();
rollback;
