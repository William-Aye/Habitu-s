begin;
\ir helpers.inc
select plan(51);

select tests.create_user('ana@acc.fr', 'Ana') as ana \gset
select tests.create_user('ben@acc.fr', 'Ben') as ben \gset

insert into categories (id, slug, name_fr, name_en, icon)
values ('00000000-0000-0000-0000-00000000ac01', 'acc-cat', 'Randonnée', 'Hiking', 'mountain');
insert into user_interests (user_id, category_id, level)
values (:'ana', '00000000-0000-0000-0000-00000000ac01', 'love'),
       (:'ben', '00000000-0000-0000-0000-00000000ac01', 'like');
insert into category_requests (user_id, requested_name) values (:'ana', 'Pétanque nocturne');

update profiles set phone_verified = true where id = :'ana';
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
values ('00000000-0000-0000-0000-00000000ac0a', :'ana', '00000000-0000-0000-0000-00000000ac01', 'Sortie rando',
        'Lyon', 'SRID=4326;POINT(4.83 45.76)', 'weekly', current_date, '10:00');
insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-00000000ac0a', :'ben');
insert into sessions (id, activity_id, starts_at)
values ('00000000-0000-0000-0000-00000000ac5e', '00000000-0000-0000-0000-00000000ac0a', now() - interval '1 day');
insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-00000000ac5e', :'ana', 'confirmed');
insert into ambiance_words (id, slug, label_fr, label_en)
values ('00000000-0000-0000-0000-00000000ac0b', 'acc-word', 'Chaleureuse', 'Warm');
insert into session_feedback (session_id, user_id, went_well, ambiance_word_ids)
values ('00000000-0000-0000-0000-00000000ac5e', :'ana', true, '{00000000-0000-0000-0000-00000000ac0b}');
insert into messages (sender_id, recipient_id, body) values (:'ana', :'ben', 'salut-de-ana');
insert into messages (sender_id, recipient_id, body) values (:'ben', :'ana', 'secret-de-ben-dm');
insert into messages (sender_id, activity_id, body) values (:'ben', '00000000-0000-0000-0000-00000000ac0a', 'secret-de-ben-groupe');
insert into blocks (blocker_id, blocked_id) values (:'ana', :'ben');
insert into reports (reporter_id, target_type, target_id, reason) values (:'ana', 'user', :'ben', 'other');
insert into saved_searches (user_id, query, center, radius_km) values (:'ana', 'rando', 'SRID=4326;POINT(4.83 45.76)', 10);
insert into feedback (user_id, type, body) values (:'ana', 'idea', 'une idée');
insert into safety_tips_seen (user_id, tip_id) values (:'ana', 'tip1');
insert into notification_log (user_id, kind) values (:'ana', 'digest');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
values ('00000000-0000-0000-0000-00000000ac0c', :'ben', '00000000-0000-0000-0000-00000000ac01', 'Sortie de Ben',
        'Lyon', 'SRID=4326;POINT(4.83 45.76)', 'weekly', current_date, '11:00');
insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-00000000ac0c', :'ana');
insert into activity_interests (activity_id, user_id) values ('00000000-0000-0000-0000-00000000ac0c', :'ana');
insert into associations (id, name, source, confidence, location)
values ('00000000-0000-0000-0000-00000000ac0d', 'Asso test', 'rna', 60, 'SRID=4326;POINT(4.8 45.7)');
insert into association_waiters (association_id, user_id) values ('00000000-0000-0000-0000-00000000ac0d', :'ana');
insert into association_claims (association_id, claimant_id, proof_method)
values ('00000000-0000-0000-0000-00000000ac0d', :'ana', 'document');
insert into organiser_stats (user_id, sessions_held) values (:'ana', 4)
on conflict (user_id) do update set sessions_held = 4;

-- home-area snapping
select tests.act_as(:'ana');
update profiles set home_area = 'SRID=4326;POINT(4.83574 45.76402)' where id = :'ana';
select is((select ST_AsText(home_area::geometry) from profiles where id = :'ana'), 'POINT(4.84 45.76)',
  'update snaps home_area to the 0.01 degree grid');
select tests.act_as_superuser();
select tests.create_user('cleo@acc.fr', 'Cleo') as cleo \gset
delete from profiles where id = :'cleo';
insert into profiles (id, first_name, home_area) values (:'cleo', 'Cleo', 'SRID=4326;POINT(2.35219 48.85661)');
select is((select ST_AsText(home_area::geometry) from profiles where id = :'cleo'), 'POINT(2.35 48.86)',
  'insert snaps home_area too');

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
insert into auth.identities (provider_id, user_id, identity_data, provider)
values (:'ana', :'ana', '{}', 'email'), (:'ana', :'ana', '{}', 'google');
select tests.act_as(:'ana');
select public.export_my_data()::text as exp \gset
select tests.act_as_superuser();
select is((:'exp'::jsonb)->'profile'->>'first_name', 'Ana', 'export has the profile');
select is((:'exp'::jsonb)->'account'->>'email', 'ana@acc.fr', 'export has the account email');
select ok((:'exp'::jsonb)->'account'->>'created_at' is not null, 'export has the account creation date');
select ok((:'exp'::jsonb)->'account' ? 'last_sign_in_at', 'export has the last sign-in key');
select is((:'exp'::jsonb)->'account'->'providers', '["email","google"]'::jsonb, 'export lists the provider names');
select is(jsonb_array_length((:'exp'::jsonb)->'interests'), 1, 'export has the interests');
select is(jsonb_array_length((:'exp'::jsonb)->'category_requests'), 1, 'export has the category request');
select ok(not (:'exp' like '%secret-de-ben%'), 'Ben''s message bodies are absent');
select is((select count(*) from regexp_matches(:'exp', :'ben', 'g')), 3::bigint,
  'Ben''s id appears only as recipient, blocked user and report target');
