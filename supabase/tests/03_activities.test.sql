begin;
\ir helpers.inc
select plan(44);
select tests.create_user('org@test.fr', 'Julie', true) as org \gset
select tests.create_user('newbie@test.fr', 'Sam', false) as newbie \gset
select tests.create_user('other@test.fr', 'Max', true) as other \gset
select tests.create_user('root@test.fr', 'Root', true) as root \gset
select tests.create_user('stranger@test.fr', 'Zoe', true) as stranger \gset
update profiles set role = 'admin' where id = :'root';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
insert into tags (id, slug, label_fr, label_en) values ('00000000-0000-0000-0000-0000000000b1', 'go', 'Go', 'Go');
-- fixture: approval activity f2 (org), other's activity f3
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, approval_mode) values
  ('00000000-0000-0000-0000-0000000000f2', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go sur invitation', 'Chez Julie', 'POINT(4.85 45.77)', 'weekly', '2026-11-04', '19:00', 'approval'),
  ('00000000-0000-0000-0000-0000000000f3', :'other', '00000000-0000-0000-0000-0000000000c1', 'Echecs du jeudi', 'Bar', 'POINT(4.85 45.77)', 'weekly', '2026-11-05', '19:00', 'open');
insert into activity_tags (activity_id, tag_id) values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b1');

-- structure
select is(has_table_privilege('authenticated', 'public.activities', 'TRUNCATE'), false, 'authenticated cannot truncate activities');
select is(has_table_privilege('anon', 'public.attendances', 'TRUNCATE'), false, 'anon cannot truncate attendances');
select has_index('public', 'activities', 'activities_place_gist', 'GiST on place');
select has_index('public', 'activities', 'activities_embedding_hnsw', 'HNSW on embedding');
select has_index('public', 'sessions', 'sessions_activity_starts', 'sessions index');

select tests.act_as(:'newbie');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Go le mardi', 'Café du Parc', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00') $$,
  '42501', null, 'phone not verified cannot create activity');

select tests.act_as(:'org');
select lives_ok($$ insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
  values ('00000000-0000-0000-0000-0000000000f1', auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Go le mardi', 'Café du Parc', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00') $$,
  'verified organiser creates activity');
select is((select approval_mode from activities where id = '00000000-0000-0000-0000-0000000000f1'), 'open', 'open to all by default');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Bad', 'X', 'POINT(4.85 45.77)', 'every_n_days', '2026-11-03', '19:00') $$,
  '23514', null, 'every_n_days requires interval');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, recurrence_weekdays, start_date, start_time)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Bad', 'X', 'POINT(4.85 45.77)', 'weekdays', '{}', '2026-11-03', '19:00') $$,
  '23514', null, 'weekdays with empty array rejected');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, recurrence_interval_days, start_date, start_time)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Bad', 'X', 'POINT(4.85 45.77)', 'weekly', 7, '2026-11-03', '19:00') $$,
  '23514', null, 'weekly with interval rejected');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, min_participants, max_size)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Bad', 'X', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00', 10, 5) $$,
  '23514', null, 'min_participants > max_size rejected');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c1', 'Pour autrui', 'X', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00') $$,
  '42501', null, 'cannot create activity for someone else');
insert into sessions (id, activity_id, starts_at) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', '2026-11-03 19:00+01');

-- organiser update own; others affect 0 rows
select lives_ok($$ update activities set title = 'Go du mardi soir' where id = '00000000-0000-0000-0000-0000000000f1' $$, 'organiser updates own activity');
select is((select title from activities where id = '00000000-0000-0000-0000-0000000000f1'), 'Go du mardi soir', 'update applied');
select tests.act_as(:'other');
update activities set title = 'Hacked' where id = '00000000-0000-0000-0000-0000000000f1';
delete from activities where id = '00000000-0000-0000-0000-0000000000f1';
select is((select title from activities where id = '00000000-0000-0000-0000-0000000000f1'), 'Go du mardi soir', 'other user cannot update/delete (0 rows)');
select throws_ok($$ insert into sessions (activity_id, starts_at) values ('00000000-0000-0000-0000-0000000000f1', '2026-11-10 19:00+01') $$,
  '42501', null, 'non-organiser cannot insert sessions');

