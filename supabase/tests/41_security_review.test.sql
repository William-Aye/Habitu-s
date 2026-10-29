-- Pre-launch security review (Task 4, database batch): one section per finding.
begin;
\ir helpers.inc
select plan(50);
select tests.create_user('org@sr.fr', 'Orla') as org \gset
select tests.create_user('mem@sr.fr', 'Malo') as mem \gset
select tests.create_user('out@sr.fr', 'Oscar') as out \gset
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000f1', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go du soir', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00');
insert into activity_members (activity_id, user_id, status) values ('00000000-0000-0000-0000-0000000000f1', :'mem', 'member');
update activities set welcome_member_id = :'mem' where id = '00000000-0000-0000-0000-0000000000f1';

-- ---- DB-1: the welcome member (a member of the activity) is never readable from the table -------
select tests.act_as_anon();
select throws_ok($$ select welcome_member_id from activities $$, '42501', null, 'DB-1: anon cannot read activities.welcome_member_id');
select is((select title from activities where id = '00000000-0000-0000-0000-0000000000f1'), 'Go du soir', 'DB-1: anon still reads the public columns');
select tests.act_as(:'out');
select throws_ok($$ select welcome_member_id from activities $$, '42501', null, 'DB-1: a signed-in stranger cannot read activities.welcome_member_id');
select tests.act_as(:'mem');
select is(get_activity('00000000-0000-0000-0000-0000000000f1')->>'welcome_first_name', 'Malo', 'DB-1: members still get the welcome person through get_activity');
select tests.act_as(:'org');
select lives_ok($$ update activities set welcome_member_id = null where id = '00000000-0000-0000-0000-0000000000f1' $$, 'DB-1: the organiser still sets the welcome person');
select tests.act_as_superuser();

-- ---- APP-1 / DB-6: photo_url only ever points at the person's own avatar object ---------------------
select tests.act_as(:'mem');
select throws_ok($$ update profiles set photo_url = 'https://attacker.example/p.gif?u=me' where id = auth.uid() $$, '23514', null,
  'APP-1: photo_url refuses an outside URL');
select throws_ok(format($$ update profiles set photo_url = %L where id = auth.uid() $$, :'org' || '/' || md5('x') || '.jpg'), '23514', null,
  'APP-1: photo_url refuses another person''s avatar');
select throws_ok($$ update profiles set photo_url = repeat('x', 2000000) where id = auth.uid() $$, '23514', null,
  'APP-1: photo_url refuses a huge value');
select throws_ok(format($$ update profiles set photo_url = %L where id = auth.uid() $$, :'mem' || '/avatar.jpg'), '23514', null,
  'APP-1: photo_url refuses the old guessable name');
select lives_ok(format($$ update profiles set photo_url = %L where id = auth.uid() $$, :'mem' || '/' || md5('first') || '.jpg'),
  'APP-1: photo_url takes the person''s own random-named avatar');
select lives_ok($$ update profiles set photo_url = null where id = auth.uid() $$, 'APP-1: photo_url can be cleared');

-- ---- APP-2 / ruling H: avatar names are unguessable, one folder per person, a few files at most -----
select throws_ok(format($q$insert into storage.objects (bucket_id, name, owner) values ('avatars', %L, auth.uid())$q$, :'mem' || '/avatar.jpg'),
  '42501', null, 'APP-2: the guessable avatar.jpg name is refused');
select throws_ok(format($q$insert into storage.objects (bucket_id, name, owner) values ('avatars', %L, auth.uid())$q$, :'mem' || '/payload.jpg'),
  '42501', null, 'APP-2: any other free-form name is refused');
select lives_ok(format($q$insert into storage.objects (bucket_id, name, owner) values ('avatars', %L, auth.uid())$q$, :'mem' || '/' || md5('first') || '.jpg'),
  'APP-2: a random 32-hex name in the own folder is accepted');
select throws_ok(format($q$insert into storage.objects (bucket_id, name, owner) values ('avatars', %L, auth.uid())$q$, :'org' || '/' || md5('y') || '.jpg'),
  '42501', null, 'APP-2: another person''s folder is still refused');
with u as (update storage.objects set name = name where bucket_id = 'avatars' and name = :'mem' || '/' || md5('first') || '.jpg' returning 1)
select is((select count(*)::int from u), 0, 'APP-2: avatar files cannot be overwritten (no update policy)');
select lives_ok(format($q$insert into storage.objects (bucket_id, name, owner) select 'avatars', %L || '/' || md5('n' || g) || '.jpg', auth.uid() from generate_series(1, 4) g$q$, :'mem'),
  'APP-2: up to five avatar files at once');
