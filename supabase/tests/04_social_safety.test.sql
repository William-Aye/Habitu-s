begin;
\ir helpers.inc
select plan(84);

select tests.create_user('org@test.fr', 'Julie', true) as org \gset
select tests.create_user('ana@test.fr', 'Ana') as ana \gset
select tests.create_user('ben@test.fr', 'Ben') as ben \gset
select tests.create_user('cat@test.fr', 'Cat') as cat \gset
select tests.create_user('root@test.fr', 'Root', true) as root \gset
update profiles set role = 'admin' where id = :'root';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
  values ('00000000-0000-0000-0000-0000000000f1', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go le mardi', 'Café du Parc', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00');
insert into sessions (id, activity_id, starts_at) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', '2026-01-06 19:00+01'), ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f1', '2099-01-05 19:00+01');
insert into sessions (id, activity_id, starts_at, status) values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000f1', '2026-01-13 19:00+01', 'cancelled_by_organiser');
insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', :'ana'), ('00000000-0000-0000-0000-0000000000f1', :'ben');
insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-0000000000e1', :'ana', 'confirmed'), ('00000000-0000-0000-0000-0000000000e2', :'ana', 'confirmed'),
  ('00000000-0000-0000-0000-0000000000e3', :'ana', 'confirmed'), ('00000000-0000-0000-0000-0000000000e1', :'org', 'confirmed');
