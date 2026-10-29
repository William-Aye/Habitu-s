begin;
\ir helpers.inc
select plan(85);
select tests.create_user('org@test.fr', 'Julie', true) as org \gset
select tests.create_user('newbie@test.fr', 'Sam', false) as newbie \gset
select tests.create_user('other@test.fr', 'Max', true) as other \gset
select tests.create_user('root@test.fr', 'Root', true) as root \gset
select tests.create_user('stranger@test.fr', 'Zoe', true) as stranger \gset
update profiles set role = 'admin' where id = :'root';
update profiles set age_confirmed = true, created_at = now() - interval '2 days' where id <> :'newbie';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
insert into tags (id, slug, label_fr, label_en) values ('00000000-0000-0000-0000-0000000000b1', 'go', 'Go', 'Go');
-- fixture: approval activity f2 (org), other's activity f3
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, approval_mode) values
  ('00000000-0000-0000-0000-0000000000f2', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go sur invitation', 'Chez Julie', 'POINT(4.85 45.77)', 'weekly', '2026-11-04', '19:00', 'approval'),
  ('00000000-0000-0000-0000-0000000000f3', :'other', '00000000-0000-0000-0000-0000000000c1', 'Echecs du jeudi', 'Bar', 'POINT(4.85 45.77)', 'weekly', '2026-11-05', '19:00', 'open');
insert into activity_tags (activity_id, tag_id) values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b1');

insert into associations (id, name, source, verified, claimed_by) values
  ('00000000-0000-0000-0000-0000000000a1', 'Club verifie autre', 'rna', true, :'other'),
  ('00000000-0000-0000-0000-0000000000a2', 'Club libre', 'community', false, null),
  ('00000000-0000-0000-0000-0000000000a3', 'Club de Julie', 'rna', true, :'org');

-- structure
select is(has_table_privilege('authenticated', 'public.activities', 'TRUNCATE'), false, 'authenticated cannot truncate activities');
select is(has_table_privilege('anon', 'public.attendances', 'TRUNCATE'), false, 'anon cannot truncate attendances');
select has_index('public', 'activities', 'activities_place_gist', 'GiST on place');
-- No HNSW index: search_explore never uses it (decision 5 of docs/plans/2026-10-22-query-vocabulary.md).
select hasnt_index('public', 'activities', 'activities_embedding_hnsw', 'no HNSW on embedding');
select has_index('public', 'sessions', 'sessions_activity_starts', 'sessions index');

select tests.act_as(:'newbie');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Go le mardi', 'Café du Parc', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00') $$,
  '42501', null, 'a new account cannot create an activity');

select tests.act_as(:'org');
select lives_ok($$ insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
  values ('00000000-0000-0000-0000-0000000000f1', auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Go le mardi', 'Café du Parc', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00') $$,
  'verified organiser creates activity');
select lives_ok($$ update activities set organised_by_association_id = '00000000-0000-0000-0000-0000000000a2' where id = '00000000-0000-0000-0000-0000000000f1' $$, 'link unverified association');
select throws_ok($$ update activities set organised_by_association_id = '00000000-0000-0000-0000-0000000000a1' where id = '00000000-0000-0000-0000-0000000000f1' $$, '42501', null, 'cannot link verified association claimed by someone else');
select lives_ok($$ update activities set organised_by_association_id = '00000000-0000-0000-0000-0000000000a3' where id = '00000000-0000-0000-0000-0000000000f1' $$, 'claimant links own verified association');
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
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, recurrence_weekdays, start_date, start_time)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Bad', 'X', 'POINT(4.85 45.77)', 'weekdays', '{0,8}', '2026-11-03', '19:00') $$,
  '23514', null, 'weekdays outside 1..7 rejected');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, recurrence_interval_days, recurrence_weekdays, start_date, start_time)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Bad', 'X', 'POINT(4.85 45.77)', 'every_n_days', 3, '{1}', '2026-11-03', '19:00') $$,
  '23514', null, 'every_n_days with weekdays rejected');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, recurrence_interval_days, recurrence_weekdays, start_date, start_time)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Bad', 'X', 'POINT(4.85 45.77)', 'weekdays', 3, '{1}', '2026-11-03', '19:00') $$,
  '23514', null, 'weekdays with interval rejected');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, min_participants, max_size)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Bad', 'X', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00', 10, 5) $$,
  '23514', null, 'min_participants > max_size rejected');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c1', 'Pour autrui', 'X', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00') $$,
  '42501', null, 'cannot create activity for someone else');
