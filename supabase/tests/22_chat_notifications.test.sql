begin;
\ir helpers.inc
select plan(19);
select tests.create_user('org@cn.fr', 'Olivier') as org \gset
select tests.create_user('m1@cn.fr', 'Marie') as m1 \gset
select tests.create_user('m2@cn.fr', 'Marc') as m2 \gset
select tests.create_user('m3@cn.fr', 'Manon') as m3 \gset
select tests.create_user('mu@cn.fr', 'Mutia') as mu \gset
select tests.create_user('rd@cn.fr', 'Reda') as rd \gset
select tests.create_user('ok@cn.fr', 'Oscar') as ok \gset
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
update profiles set language = 'en' where id = :'m3';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, max_size) values
  ('00000000-0000-0000-0000-0000000000a1', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go groupe', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', 30),
  ('00000000-0000-0000-0000-0000000000a2', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go filtres', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', 30);
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000a1', :'m1', 'member'),
  ('00000000-0000-0000-0000-0000000000a1', :'m2', 'member'),
  ('00000000-0000-0000-0000-0000000000a1', :'m3', 'member'),
  ('00000000-0000-0000-0000-0000000000a2', :'m1', 'member'),
  ('00000000-0000-0000-0000-0000000000a2', :'m2', 'member'),
  ('00000000-0000-0000-0000-0000000000a2', :'mu', 'member'),
  ('00000000-0000-0000-0000-0000000000a2', :'rd', 'member'),
  ('00000000-0000-0000-0000-0000000000a2', :'ok', 'member');
update activity_members set joined_at = now() - interval '1 day';
update activities set created_at = '2025-01-01';

-- One notification per person per window ---------------------------------------------------------
select tests.act_as(:'org');
select lives_ok(format($q$insert into messages (activity_id, sender_id, body) values (%L, %L, 'Secret du groupe')$q$, '00000000-0000-0000-0000-0000000000a1', :'org'), 'the organiser writes');
select tests.act_as_superuser();
select is((select count(*)::int from notification_outbox where kind = 'chat_message'), 3, 'three members notified by one message');
select is((select count(*)::int from notification_outbox where kind = 'chat_message' and user_id = :'org'), 0, 'the sender is not notified');
select tests.act_as(:'org');
select lives_ok(format($q$insert into messages (activity_id, sender_id, body) select %L, %L, 'm' || g from generate_series(1, 10) g$q$, '00000000-0000-0000-0000-0000000000a1', :'org'), 'ten more messages');
select tests.act_as_superuser();
select is((select count(*)::int from notification_outbox where kind = 'chat_message' and (data->>'activity_id') = '00000000-0000-0000-0000-0000000000a1'), 3, 'still one per recipient after ten more messages');

-- Texts and data ---------------------------------------------------------------------------------
select is((select title || '|' || body from notification_outbox where kind = 'chat_message' and user_id = :'m2'),
  'Nouveau message|Nouveau message dans une de vos activités.', 'French texts');
select is((select title || '|' || body from notification_outbox where kind = 'chat_message' and user_id = :'m3'),
  'New message|New message in one of your activities.', 'English texts');
select is((select data from notification_outbox where kind = 'chat_message' and user_id = :'m2'),
  jsonb_build_object('activity_id', '00000000-0000-0000-0000-0000000000a1', 'kind', 'chat_message'), 'data is exactly activity_id and kind');
select is((select count(*)::int from notification_outbox where kind = 'chat_message' and (body ilike '%Secret%' or body ilike '%Olivier%' or body ilike '%Marie%' or title ilike '%Olivier%' or data::text ilike '%Secret%')), 0, 'no message text or name');

-- Skips ------------------------------------------------------------------------------------------
select tests.act_as(:'mu');
select public.set_chat_muted('00000000-0000-0000-0000-0000000000a2', true);
select tests.act_as(:'rd');
select public.mark_chat_read('00000000-0000-0000-0000-0000000000a2');
select tests.act_as_superuser();
insert into blocks (blocker_id, blocked_id) values (:'m2', :'m1');
select tests.act_as(:'m1');
select lives_ok(format($q$insert into messages (activity_id, sender_id, body) values (%L, %L, 'Salut')$q$, '00000000-0000-0000-0000-0000000000a2', :'m1'), 'm1 writes in the filters activity');
select tests.act_as_superuser();
select is((select count(*)::int from notification_outbox where user_id = :'mu' and kind = 'chat_message'), 0, 'a muted member gets none');
select is((select count(*)::int from notification_outbox where user_id = :'rd' and kind = 'chat_message'), 0, 'a member who just read gets none');
select is((select count(*)::int from notification_outbox where user_id = :'m2' and kind = 'chat_message' and (data->>'activity_id') = '00000000-0000-0000-0000-0000000000a2'), 0, 'a member who blocked the sender gets none');
select is((select array_agg(user_id order by user_id::text) from notification_outbox where kind = 'chat_message' and (data->>'activity_id') = '00000000-0000-0000-0000-0000000000a2'),
  (select array_agg(u order by u::text) from (values (:'org'::uuid), (:'ok'::uuid)) v(u)), 'only the organiser and the other member are notified');

-- Blocks both ways, and a dedupe key that already exists -------------------------------------------
select tests.act_as_superuser();
delete from notification_outbox;
insert into blocks (blocker_id, blocked_id) values (:'org', :'ok');
insert into notification_outbox (user_id, kind, title, body, dedupe_key)
  values (:'m2', 'chat_message', 't', 'b', 'chat:00000000-0000-0000-0000-0000000000a2:' || :'m2' || ':' || floor(extract(epoch from now()) / 900));
select tests.act_as(:'org');
select lives_ok(format($q$insert into messages (activity_id, sender_id, body) values (%L, %L, 'Re')$q$, '00000000-0000-0000-0000-0000000000a2', :'org'), 'the organiser writes again');
select tests.act_as_superuser();
select is((select count(*)::int from notification_outbox where user_id = :'ok' and kind = 'chat_message'), 0, 'a member the sender blocked gets none');
select is((select count(*)::int from notification_outbox where user_id = :'m2' and kind = 'chat_message'), 1, 'an existing dedupe key is not duplicated and raises nothing');

-- No regression ----------------------------------------------------------------------------------
select is((select title || '|' || body from notif_text('session_reminder', 'fr')), 'Rappel|Vous avez une activité demain. Serez-vous là ?', 'session_reminder unchanged');
select is((select title || '|' || body from notif_text('session_cancelled', 'fr')), 'Séance annulée|Une séance de votre activité est annulée.', 'session_cancelled unchanged');
select * from finish();
rollback;