insert into messages (activity_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000f1', :'ben', 'Salut !');
insert into ambiance_words (id, slug, label_fr, label_en, sort_order) values
  ('00000000-0000-0000-0000-0000000000d1', 'chaleureux', 'Chaleureux', 'Warm', 1),
  ('00000000-0000-0000-0000-0000000000d2', 'calme', 'Calme', 'Calm', 2),
  ('00000000-0000-0000-0000-0000000000d3', 'rigolo', 'Rigolo', 'Fun', 3),
  ('00000000-0000-0000-0000-0000000000d4', 'studieux', 'Studieux', 'Studious', 4);
insert into organiser_stats (user_id, sessions_held, distinct_participants, positive_count) values (:'org', 5, 4, 3), (:'ana', 1, 1, 1);
insert into search_misses (query, area_label) values ('yoga', 'Lyon');
insert into notification_log (user_id, kind) values (:'ana', 'reminder');

-- structure
select is(has_table_privilege('authenticated', 'public.messages', 'TRUNCATE'), false, 'authenticated cannot truncate messages');
select columns_are('public', 'organiser_badges', array['user_id', 'sessions_held', 'distinct_participants', 'badge_status'], 'badge view exposes exactly four columns');

-- messages
select tests.act_as(:'ana');
select is((select count(*) from messages)::int, 1, 'member sees group message');
select lives_ok(format($$ insert into blocks (blocker_id, blocked_id) values (auth.uid(), %L) $$, :'ben'), 'ana blocks ben');
select is((select count(*) from messages)::int, 0, 'blocked sender hidden from blocker');
select throws_ok(format($$ insert into messages (sender_id, recipient_id, body) values (auth.uid(), %L, 'hi') $$, :'ben'),
  '42501', null, 'private messages not yet allowed');
select lives_ok($$ insert into messages (activity_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000f1', auth.uid(), 'Coucou') $$, 'member posts group message');
insert into messages (activity_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000f1', :'ben', 'usurpation');
select is((select count(*) from messages where body = 'usurpation' and sender_id = auth.uid())::int, 1, 'posting as someone else is stored as the caller');
select throws_ok($$ insert into messages (activity_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000f1', auth.uid(), '') $$,
  '23514', null, 'empty message rejected');
select throws_ok(format($$ insert into blocks (blocker_id, blocked_id) values (%L, %L) $$, :'ben', :'cat'),
  '42501', null, 'cannot create a block for someone else');
select throws_ok($$ insert into blocks (blocker_id, blocked_id) values (auth.uid(), auth.uid()) $$,
  '23514', null, 'cannot block yourself');
select lives_ok($$ insert into safety_tips_seen (user_id, tip_id) values (auth.uid(), 'first_meetup') $$, 'own safety tip seen');
select lives_ok($$ insert into saved_searches (user_id, query, center, radius_km) values (auth.uid(), 'go', 'POINT(4.85 45.77)', 10) $$, 'own saved search');
select throws_ok($$ insert into saved_searches (user_id, query, center, radius_km) values (auth.uid(), 'go', 'POINT(4.85 45.77)', 7) $$,
  '23514', null, 'radius must be 5/10/25/50');

-- feedback after the event
select lives_ok($$ insert into session_feedback (session_id, user_id, went_well) values ('00000000-0000-0000-0000-0000000000e1', auth.uid(), true) $$,
  'confirmed participant gives feedback');
select is((select count(*) from session_feedback)::int, 0, 'feedback rows never readable by users');
select throws_ok($$ insert into session_feedback (session_id, user_id, went_well, ambiance_word_ids) values ('00000000-0000-0000-0000-0000000000e1', auth.uid(), true,
  array['00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-0000000000d4']::uuid[]) $$,
  '23514', null, 'more than 3 ambiance words rejected');

select throws_ok($$ insert into session_feedback (session_id, user_id, went_well) values ('00000000-0000-0000-0000-0000000000e2', auth.uid(), true) $$,
  '42501', null, 'feedback for a session not yet started is rejected');

select throws_ok($$ insert into session_feedback (session_id, user_id, went_well) values ('00000000-0000-0000-0000-0000000000e3', auth.uid(), true) $$,
  '42501', null, 'feedback on a cancelled session is rejected');

-- reports
select lives_ok(format($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'user', %L, 'fake_or_spam') $$, :'ben'), 'ana files a report');
select throws_ok(format($$ insert into reports (reporter_id, target_type, target_id, reason, status, statement_of_reasons) values (auth.uid(), 'user', %L, 'other', 'actioned', 'x') $$, :'ben'),
  '42501', null, 'cannot self-set a decided status');
select throws_ok(format($$ insert into reports (reporter_id, target_type, target_id, reason) values (%L, 'user', %L, 'other') $$, :'cat', :'ben'),
  '42501', null, 'cannot report as someone else');
select is((select count(*) from reports)::int, 1, 'user sees own report');
update reports set status = 'actioned', statement_of_reasons = 'x';
select is((select status from reports), 'open', 'user cannot update own report status');
select throws_ok($$ insert into organiser_stats (user_id) values (auth.uid()) $$, '42501', null, 'user cannot write organiser_stats');
select is((select count(*) from organiser_stats)::int, 1, 'user sees only own organiser_stats');
select is((select count(*) from ambiance_words where id::text like '00000000-0000-0000-0000-0000000000d%')::int, 4, 'authenticated reads ambiance words');
select throws_ok($$ insert into ambiance_words (slug, label_fr, label_en, sort_order) values ('x', 'x', 'x', 9) $$, '42501', null, 'user cannot write ambiance words');
select is((select count(*) from search_misses)::int, 0, 'search_misses not readable by users');
select is((select count(*) from notification_log)::int, 0, 'notification_log not readable by users');
select throws_ok($$ insert into search_misses (query) values ('x') $$, '42501', null, 'users cannot write search_misses');
select lives_ok($$ insert into feedback (user_id, type, body) values (auth.uid(), 'problem', 'Bug') $$, 'user sends feedback as self');
select throws_ok(format($$ insert into feedback (user_id, type, body) values (%L, 'problem', 'Bug') $$, :'ben'), '42501', null, 'feedback cannot impersonate');
select throws_ok($$ insert into feedback (type, body, status) values ('idea', 'x', 'done') $$, '42501', null, 'feedback status must be new');

select tests.act_as(:'org');
select is((select count(*) from session_feedback)::int, 0, 'organiser cannot read feedback');
select is(public.session_has_member('00000000-0000-0000-0000-0000000000e1', :'ana'), true, 'organiser can check membership');
select is((select count(*) from reports)::int, 0, 'organiser cannot see others reports');
select is((select count(*) from blocks)::int, 0, 'blocks are own-only');
select is((select count(*) from safety_tips_seen)::int, 0, 'safety tips are own-only');
select is((select count(*) from saved_searches)::int, 0, 'saved searches are own-only');
select is((select count(*) from organiser_stats)::int, 1, 'organiser sees own stats');
select is((select count(*) from messages)::int, 3, 'organiser (activity member) sees messages');
select throws_ok($$ insert into session_feedback (session_id, user_id, went_well) values ('00000000-0000-0000-0000-0000000000e1', auth.uid(), true) $$,
  '42501', null, 'organiser cannot rate own session');

select tests.act_as(:'ben');
select throws_ok($$ insert into session_feedback (session_id, user_id, went_well) values ('00000000-0000-0000-0000-0000000000e1', auth.uid(), false) $$,
  '42501', null, 'unconfirmed member cannot give feedback');
select throws_ok(format($$ insert into session_feedback (session_id, user_id, went_well) values ('00000000-0000-0000-0000-0000000000e1', %L, false) $$, :'ana'),
  '42501', null, 'cannot give feedback for someone else');
select is(public.session_has_member('00000000-0000-0000-0000-0000000000e1', :'ana'), false, 'non-organiser gets false for another user');
update messages set body = 'hack';
select is((select count(*) from messages where body = 'hack')::int, 0, 'cannot update messages');
delete from messages;
select is((select count(*) from messages)::int, 0, 'deletes only own messages (others stay)');
select is((select count(*) from reports)::int, 0, 'ben does not see ana reports');
select is((select count(*) from blocks)::int, 0, 'ben does not see ana blocks');
select is((select count(*) from messages where sender_id = :'ana')::int, 0, 'blocking is two-way: blocked user cannot see blocker messages');

select tests.act_as(:'cat');
select is((select count(*) from messages)::int, 0, 'non-member cannot read group messages');
select throws_ok($$ insert into messages (activity_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000f1', auth.uid(), 'intrus') $$,
  '42501', null, 'non-member cannot post');

select tests.act_as_anon();
select lives_ok($$ insert into feedback (type, body) values ('idea', 'Ajouter le mode sombre') $$, 'anon sends idea');
select is((select count(*) from feedback)::int, 0, 'anon cannot read feedback');
select throws_ok(format($$ insert into feedback (user_id, type, body) values (%L, 'idea', 'x') $$, :'ana'), '42501', null, 'anon cannot set user_id');
select is((select count(*) from ambiance_words where id::text like '00000000-0000-0000-0000-0000000000d%')::int, 4, 'anon reads ambiance words');
select is((select count(*) from organiser_badges)::int, 2, 'anon reads organiser badges');
select throws_ok($$ select public.has_confirmed_attendance('00000000-0000-0000-0000-0000000000e1') $$, '42501', null, 'anon cannot execute has_confirmed_attendance');
select throws_ok($$ select public.session_has_member('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001') $$, '42501', null, 'anon cannot execute session_has_member');
select throws_ok($$ select count(*) from organiser_stats $$, '42501', null, 'anon cannot read organiser_stats');
select throws_ok($$ select count(*) from messages $$, '42501', null, 'anon cannot read messages');
select throws_ok($$ select count(*) from reports $$, '42501', null, 'anon cannot read reports');

-- admin
select tests.act_as(:'root');
select is((select count(*) from feedback)::int, 2, 'admin reads feedback');
select is((select count(*) from session_feedback)::int, 1, 'admin reads session_feedback');
select is((select count(*) from reports)::int, 1, 'admin reads reports');
select is((select count(*) from search_misses)::int, 1, 'admin reads search_misses');
select is((select count(*) from notification_log)::int, 1, 'admin reads notification_log');
select is((select count(*) from organiser_stats)::int, 2, 'admin reads organiser_stats');
select is((select count(*) from blocks)::int, 1, 'admin reads blocks');
select is((select count(*) from messages)::int, 2, 'admin reads messages');
select throws_ok($$ update reports set status = 'dismissed', decided_by = auth.uid(), decided_at = now() $$,
  '23514', null, 'decided report needs a statement of reasons');
select throws_ok($$ update reports set status = 'dismissed', statement_of_reasons = '', decided_by = auth.uid(), decided_at = now() $$,
  '23514', null, 'empty statement of reasons rejected');
select lives_ok($$ update reports set status = 'dismissed', statement_of_reasons = 'Rien à signaler', decided_by = auth.uid(), decided_at = now() $$, 'admin decides report');
select lives_ok($$ insert into ambiance_words (slug, label_fr, label_en, sort_order) values ('x', 'x', 'x', 9) $$, 'admin writes ambiance words');
select throws_ok(format($$ insert into messages (activity_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000f1', %L, 'fake') $$, :'ana'),
  '42501', null, 'admin cannot post as someone else');
select lives_ok($$ delete from messages where body = 'Coucou' $$, 'admin deletes a message');
select is((select count(*) from messages)::int, 1, 'message deleted by admin');
select lives_ok($$ update organiser_stats set badge_status = 'active' $$, 'admin edits organiser_stats');

select tests.act_as_superuser();
select is((select count(*) from reports where status = 'dismissed')::int, 1, 'report decision persisted');
select lives_ok(format($$ delete from auth.users where id = %L $$, :'root'), 'deleting a moderator leaves decided reports (set null)');
select lives_ok(format($$ delete from auth.users where id = %L $$, :'org'), 'deleting organiser cascades cleanly (GDPR erasure)');
select is((select count(*) from activities where organiser_id = :'org')::int, 0, 'organiser activities gone');
select is((select count(*) from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f1')::int, 0, 'memberships gone');

select * from finish();
rollback;
