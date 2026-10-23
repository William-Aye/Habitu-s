begin;
\ir helpers.inc
select plan(39);
select tests.create_user('org@cr.fr', 'Olivier') as org \gset
select tests.create_user('ma@cr.fr', 'Anne') as ma \gset
select tests.create_user('mb@cr.fr', 'Bruno') as mb \gset
select tests.create_user('lv@cr.fr', 'Lea') as lv \gset
select tests.create_user('ot@cr.fr', 'Otto') as ot \gset
select tests.create_user('bl@cr.fr', 'Blaise') as bl \gset
select tests.create_user('ad@cr.fr', 'Adam') as ad \gset
select tests.create_user('st@cr.fr', 'Stan') as st \gset
select tests.create_user('nj@cr.fr', 'Nadia') as nj \gset
select tests.create_user('fg@cr.fr', 'Fred') as fg \gset
select tests.create_user('rq@cr.fr', 'Rose') as rq \gset
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
update profiles set role = 'admin' where id = :'ad';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, max_size, chat_history) values
  ('00000000-0000-0000-0000-0000000000a1', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go depuis', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', 30, 'since_join'),
  ('00000000-0000-0000-0000-0000000000a2', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go tout', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', 30, 'all'),
  ('00000000-0000-0000-0000-0000000000a3', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go quitte', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', 30, 'all');
