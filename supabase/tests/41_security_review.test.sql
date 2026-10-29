-- Pre-launch security review (Task 4, database batch): one section per finding.
begin;
\ir helpers.inc
select plan(31);
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

select * from finish();
rollback;