select is((:'exp'::jsonb)->'messages_sent'->0->>'recipient_id', :'ben', 'recipient_id is the DM target');
select is((:'exp'::jsonb)->'blocks'->0->>'blocked_id', :'ben', 'blocked_id is the blocked user');
select is((:'exp'::jsonb)->'reports_filed'->0->>'target_id', :'ben', 'target_id is the reported user');
select is(jsonb_array_length((:'exp'::jsonb)->'activities_organised'), 1, 'export has organised activities');
select is(jsonb_array_length((:'exp'::jsonb)->'attendances'), 1, 'export has attendances');
select is(jsonb_array_length((:'exp'::jsonb)->'saved_searches'), 1, 'export has saved searches');
select is(jsonb_array_length((:'exp'::jsonb)->'feedback_sent'), 1, 'export has feedback');
select is(jsonb_array_length((:'exp'::jsonb)->'safety_tips_seen'), 1, 'export has safety tips seen');
select is(jsonb_array_length((:'exp'::jsonb)->'notification_log'), 1, 'export has the notification log');
select is((:'exp'::jsonb)->'session_feedback_sent'->0->>'went_well', 'true', 'export has Ana''s session feedback');
select is((:'exp'::jsonb)->'session_feedback_sent'->0->'ambiance_word_ids'->>0, '00000000-0000-0000-0000-00000000ac0b',
  'session feedback carries the ambiance words');
select is(jsonb_array_length((:'exp'::jsonb)->'memberships'), 1, 'export has memberships');
select is(jsonb_array_length((:'exp'::jsonb)->'interests_in_activities'), 1, 'export has activity interests');
select is(jsonb_array_length((:'exp'::jsonb)->'association_waiters'), 1, 'export has association waiters');
select is(jsonb_array_length((:'exp'::jsonb)->'association_claims'), 1, 'export has association claims');
select is((:'exp'::jsonb)->'organiser_stats'->>'sessions_held', '4', 'export has organiser stats');
select ok((:'exp'::jsonb) ?& array['account','profile','interests','category_requests','activities_organised','memberships',
  'interests_in_activities','attendances','messages_sent','reports_filed','blocks','saved_searches',
  'association_waiters','association_claims','feedback_sent','session_feedback_sent','safety_tips_seen',
  'notification_log'], 'export has every key');

-- storage
select ok(exists (select 1 from storage.buckets where id = 'avatars' and public
  and file_size_limit = 1048576 and allowed_mime_types = '{image/jpeg}'), 'avatars bucket configured');
select tests.act_as(:'ana');
select lives_ok(format($q$insert into storage.objects (bucket_id, name, owner) values ('avatars', %L, %L)$q$,
  :'ana' || '/x.jpg', :'ana'), 'Ana can upload into her folder');
select throws_ok(format($q$insert into storage.objects (bucket_id, name, owner) values ('avatars', %L, %L)$q$,
  :'ben' || '/x.jpg', :'ana'), '42501', null, 'Ana cannot upload into Ben''s folder');
select tests.act_as_superuser();
insert into storage.objects (bucket_id, name, owner) values ('avatars', :'ana' || '/own.jpg', :'ana');
select tests.act_as(:'ana');
select is((select count(*) from storage.objects where bucket_id = 'avatars' and name = :'ana' || '/own.jpg'), 1::bigint,
  'Ana can read her own file (upsert needs select)');
select tests.act_as(:'ben');
select is((select count(*) from storage.objects where bucket_id = 'avatars' and name like :'ana' || '/%'), 0::bigint,
  'Ben cannot list Ana''s folder');
with u as (update storage.objects set name = name where bucket_id = 'avatars' and name = :'ana' || '/own.jpg' returning 1)
select is((select count(*) from u), 0::bigint, 'Ben cannot update Ana''s file');
select set_config('storage.allow_delete_query', 'true', true);
with d as (delete from storage.objects where bucket_id = 'avatars' and name = :'ana' || '/own.jpg' returning 1)
select is((select count(*) from d), 0::bigint, 'Ben cannot delete Ana''s file');
select tests.act_as_superuser();
select is((select count(*) from storage.objects where bucket_id = 'avatars' and name = :'ana' || '/own.jpg'), 1::bigint,
  'Ana''s file survives');

-- positive control: Ana can update and delete her own avatar
select tests.act_as_superuser();
insert into storage.objects (bucket_id, name, owner) values ('avatars', :'ana' || '/pc.jpg', :'ana');
select tests.act_as(:'ana');
with u as (update storage.objects set name = name where bucket_id = 'avatars' and name = :'ana' || '/pc.jpg' returning 1)
select is((select count(*) from u), 1::bigint, 'Ana can update her own file');
with d as (delete from storage.objects where bucket_id = 'avatars' and name = :'ana' || '/pc.jpg' returning 1)
select is((select count(*) from d), 1::bigint, 'Ana can delete her own file');
select tests.act_as_superuser();

-- backfill statement of the migration, replayed on a pre-existing unsnapped value
alter table profiles disable trigger profiles_snap_home_area;
update profiles set home_area = 'SRID=4326;POINT(5.12345 43.29876)' where id = :'ben';
alter table profiles enable trigger profiles_snap_home_area;
update public.profiles set home_area = home_area where home_area is not null;
select is((select ST_AsText(home_area::geometry) from profiles where id = :'ben'), 'POINT(5.12 43.3)',
  'backfill snaps pre-existing home areas');

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