update activities set created_at = '2025-01-01';
insert into activity_members (activity_id, user_id, status, joined_at) values
  ('00000000-0000-0000-0000-0000000000a1', :'ma', 'member', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000a1', :'mb', 'member', now() - interval '30 minutes'),
  ('00000000-0000-0000-0000-0000000000a2', :'mb', 'member', now() - interval '30 minutes'),
  ('00000000-0000-0000-0000-0000000000a2', :'ma', 'member', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000a3', :'ma', 'member', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000a3', :'bl', 'member', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000a3', :'ot', 'member', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000a3', :'lv', 'removed', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000a2', :'lv', 'member', now() - interval '1 day');
-- Three old messages, one after mb joined, in each of a1 and a2.
insert into messages (activity_id, sender_id, body, created_at)
select a, :'org', 'm' || g, now() - (g || ' hours')::interval
  from (values ('00000000-0000-0000-0000-0000000000a1'::uuid), ('00000000-0000-0000-0000-0000000000a2'::uuid)) v(a),
       generate_series(2, 4) g;
insert into messages (activity_id, sender_id, body, created_at) values
  ('00000000-0000-0000-0000-0000000000a1', :'org', 'recent', now() - interval '10 minutes'),
  ('00000000-0000-0000-0000-0000000000a2', :'org', 'recent', now() - interval '10 minutes');

-- A: chat history ---------------------------------------------------------------------------------
select tests.act_as(:'mb');
select is(jsonb_array_length(public.chat_messages('00000000-0000-0000-0000-0000000000a1')->'messages'), 1, 'since_join: a newcomer sees only messages from their arrival');
select is(public.chat_messages('00000000-0000-0000-0000-0000000000a1')->'messages'->0->>'body', 'recent', 'since_join: the visible one is the later message');
select is(jsonb_array_length(public.chat_messages('00000000-0000-0000-0000-0000000000a2')->'messages'), 4, 'all: the newcomer sees everything');
select is((select (c->'last_message'->>'body') from jsonb_array_elements(public.my_chats()) c where c->>'activity_id' = '00000000-0000-0000-0000-0000000000a1'), 'recent', 'since_join: the preview is a visible message');
select is((select (c->>'unread_count')::int from jsonb_array_elements(public.my_chats()) c where c->>'activity_id' = '00000000-0000-0000-0000-0000000000a1'), 1, 'since_join: unread counts only visible messages');
select is(public.my_unread_total(), 2, 'my_unread_total: one unread in each activity');
select tests.act_as(:'ma');
select is(jsonb_array_length(public.chat_messages('00000000-0000-0000-0000-0000000000a1')->'messages'), 4, 'since_join: an earlier member sees what came after their arrival');
select tests.act_as(:'org');
select is(jsonb_array_length(public.chat_messages('00000000-0000-0000-0000-0000000000a1')->'messages'), 4, 'since_join: the organiser sees everything');
select lives_ok($q$update activities set chat_history = 'all' where id = '00000000-0000-0000-0000-0000000000a1'$q$, 'the organiser can change the setting');
select is((select chat_history from activities where id = '00000000-0000-0000-0000-0000000000a1'), 'all', 'the setting changed');
select throws_ok($q$update activities set chat_history = 'nope' where id = '00000000-0000-0000-0000-0000000000a1'$q$, '23514', null, 'only all or since_join are accepted');
select tests.act_as(:'mb');
select is(jsonb_array_length(public.chat_messages('00000000-0000-0000-0000-0000000000a1')->'messages'), 4, 'switching to all shows the full history');
update activities set chat_history = 'since_join' where id = '00000000-0000-0000-0000-0000000000a1';
select tests.act_as_superuser();
select is((select chat_history from activities where id = '00000000-0000-0000-0000-0000000000a1'), 'all', 'a member cannot change the setting');

-- B: deleting my messages in activities I left ---------------------------------------------------
select tests.act_as_superuser();
insert into messages (id, activity_id, sender_id, body) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a3', :'lv', 'ancien 1'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a2', :'lv', 'courant'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a3', :'ma', 'autre personne');
select tests.act_as(:'lv');
select is(public.delete_my_messages_in_left_activities(), 1, 'one message deleted in the left activity');
select tests.act_as_superuser();
select is((select count(*)::int from messages where id = '00000000-0000-0000-0000-0000000000e1'), 0, 'the old message is gone');
select is((select count(*)::int from messages where id = '00000000-0000-0000-0000-0000000000e2'), 1, 'a message in a current activity stays');
select is((select count(*)::int from messages where id = '00000000-0000-0000-0000-0000000000e3'), 1, 'other people''s messages stay');
select tests.act_as_anon();
select throws_ok($q$select public.delete_my_messages_in_left_activities()$q$, '42501', null, 'anon is denied');

-- C: reports keep a copy -------------------------------------------------------------------------
select tests.act_as_superuser();
insert into messages (id, activity_id, sender_id, body) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a3', :'ot', 'contenu secret'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a3', :'bl', 'message du bloque');
insert into blocks (blocker_id, blocked_id) values (:'ma', :'bl');
select tests.act_as(:'ma');
select lives_ok(format($q$insert into reports (reporter_id, target_type, target_id, reason) values (%L, 'message', %L, 'other')$q$, :'ma', '00000000-0000-0000-0000-0000000000f1'), 'a member reports a message they can see');
select tests.act_as_superuser();
select is((select snapshot->>'body' from report_snapshots s join reports r on r.id = s.report_id where r.target_id = '00000000-0000-0000-0000-0000000000f1'), 'contenu secret', 'the snapshot holds the body');
select is((select snapshot->>'sender_id' from report_snapshots s join reports r on r.id = s.report_id where r.target_id = '00000000-0000-0000-0000-0000000000f1'), :'ot', 'the snapshot holds the sender');
select ok((select snapshot ? 'activity_id' and snapshot ? 'created_at' from report_snapshots limit 1), 'the snapshot holds the activity and date');
delete from messages where id = '00000000-0000-0000-0000-0000000000f1';
select is((select count(*)::int from report_snapshots), 1, 'the snapshot survives deleting the message');
select tests.act_as(:'ma');
select throws_ok(format($q$insert into report_snapshots (report_id, snapshot) select id, '{"body":"faux"}' from reports where reporter_id = %L$q$, :'ma'), '42501', null, 'a client cannot write a snapshot');
select lives_ok(format($q$insert into reports (reporter_id, target_type, target_id, reason) values (%L, 'message', %L, 'other')$q$, :'ma', '00000000-0000-0000-0000-0000000000f2'), 'a victim who blocked the sender can still report their message');
select tests.act_as(:'st');
select throws_ok(format($q$insert into reports (reporter_id, target_type, target_id, reason) values (%L, 'message', %L, 'other')$q$, :'st', '00000000-0000-0000-0000-0000000000f2'), '42501', 'not_allowed', 'a non-member cannot report a message');
select tests.act_as(:'ma');
select throws_ok(format($q$insert into reports (reporter_id, target_type, target_id, reason) values (%L, 'message', gen_random_uuid(), 'other')$q$, :'ma'), '42501', 'not_allowed', 'an unknown message id is refused');
select lives_ok(format($q$insert into reports (reporter_id, target_type, target_id, reason) values (%L, 'user', %L, 'other')$q$, :'ma', :'ot'), 'other report types are unaffected');
select is((select count(*)::int from report_snapshots), 0, 'the reporter cannot read the snapshot');
select ok(not (public.export_my_data()::text like '%contenu secret%'), 'the export holds no snapshot');
select tests.act_as_admin(:'ad');
select is((select snapshot->>'body' from report_snapshots where snapshot->>'body' = 'contenu secret'), 'contenu secret', 'an admin reads the snapshot');
-- N1: a direct select follows chat_history, reports too ------------------------------------------------
select tests.act_as_superuser();
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, max_size, chat_history)
  values ('00000000-0000-0000-0000-0000000000a4', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go direct', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', 30, 'since_join');