select tests.act_as_anon();
select is((select count(*) from activities)::int, 3, 'anon reads activities');
select is((select count(*) from sessions)::int, 1, 'anon reads sessions');
select is((select count(*) from activity_tags)::int, 1, 'anon reads activity_tags');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c1', 'Anon', 'X', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00') $$,
  '42501', null, 'anon cannot insert activities');
select throws_ok($$ insert into sessions (activity_id, starts_at) values ('00000000-0000-0000-0000-0000000000f1', '2026-11-10 19:00+01') $$, '42501', null, 'anon cannot insert sessions');
select throws_ok($$ select * from activity_members $$, '42501', null, 'anon cannot read members');
select throws_ok($$ select * from activity_interests $$, '42501', null, 'anon cannot read interests');
select throws_ok($$ select * from attendances $$, '42501', null, 'anon cannot read attendances');

-- newbie: membership + attendance
select tests.act_as(:'newbie');
select throws_ok($$ insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-0000000000e1', auth.uid(), 'confirmed') $$,
  '42501', null, 'non-member cannot confirm');
select throws_ok(format($$ insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', %L) $$, :'other'),
  '42501', null, 'cannot insert membership for someone else');
insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', :'newbie');
insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f2', :'newbie');
select is((select status from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f1' and user_id = :'newbie'), 'member', 'open activity: member');
select is((select status from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f2' and user_id = :'newbie'), 'pending', 'approval activity: pending');
update activity_members set status = 'member' where activity_id = '00000000-0000-0000-0000-0000000000f2';
select is((select status from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f2' and user_id = :'newbie'), 'pending', 'pending user cannot self-approve (0 rows)');
select lives_ok($$ insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-0000000000e1', auth.uid(), 'confirmed') $$,
  'member confirms attendance');
select throws_ok($$ update attendances set status = 'no_show' where user_id = auth.uid() $$, '42501', null, 'participant cannot set no_show');
select is((select count(*) from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f1')::int, 1, 'member sees co-members');

-- stranger: non-member
select tests.act_as(:'stranger');
select is((select count(*) from activity_members)::int, 0, 'non-member sees 0 memberships');
select is((select count(*) from attendances)::int, 0, 'non-member sees 0 attendances');

-- interests
select tests.act_as(:'newbie');
insert into activity_interests (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', :'newbie');
select throws_ok(format($$ insert into activity_interests (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', %L) $$, :'other'),
  '42501', null, 'cannot register interest for someone else');
select tests.act_as(:'stranger');
select is((select count(*) from activity_interests)::int, 0, 'interests are own-only');
select tests.act_as(:'org');
select is((select count(*) from activity_interests)::int, 1, 'organiser reads interests for own activity');

-- organiser manages members and no_show
select lives_ok($$ update activity_members set status = 'member' where activity_id = '00000000-0000-0000-0000-0000000000f2' $$, 'organiser approves pending');
select is((select status from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f2'), 'member', 'approval applied');
select lives_ok($$ update attendances set status = 'no_show' where session_id = '00000000-0000-0000-0000-0000000000e1' $$, 'organiser marks no_show');
select is((select status from attendances where session_id = '00000000-0000-0000-0000-0000000000e1'), 'no_show', 'no_show applied');

-- admin
select tests.act_as(:'root');
select lives_ok($$ update activities set title = 'Admin edit' where id = '00000000-0000-0000-0000-0000000000f3' $$, 'admin updates any activity');
select is((select title from activities where id = '00000000-0000-0000-0000-0000000000f3'), 'Admin edit', 'admin update applied');

select * from finish();
rollback;