select throws_ok(format($q$insert into storage.objects (bucket_id, name, owner) values ('avatars', %L, auth.uid())$q$, :'mem' || '/' || md5('sixth') || '.jpg'),
  '42501', null, 'APP-2: a sixth avatar file is refused');
-- choosing a photo queues every other file of the folder for deletion
update profiles set photo_url = :'mem' || '/' || md5('first') || '.jpg' where id = auth.uid();
select tests.act_as_superuser();
select is((select count(*)::int from storage_deletions where bucket = 'avatars' and path like :'mem' || '/%'), 4,
  'APP-2: setting a photo queues the four other files');
select is((select count(*)::int from storage_deletions where bucket = 'avatars' and path = :'mem' || '/' || md5('first') || '.jpg'), 0,
  'APP-2: the chosen photo is not queued');
select tests.act_as(:'mem');
select lives_ok(format($q$insert into storage.objects (bucket_id, name, owner) select 'feedback-screenshots', %L || '/' || g || '.jpg', auth.uid() from generate_series(1, 10) g$q$, :'mem'),
  'APP-2: ten screenshots a day');
select throws_ok(format($q$insert into storage.objects (bucket_id, name, owner) values ('feedback-screenshots', %L, auth.uid())$q$, :'mem' || '/11.jpg'),
  '42501', null, 'APP-2: the eleventh screenshot of the day is refused');
select tests.act_as_superuser();

-- ---- DB-2: no person id reaches anon (organisers included) -----------------------------------------
insert into collectifs (id, name, description, town_label, town_point, created_by) values
  ('00000000-0000-0000-0000-00000000c0a1', 'Les joueurs', 'Go entre amis', 'Lyon', 'POINT(4.85 45.76)', :'org');
select tests.act_as_anon();
select is(get_activity('00000000-0000-0000-0000-0000000000f1')->'organiser', '{}'::jsonb, 'DB-2: anon gets no organiser id from get_activity');
select throws_ok($$ select organiser_id from activities $$, '42501', null, 'DB-2: anon cannot read activities.organiser_id');
select throws_ok($$ select user_id from collectif_members $$, '42501', null, 'DB-2: anon cannot list collectif organisers');
select throws_ok($$ select created_by from collectifs $$, '42501', null, 'DB-2: anon cannot read collectifs.created_by');
select is((select name from collectifs where id = '00000000-0000-0000-0000-00000000c0a1'), 'Les joueurs', 'DB-2: anon still reads the collectif''s public columns');
select throws_ok($$ select user_id from organiser_badges $$, '42501', null, 'DB-2: anon cannot list organisers through organiser_badges');
select tests.act_as(:'out');
select throws_ok($$ select user_id from organiser_badges $$, '42501', null, 'DB-2: nor can a signed-in user (badges are not in Release 1)');
select is((select array_agg(k order by k) from jsonb_object_keys(get_activity('00000000-0000-0000-0000-0000000000f1')->'organiser') k),
  array['first_name', 'id', 'photo_url'], 'DB-2: signed-in people still see the organiser');
select is((select count(*)::int from collectif_members where collectif_id = '00000000-0000-0000-0000-00000000c0a1'), 1, 'DB-2: signed-in people still see a collectif''s organisers');
select tests.act_as_superuser();

-- ---- DB-3: session edits cannot flood attendees with pushes; session writes are limited ----------
select id as s1 from sessions where activity_id = '00000000-0000-0000-0000-0000000000f1' and starts_at > now() order by starts_at limit 1 \gset
insert into attendances (session_id, user_id, status) values (:'s1', :'mem', 'confirmed');
select set_config('sr.s1', :'s1', false);
select tests.act_as(:'org');
select lives_ok(format($$ update sessions set place_label = 'Lieu 1' where id = %L $$, :'s1'), 'DB-3: the organiser moves a session');
select tests.act_as_superuser();
select is((select count(*)::int from notification_outbox where user_id = :'mem' and kind = 'session_moved'), 1, 'DB-3: the attendee is told once');
select tests.act_as(:'org');
do $$ begin for i in 2..30 loop update sessions set place_label = 'Lieu ' || i where id = current_setting('sr.s1')::uuid; end loop; end $$;
update activities set place_label = 'Autre cafe' where id = '00000000-0000-0000-0000-0000000000f1';
update activities set place_label = 'Encore un autre' where id = '00000000-0000-0000-0000-0000000000f1';
select tests.act_as_superuser();
select is((select count(*)::int from notification_outbox where user_id = :'mem' and kind = 'session_moved' and data ->> 'session_id' = :'s1'), 1,
  'DB-3: thirty more edits of the same session within minutes send no more pushes');