update activities set created_at = '2025-01-01' where id = '00000000-0000-0000-0000-0000000000a4';
insert into activity_members (activity_id, user_id, status, joined_at) values
  ('00000000-0000-0000-0000-0000000000a4', :'nj', 'member', now() - interval '30 minutes');
insert into messages (id, activity_id, sender_id, body, created_at) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a4', :'org', 'ancien4', now() - interval '2 hours'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a4', :'org', 'nouveau4', now() - interval '10 minutes');
select tests.act_as(:'nj');
select is((select count(*)::int from messages where activity_id = '00000000-0000-0000-0000-0000000000a4'), 1, 'since_join: a direct select hides pre-join messages');
select throws_ok(format($q$insert into reports (reporter_id, target_type, target_id, reason) values (%L, 'message', %L, 'other')$q$, :'nj', '00000000-0000-0000-0000-0000000000b1'), '42501', 'not_allowed', 'reporting a pre-join message is refused');
select lives_ok(format($q$insert into reports (reporter_id, target_type, target_id, reason) values (%L, 'message', %L, 'other')$q$, :'nj', '00000000-0000-0000-0000-0000000000b2'), 'reporting a visible message works');
select tests.act_as(:'org');
select is((select count(*)::int from messages where activity_id = '00000000-0000-0000-0000-0000000000a4'), 2, 'the organiser selects everything directly');
select tests.act_as(:'mb');
select is((select count(*)::int from messages where activity_id = '00000000-0000-0000-0000-0000000000a2'), 5, 'all: a newcomer selects everything directly');

-- N2: joined_at is the server's ------------------------------------------------------------------
select tests.act_as(:'fg');
insert into activity_members (activity_id, user_id, joined_at) values ('00000000-0000-0000-0000-0000000000a4', :'fg', now() - interval '10 days');
select tests.act_as_superuser();
select is((select joined_at from activity_members where user_id = :'fg' and activity_id = '00000000-0000-0000-0000-0000000000a4'), now(), 'a forged joined_at is ignored');
insert into activity_members (activity_id, user_id, status, joined_at) values
  ('00000000-0000-0000-0000-0000000000a4', :'rq', 'pending', now() - interval '1 hour');
insert into messages (activity_id, sender_id, body, created_at) values
  ('00000000-0000-0000-0000-0000000000a4', :'org', 'entre demande et accord', now() - interval '30 minutes');
select tests.act_as(:'org');
update activity_members set status = 'member' where user_id = :'rq' and activity_id = '00000000-0000-0000-0000-0000000000a4';
select tests.act_as(:'rq');
select is(jsonb_array_length(public.chat_messages('00000000-0000-0000-0000-0000000000a4')->'messages'), 0, 'an approved requester sees nothing sent before the approval');
select tests.act_as_superuser();
select is((select joined_at from activity_members where user_id = :'rq' and activity_id = '00000000-0000-0000-0000-0000000000a4'), now(), 'approval sets joined_at to the approval time');

select * from finish();
rollback;