insert into sessions (id, activity_id, starts_at) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', '2099-11-03 19:00+01');

-- organiser update own; others affect 0 rows
select lives_ok($$ update activities set title = 'Go du mardi soir' where id = '00000000-0000-0000-0000-0000000000f1' $$, 'organiser updates own activity');
select is((select title from activities where id = '00000000-0000-0000-0000-0000000000f1'), 'Go du mardi soir', 'update applied');
select tests.act_as(:'other');
update activities set title = 'Hacked' where id = '00000000-0000-0000-0000-0000000000f1';
delete from activities where id = '00000000-0000-0000-0000-0000000000f1';
select is((select title from activities where id = '00000000-0000-0000-0000-0000000000f1'), 'Go du mardi soir', 'other user cannot update/delete (0 rows)');
select throws_ok($$ insert into sessions (activity_id, starts_at) values ('00000000-0000-0000-0000-0000000000f1', '2099-11-10 19:00+01') $$,
  '42501', null, 'non-organiser cannot insert sessions');

select tests.act_as_anon();
select is((select count(*) from activities)::int, 3, 'anon reads activities');
select is((select count(*) from sessions where id = '00000000-0000-0000-0000-0000000000e1')::int, 1, 'anon reads sessions');
select is((select count(*) from activity_tags)::int, 1, 'anon reads activity_tags');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c1', 'Anon', 'X', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00') $$,
  '42501', null, 'anon cannot insert activities');