select tests.act_as(:'org');
select throws_ok($$ insert into sessions (activity_id, starts_at)
  select '00000000-0000-0000-0000-0000000000f1', now() + (g || ' hours')::interval from generate_series(1, 5000) g $$,
  '42501', 'limit_reached', 'DB-3: a bulk insert of thousands of sessions is refused');
select throws_ok($$ insert into sessions (activity_id, starts_at)
  select '00000000-0000-0000-0000-0000000000f1', now() + (g || ' hours')::interval from generate_series(1, 31) g $$,
  '42501', 'limit_reached', 'DB-3: at most 60 session writes an hour (30 already used)');
select tests.act_as_superuser();
delete from limit_log where user_id = :'org';
select tests.act_as(:'org');
select lives_ok($$ insert into sessions (activity_id, starts_at) values ('00000000-0000-0000-0000-0000000000f1', now() + interval '3 hours 30 minutes') $$,
  'DB-3: the organiser still adds a session');
select tests.act_as_superuser();
insert into sessions (activity_id, starts_at)
select '00000000-0000-0000-0000-0000000000f1', now() + interval '400 days' + (g || ' hours')::interval from generate_series(1, 100) g;
delete from limit_log where user_id = :'org';
select tests.act_as(:'org');
select throws_ok($$ insert into sessions (activity_id, starts_at) values ('00000000-0000-0000-0000-0000000000f1', now() + interval '4 hours 30 minutes') $$,
  '42501', 'limit_reached', 'DB-3: an activity holds at most 100 future sessions');
select tests.act_as_superuser();

-- ---- FN-1 / DB-8: push tokens are Expo tokens, five per person at most ---------------------------
select tests.act_as(:'out');
select throws_ok($$ select public.register_push_token('garbage-not-expo-1', 'android') $$, '22023', null, 'FN-1: a junk token is refused');
select throws_ok($$ select public.register_push_token('ExponentPushToken[aaaaaaaaaa] trailing', 'android') $$, '22023', null, 'FN-1: a token with extra text is refused');
select throws_ok($$ select public.register_push_token('ExponentPushToken[aaaaaaaaaa]', 'web') $$, '22023', null, 'FN-1: an unknown platform is refused');
select lives_ok($$ select public.register_push_token('ExpoPushToken[' || g || 'bbbbbbbbbb]', 'android') from generate_series(1, 7) g $$,
  'FN-1: registering seven devices works');
select is((select count(*)::int from push_tokens where user_id = auth.uid()), 5, 'FN-1: only the five most recent tokens are kept');
select is((select count(*)::int from push_tokens where user_id = auth.uid() and token = 'ExpoPushToken[7bbbbbbbbbb]'), 1, 'FN-1: the newest token is among them');
select tests.act_as_superuser();

-- ---- WEB-2: a sitemap call covers one fixed bucket, never a range the caller picks -----------------
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('1f000000-0000-4000-8000-000000000001', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go bucket 1', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00');
select tests.act_as_anon();
select is(to_regprocedure('public.web_sitemap_range(text,uuid,uuid)'), null, 'WEB-2: the open-range signature is gone');
select is((select jsonb_agg(e->>'id') from jsonb_array_elements(public.web_sitemap_range('activities', 1)) e),
  '["1f000000-0000-4000-8000-000000000001"]'::jsonb, 'WEB-2: activities bucket 1 is the ids starting with 1');
select is((select count(*)::int from jsonb_array_elements(public.web_sitemap_range('activities', 0)) e where e->>'id' like '1f%'), 0,
  'WEB-2: bucket 0 does not include them');
select throws_ok($$ select public.web_sitemap_range('activities', 16) $$, '22023', null, 'WEB-2: activities have 16 buckets');
select throws_ok($$ select public.web_sitemap_range('associations', 256) $$, '22023', null, 'WEB-2: associations have 256 buckets');
select throws_ok($$ select public.web_sitemap_range('associations', null) $$, '22023', null, 'WEB-2: no bucket, no listing');
select tests.act_as_superuser();

select * from finish();
rollback;
