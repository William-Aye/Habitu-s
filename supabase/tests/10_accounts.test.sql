begin;
\ir helpers.inc
select plan(22);

select tests.create_user('ana@acc.fr', 'Ana') as ana \gset
select tests.create_user('ben@acc.fr', 'Ben') as ben \gset

insert into categories (id, slug, name_fr, name_en, icon)
values ('00000000-0000-0000-0000-00000000ac01', 'acc-cat', 'Randonnée', 'Hiking', 'mountain');
insert into user_interests (user_id, category_id, level)
values (:'ana', '00000000-0000-0000-0000-00000000ac01', 'love'),
       (:'ben', '00000000-0000-0000-0000-00000000ac01', 'like');
insert into category_requests (user_id, requested_name) values (:'ana', 'Pétanque nocturne');

-- home-area snapping
select tests.act_as(:'ana');
update profiles set home_area = 'SRID=4326;POINT(4.83574 45.76402)' where id = :'ana';
select is((select ST_AsText(home_area::geometry) from profiles where id = :'ana'), 'POINT(4.84 45.76)',
  'update snaps home_area to the 0.01 degree grid');
select tests.act_as_superuser();
delete from profiles where id = :'ben';
insert into profiles (id, first_name, home_area) values (:'ben', 'Ben', 'SRID=4326;POINT(2.35219 48.85661)');
select is((select ST_AsText(home_area::geometry) from profiles where id = :'ben'), 'POINT(2.35 48.86)',
  'insert snaps home_area too');
insert into user_interests (user_id, category_id, level)
values (:'ben', '00000000-0000-0000-0000-00000000ac01', 'like');

-- last_seen_at
select ok((select last_seen_at is null from profiles where id = :'ana'), 'last_seen_at starts null');
select tests.act_as(:'ana');
select throws_ok(format('update profiles set last_seen_at = now() where id = %L', :'ana'), '42501', null,
  'authenticated cannot write last_seen_at');
select lives_ok('select public.touch_last_seen()', 'touch_last_seen runs');
select tests.act_as_superuser();
select ok((select last_seen_at is not null from profiles where id = :'ana'), 'touch sets last_seen_at when null');
update profiles set last_seen_at = now() - interval '30 minutes' where id = :'ana';
select last_seen_at as t30 from profiles where id = :'ana' \gset
select tests.act_as(:'ana');
select public.touch_last_seen();
select tests.act_as_superuser();
select is((select last_seen_at from profiles where id = :'ana'), :'t30'::timestamptz,
  'a second touch within the hour changes nothing');
update profiles set last_seen_at = now() - interval '2 hours' where id = :'ana';
select last_seen_at as t120 from profiles where id = :'ana' \gset
select tests.act_as(:'ana');
select public.touch_last_seen();
select tests.act_as_superuser();
select ok((select last_seen_at > :'t120'::timestamptz from profiles where id = :'ana'),
  'a touch after two hours moves last_seen_at');

-- anon cannot execute
select tests.act_as_anon();
select throws_ok('select public.touch_last_seen()', '42501', null, 'anon cannot touch_last_seen');
select throws_ok('select public.export_my_data()', '42501', null, 'anon cannot export_my_data');
select throws_ok('select public.delete_my_account()', '42501', null, 'anon cannot delete_my_account');
select tests.act_as_superuser();

-- export
select tests.act_as(:'ana');
select public.export_my_data()::text as exp \gset
select tests.act_as_superuser();
select is((:'exp'::jsonb)->'profile'->>'first_name', 'Ana', 'export has the profile');
select is(jsonb_array_length((:'exp'::jsonb)->'interests'), 1, 'export has the interests');
select is(jsonb_array_length((:'exp'::jsonb)->'category_requests'), 1, 'export has the category request');
select ok(not (:'exp' like '%' || :'ben' || '%'), 'export mentions nobody else');
select ok((:'exp'::jsonb) ?& array['profile','interests','category_requests','activities_organised','memberships',
  'interests_in_activities','attendances','messages_sent','reports_filed','blocks','saved_searches',
  'association_waiters','association_claims','feedback_sent'], 'export has every key');

-- storage
select ok(exists (select 1 from storage.buckets where id = 'avatars' and public
  and file_size_limit = 1048576 and allowed_mime_types = '{image/jpeg}'), 'avatars bucket configured');
select tests.act_as(:'ana');
select lives_ok(format($q$insert into storage.objects (bucket_id, name, owner) values ('avatars', %L, %L)$q$,
  :'ana' || '/x.jpg', :'ana'), 'Ana can upload into her folder');
select throws_ok(format($q$insert into storage.objects (bucket_id, name, owner) values ('avatars', %L, %L)$q$,
  :'ben' || '/x.jpg', :'ana'), '42501', null, 'Ana cannot upload into Ben''s folder');
select tests.act_as_superuser();

-- deletion
insert into storage.objects (bucket_id, name) values ('avatars', :'ana' || '/a.jpg'), ('avatars', :'ben' || '/b.jpg');
select tests.act_as(:'ana');
select public.delete_my_account();
select tests.act_as_superuser();
select is((select count(*) from auth.users where id = :'ana')
  + (select count(*) from profiles where id = :'ana')
  + (select count(*) from user_interests where user_id = :'ana')
  + (select count(*) from category_requests where user_id = :'ana')
  + (select count(*) from storage.objects where bucket_id = 'avatars' and name like :'ana' || '/%'), 0::bigint,
  'Ana''s account, rows and avatars are gone');
select is((select count(*) from auth.users where id = :'ben') + (select count(*) from user_interests where user_id = :'ben')
  + (select count(*) from storage.objects where bucket_id = 'avatars' and name = :'ben' || '/b.jpg'), 3::bigint,
  'Ben is untouched');
select isnt(tests.create_user('ana@acc.fr', 'Ana'), :'ana'::uuid, 'the email can be reused with a new id');

select * from finish();
rollback;