select throws_ok($$ insert into sessions (activity_id, starts_at) values ('00000000-0000-0000-0000-0000000000f1', '2099-11-10 19:00+01') $$, '42501', null, 'anon cannot insert sessions');
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
select tests.act_as(:'other');
insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', :'other');
select is((select count(*) from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f2')::int, 0, 'member does not see others pending rows');
select tests.act_as(:'newbie');
select is((select status from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f1' and user_id = :'newbie'), 'member', 'open activity: member');
select is((select status from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f2' and user_id = :'newbie'), 'pending', 'approval activity: pending');
update activity_members set status = 'member' where activity_id = '00000000-0000-0000-0000-0000000000f2';
select is((select status from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f2' and user_id = :'newbie'), 'pending', 'pending user cannot self-approve (0 rows)');
select lives_ok($$ insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-0000000000e1', auth.uid(), 'confirmed') $$,
  'member confirms attendance');
select throws_ok($$ update attendances set status = 'no_show' where user_id = auth.uid() $$, '42501', null, 'participant cannot set no_show');
select is((select count(*) from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f1')::int, 2, 'member sees co-members');

-- stranger: non-member
select tests.act_as(:'stranger');
select is((select count(*) from activity_members)::int, 0, 'non-member sees 0 memberships');
select is((select count(*) from attendances)::int, 0, 'non-member sees 0 attendances');

select tests.act_as(:'stranger');
insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f2', :'stranger');
select is((select count(*) from activity_members)::int, 1, 'pending applicant sees only own row');

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
select is((select status from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f2' and user_id = :'newbie'), 'member', 'approval applied');
select tests.act_as_superuser();
insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-0000000000e1', :'stranger', 'confirmed');
select tests.act_as(:'org');
select throws_ok(format($$ insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-0000000000e1', %L, 'no_show') $$, :'other'),
  '42501', null, 'organiser cannot insert attendance');
-- Since migration 47 the organiser's policy only reaches confirmed rows of started sessions, so these
-- updates of a future session touch no row at all (they used to fail the WITH CHECK).
with u as (update attendances set status = 'no_show' where user_id = :'stranger' returning 1)
select is((select count(*)::int from u), 0, 'organiser cannot mark non-member no_show');
with u as (update attendances set status = 'confirmed' where user_id = :'newbie' returning 1)
select is((select count(*)::int from u), 0, 'organiser cannot set member to confirmed');
select throws_ok(format($$ update activity_members set user_id = %L where user_id = %L and activity_id = '00000000-0000-0000-0000-0000000000f2' $$, :'other', :'stranger'),
  '42501', null, 'organiser cannot re-point membership user_id');
select throws_ok($$ update activity_members set activity_id = '00000000-0000-0000-0000-0000000000f1' where activity_id = '00000000-0000-0000-0000-0000000000f2' $$,
  '42501', null, 'organiser cannot re-point membership activity_id');
with u as (update attendances set status = 'no_show' where session_id = '00000000-0000-0000-0000-0000000000e1' and user_id = :'newbie' returning 1)
select is((select count(*)::int from u), 0, 'organiser cannot mark a no-show before the session (migration 47)');
-- the visibility checks below need a no_show row on the far session: written by the system
select tests.act_as_superuser();
update attendances set status = 'no_show' where session_id = '00000000-0000-0000-0000-0000000000e1' and user_id = :'newbie';
select is((select status from attendances where session_id = '00000000-0000-0000-0000-0000000000e1' and user_id = :'newbie'), 'no_show', 'no_show applied');

-- attendance time rules, visibility, key immutability
select tests.act_as_superuser();
insert into sessions (id, activity_id, starts_at) values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f1', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000f1', now() + interval '1 hour');
select tests.act_as(:'newbie');
select throws_ok($$ insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-0000000000e2', auth.uid(), 'confirmed') $$,
  '42501', null, 'cannot confirm a session that already started');
select lives_ok($$ insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-0000000000e3', auth.uid(), 'confirmed') $$,
  'member confirms a session starting in 1h');
select tests.act_as(:'other');
select lives_ok($$ insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-0000000000e1', auth.uid(), 'confirmed') $$,
  'other confirms the far session');
select is((select count(*) from attendances where user_id = :'newbie' and session_id = '00000000-0000-0000-0000-0000000000e3')::int, 1,
  'member sees a co-member confirmed row');
select is((select count(*) from attendances where user_id = :'newbie' and session_id = '00000000-0000-0000-0000-0000000000e1')::int, 0,
  'member cannot see a co-member no_show row');
select throws_ok($$ update attendances set session_id = '00000000-0000-0000-0000-0000000000e3' where session_id = '00000000-0000-0000-0000-0000000000e1' and user_id = auth.uid() $$,
  '42501', null, 'participant cannot move own row to another session');
select lives_ok($$ update attendances set status = 'cancelled' where session_id = '00000000-0000-0000-0000-0000000000e1' and user_id = auth.uid() $$,
  'participant cancels far session');
select is((select status from attendances where session_id = '00000000-0000-0000-0000-0000000000e1' and user_id = auth.uid()), 'cancelled',
  'cancel more than 2h ahead stays cancelled');
select tests.act_as(:'newbie');
select lives_ok($$ update attendances set status = 'cancelled' where session_id = '00000000-0000-0000-0000-0000000000e3' and user_id = auth.uid() $$,
  'participant cancels 1h before');
select is((select status from attendances where session_id = '00000000-0000-0000-0000-0000000000e3' and user_id = auth.uid()), 'cancelled_late',
  'cancel within 2h is stored as cancelled_late');
select tests.act_as(:'other');
select is((select count(*) from attendances where user_id = :'newbie' and session_id = '00000000-0000-0000-0000-0000000000e3')::int, 0,
  'member cannot see a co-member cancelled_late row');
select tests.act_as_superuser();
insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-0000000000e2', :'newbie', 'confirmed');
select tests.act_as(:'newbie');
update attendances set status = 'cancelled' where session_id = '00000000-0000-0000-0000-0000000000e2' and user_id = auth.uid();
select is((select status from attendances where session_id = '00000000-0000-0000-0000-0000000000e2' and user_id = auth.uid()), 'confirmed',
  'cannot rewrite attendance of a past session');
select tests.act_as(:'org');
select throws_ok(format($$ update attendances set user_id = %L where session_id = '00000000-0000-0000-0000-0000000000e2' and user_id = %L $$, :'other', :'newbie'),
  '42501', null, 'organiser cannot re-point attendance to another user');

-- sessions: organiser status limits, started sessions, cancelled_at
select throws_ok($$ update sessions set status = 'held' where id = '00000000-0000-0000-0000-0000000000e3' $$,
  '42501', null, 'organiser cannot mark a session held');
select throws_ok($$ update sessions set status = 'cancelled_min_not_reached' where id = '00000000-0000-0000-0000-0000000000e3' $$,
  '42501', null, 'organiser cannot set cancelled_min_not_reached');
select throws_ok($$ insert into sessions (activity_id, starts_at, status) values ('00000000-0000-0000-0000-0000000000f1', now() + interval '3 days', 'held') $$,
  '42501', null, 'organiser cannot insert a held session');
select throws_ok($$ update sessions set starts_at = now() + interval '1 day' where id = '00000000-0000-0000-0000-0000000000e2' $$,
  '42501', null, 'organiser cannot reschedule a session that has started');
select is((select cancelled_at from sessions where id = '00000000-0000-0000-0000-0000000000e3'), null, 'cancelled_at null while scheduled');
select lives_ok($$ update sessions set status = 'cancelled_by_organiser' where id = '00000000-0000-0000-0000-0000000000e3' $$,
  'organiser cancels a session');
select isnt((select cancelled_at from sessions where id = '00000000-0000-0000-0000-0000000000e3'), null, 'cancelled_at set by trigger');

-- sessions: no backdating, no status change after start, immutable activity_id
select throws_ok($$ insert into sessions (activity_id, starts_at) values ('00000000-0000-0000-0000-0000000000f1', now() - interval '1 day') $$,
  '42501', null, 'organiser cannot insert a session in the past');
select throws_ok($$ update sessions set starts_at = now() - interval '1 day' where id = '00000000-0000-0000-0000-0000000000e3' $$,
  '42501', null, 'organiser cannot backdate a future session');
select throws_ok($$ update sessions set status = 'cancelled_by_organiser' where id = '00000000-0000-0000-0000-0000000000e2' $$,
  '42501', null, 'organiser cannot cancel a session that has started');
select throws_ok($$ update sessions set activity_id = '00000000-0000-0000-0000-0000000000f2' where id = '00000000-0000-0000-0000-0000000000e3' $$,
  '42501', null, 'organiser cannot move a session to another activity');
select lives_ok(format($$ update attendances set status = 'no_show' where session_id = '00000000-0000-0000-0000-0000000000e2' and user_id = %L $$, :'newbie'),
  'organiser can still mark no_show on a started session');

-- activity history cannot be deleted; soft-delete instead
select tests.act_as_superuser();
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000f4', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go historique', 'X', 'POINT(4.85 45.77)', 'weekly', '2026-01-06', '19:00'),
  ('00000000-0000-0000-0000-0000000000f5', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go sans passe', 'X', 'POINT(4.85 45.77)', 'weekly', '2026-11-06', '19:00');
insert into sessions (activity_id, starts_at) values
  ('00000000-0000-0000-0000-0000000000f4', now() - interval '10 days'),
  ('00000000-0000-0000-0000-0000000000f5', now() + interval '10 days');
select tests.act_as(:'org');
select throws_ok($$ delete from activities where id = '00000000-0000-0000-0000-0000000000f4' $$,
  '42501', null, 'cannot delete an activity that has past sessions');
select lives_ok($$ update activities set archived_at = now() where id = '00000000-0000-0000-0000-0000000000f4' $$, 'organiser archives instead');
select lives_ok($$ delete from activities where id = '00000000-0000-0000-0000-0000000000f5' $$, 'can delete an activity with no past sessions');

-- admin
select tests.act_as_admin(:'root');
select lives_ok($$ update activities set title = 'Admin edit' where id = '00000000-0000-0000-0000-0000000000f3' $$, 'admin updates any activity');
select is((select title from activities where id = '00000000-0000-0000-0000-0000000000f3'), 'Admin edit', 'admin update applied');

select * from finish();
rollback;
