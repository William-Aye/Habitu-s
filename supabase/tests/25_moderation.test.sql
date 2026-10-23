begin;
\ir helpers.inc
select plan(123);
select tests.create_user('adm@mo.fr', 'Admin') as adm \gset
select tests.create_user('org@mo.fr', 'Olga') as org \gset
select tests.create_user('ana@mo.fr', 'Ana') as ana \gset
select tests.create_user('ben@mo.fr', 'Ben') as ben \gset
select tests.create_user('cat@mo.fr', 'Cat') as cat \gset
select tests.create_user('dan@mo.fr', 'Dan') as dan \gset
select tests.create_user('eve@mo.fr', 'Eve') as eve \gset
select tests.create_user('fay@mo.fr', 'Fay') as fay \gset
select tests.create_user('gus@mo.fr', 'Gus') as gus \gset
select tests.create_user('hal@mo.fr', 'Hal') as hal \gset
select tests.create_user('pia@mo.fr', 'Pia') as pia \gset
select tests.create_user('adm2@mo.fr', 'Admine') as adm2 \gset
select tests.create_user('uma@mo.fr', 'Uma') as uma \gset
select tests.create_user('vic@mo.fr', 'Vic') as vic \gset
select tests.create_user('wen@mo.fr', 'Wen') as wen \gset
update profiles set role = 'admin' where id = :'adm';
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, archived_at) values
  ('00000000-0000-0000-0000-0000000000a1', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go du mardi', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', null),
  ('00000000-0000-0000-0000-0000000000a2', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go archive', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', now()),
  ('00000000-0000-0000-0000-0000000000a3', :'cat', '00000000-0000-0000-0000-0000000000c1', 'Go de Cat', 'Parc', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', null),
  ('00000000-0000-0000-0000-0000000000a4', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go suspect', 'Parc', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', null);
insert into activity_members (activity_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', :'ana'), ('00000000-0000-0000-0000-0000000000a1', :'ben'),
  ('00000000-0000-0000-0000-0000000000a1', :'fay'), ('00000000-0000-0000-0000-0000000000a1', :'gus'),
  ('00000000-0000-0000-0000-0000000000a1', :'hal');
select id as s1 from sessions where activity_id = '00000000-0000-0000-0000-0000000000a1' and starts_at > now() order by starts_at limit 1 \gset
insert into messages (id, activity_id, sender_id, body) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', :'ben', 'Bonjour a tous'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', :'fay', 'Message a retirer'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a1', :'hal', 'Message du futur banni'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000a3', :'cat', 'Autre activite');
insert into associations (id, name, source) values ('00000000-0000-0000-0000-0000000000d1', 'Club Test', 'community');
insert into collectifs (id, name, town_label, town_point, created_by) values ('00000000-0000-0000-0000-00000000c0a1', 'Les Testeurs', 'Lyon', 'POINT(4.85 45.77)', :'cat');
insert into blocks (blocker_id, blocked_id) values (:'ana', :'dan');

-- reporting: visible targets are accepted, reporter pinned
select tests.act_as(:'ana');
select lives_ok($$ insert into reports (target_type, target_id, reason) values ('activity', '00000000-0000-0000-0000-0000000000a1', 'other') $$, 'a member reports a visible activity without naming themself');
select is((select reporter_id from reports where target_type = 'activity'), :'ana'::uuid, 'reporter_id is pinned to the caller');
select lives_ok(format($$ insert into reports (reporter_id, target_type, target_id, reason, source) values (%L, 'message', '00000000-0000-0000-0000-0000000000b1', 'harassment', 'auto') $$, :'ana'), 'a member reports a message with the new harassment reason');
select is((select source from reports where target_type = 'message'), 'user', 'source is pinned to user');
select lives_ok(format($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'user', %L, 'inappropriate_behaviour') $$, :'ben'), 'a member reports a person they share an activity with');
select lives_ok($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'message', '00000000-0000-0000-0000-0000000000b3', 'other') $$, 'a second message report');
select lives_ok($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'activity', '00000000-0000-0000-0000-0000000000a4', 'unsafe_place') $$, 'a report on a second activity');
select tests.act_as_superuser();
select is((select target_owner from reports where target_type = 'message' and target_id = '00000000-0000-0000-0000-0000000000b1'), :'ben'::uuid, 'target_owner is the message author');
select is((select target_owner from reports where target_type = 'activity' and target_id = '00000000-0000-0000-0000-0000000000a1'), :'org'::uuid, 'target_owner is the organiser');
select tests.act_as(:'gus');
select lives_ok(format($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'session', %L, 'did_not_happen') $$, :'s1'), 'a member reports a session');
select lives_ok($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'association', '00000000-0000-0000-0000-0000000000d1', 'other') $$, 'a member reports an association');
select lives_ok($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'collectif', '00000000-0000-0000-0000-00000000c0a1', 'fake_or_spam') $$, 'a member reports a collectif');
select lives_ok($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'message', '00000000-0000-0000-0000-0000000000b2', 'harassment') $$, 'a message report by a second reporter');
select lives_ok($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'activity', '00000000-0000-0000-0000-0000000000a1', 'other') $$, 'a second report on the same activity');

-- everything the caller cannot see gets the same refusal
select tests.act_as(:'ana');
select throws_ok($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'activity', '00000000-0000-0000-0000-0000000000a2', 'other') $$, '42501', 'not_allowed', 'an archived activity cannot be reported');
select throws_ok($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'message', '00000000-0000-0000-0000-0000000000b4', 'other') $$, '42501', 'not_allowed', 'a message from another activity cannot be reported');
select throws_ok(format($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'user', %L, 'other') $$, :'dan'), '42501', 'not_allowed', 'a blocked person cannot be reported');
select throws_ok(format($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'user', %L, 'other') $$, :'eve'), '42501', 'not_allowed', 'a stranger cannot be reported');
select throws_ok($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'activity', gen_random_uuid(), 'other') $$, '42501', 'not_allowed', 'a random activity id is refused the same way');
select throws_ok($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'session', gen_random_uuid(), 'other') $$, '42501', 'not_allowed', 'a random session id is refused the same way');
select throws_ok($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'collectif', gen_random_uuid(), 'other') $$, '42501', 'not_allowed', 'a random collectif id is refused the same way');
select throws_ok($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'association', gen_random_uuid(), 'other') $$, '42501', 'not_allowed', 'a random association id is refused the same way');

-- limits
select tests.act_as(:'eve');
insert into reports (reporter_id, target_type, target_id, reason)
  select auth.uid(), 'activity', '00000000-0000-0000-0000-0000000000a1', 'other' from generate_series(1, 5);
select throws_ok($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'activity', '00000000-0000-0000-0000-0000000000a1', 'other') $$, '42501', 'limit_reached', 'the 6th report in an hour is refused');
select tests.act_as_superuser();
delete from reports where reporter_id = :'eve';
select tests.act_as(:'eve');
select throws_ok($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'activity', '00000000-0000-0000-0000-0000000000a1', 'other') $$, '42501', 'limit_reached', 'deleting reports does not free a slot');
select tests.act_as_superuser();
insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
  select :'org', '00000000-0000-0000-0000-0000000000c1', 'Jeu ' || n, 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 3, '19:00' from generate_series(1, 21) n;
select tests.act_as(:'eve');
select lives_ok($$ insert into activity_members (activity_id, user_id) select id, auth.uid() from activities where title like 'Jeu %' order by title limit 20 $$, '20 joins in a day are accepted');
select throws_ok($$ insert into activity_members (activity_id, user_id) select id, auth.uid() from activities where title like 'Jeu %' and id not in (select activity_id from activity_members where user_id = auth.uid()) limit 1 $$, '42501', 'limit_reached', 'the 21st join is refused');
select lives_ok($$ insert into category_requests (user_id, requested_name) select auth.uid(), 'Categorie ' || n from generate_series(1, 5) n $$, '5 category requests in a day are accepted');
select throws_ok($$ insert into category_requests (user_id, requested_name) values (auth.uid(), 'Categorie six') $$, '42501', 'limit_reached', 'the 6th category request is refused');
select lives_ok($$ insert into feedback (user_id, type, body) select auth.uid(), 'idea', 'idee ' || n from generate_series(1, 3) n $$, '3 feedbacks in an hour are accepted');
select throws_ok($$ insert into feedback (user_id, type, body) values (auth.uid(), 'idea', 'idee 4') $$, '42501', 'limit_reached', 'the 4th feedback is refused');
select tests.act_as_anon();
select lives_ok($$ insert into feedback (type, body) select 'idea', 'anonyme ' || n from generate_series(1, 5) n $$, 'anonymous feedback is not limited');
select throws_ok($$ select public.take_limit('x', 1, interval '1 hour') $$, '42501', null, 'take_limit is not callable by clients');
select throws_ok($$ select * from public.limit_log $$, '42501', null, 'limit_log is not readable by clients');

-- the admin queue
select tests.act_as_superuser();
select id as r_msg1 from reports where target_type = 'message' and target_id = '00000000-0000-0000-0000-0000000000b1' \gset
select id as r_msg2 from reports where target_type = 'message' and target_id = '00000000-0000-0000-0000-0000000000b2' \gset
select id as r_msg3 from reports where target_type = 'message' and target_id = '00000000-0000-0000-0000-0000000000b3' \gset
select id as r_act1 from reports where reporter_id = :'ana' and target_type = 'activity' and target_id = '00000000-0000-0000-0000-0000000000a1' \gset
select id as r_act1b from reports where reporter_id = :'gus' and target_type = 'activity' and target_id = '00000000-0000-0000-0000-0000000000a1' \gset
select id as r_act4 from reports where target_type = 'activity' and target_id = '00000000-0000-0000-0000-0000000000a4' \gset
select id as r_ses from reports where target_type = 'session' \gset
select id as r_col from reports where target_type = 'collectif' \gset
select id as r_asso from reports where target_type = 'association' \gset
select id as r_usr from reports where target_type = 'user' \gset
delete from messages where id = '00000000-0000-0000-0000-0000000000b1';
select tests.act_as_aal1(:'adm');
select throws_ok($$ select admin_reports() $$, '42501', 'not_allowed', 'the queue refuses aal1');
select tests.act_as_admin(:'ana');
select throws_ok($$ select admin_reports() $$, '42501', 'not_allowed', 'the queue refuses non-admins');
select tests.act_as_admin(:'adm');
select is((select i->>'preview' from jsonb_array_elements(admin_reports()->'items') i where i->>'id' = :'r_msg1'), 'Bonjour a tous', 'a message preview is the snapshot, even after the message was deleted');
select is((select i->>'preview' from jsonb_array_elements(admin_reports()->'items') i where i->>'id' = :'r_act1'), 'Go du mardi - Cafe', 'an activity preview is its title and place');
select is((select i->>'preview' from jsonb_array_elements(admin_reports()->'items') i where i->>'id' = :'r_usr'), 'Ben', 'a user preview is the first name');
select is((select i->>'preview' from jsonb_array_elements(admin_reports()->'items') i where i->>'id' = :'r_col'), 'Les Testeurs', 'a collectif preview is its name');
select is((select i->'target_owner'->>'first_name' from jsonb_array_elements(admin_reports()->'items') i where i->>'id' = :'r_msg1'), 'Ben', 'the queue shows the owner');
select is((select i->>'reporter_first_name' from jsonb_array_elements(admin_reports()->'items') i where i->>'id' = :'r_msg1'), 'Ana', 'the queue shows the reporter');
select ok((admin_reports()->>'open_count')::int >= 10, 'the queue counts open reports');
select is(jsonb_array_length(admin_reports('open', null, null, 2)->'items'), 2, 'the queue honours the limit');

-- decisions
select throws_ok(format($$ select admin_decide_report(%L, 'dismiss', 'court') $$, :'r_usr'), '23514', null, 'a statement under 10 characters is refused');
select throws_ok(format($$ select admin_decide_report(%L, 'explode', 'Une raison assez longue') $$, :'r_usr'), '23514', null, 'an unknown decision is refused');
select tests.act_as_aal1(:'adm');
select throws_ok(format($$ select admin_decide_report(%L, 'dismiss', 'Une raison assez longue') $$, :'r_usr'), '42501', 'not_allowed', 'deciding needs aal2');
select tests.act_as_admin(:'adm');
select lives_ok(format($$ select admin_decide_report(%L, 'remove', 'Message contraire aux regles.') $$, :'r_msg2'), 'remove a message');
select is((select count(*) from messages where id = '00000000-0000-0000-0000-0000000000b2')::int, 0, 'the message is deleted');
select tests.act_as_superuser();
select is((select status || '/' || decision || '/' || (decided_by = :'adm')::text from reports where id = :'r_msg2'), 'actioned/remove/true', 'the report records the decision');
select is((select count(*) from admin_audit_log where target_id = :'r_msg2' and action = 'report_decision')::int, 1, 'exactly one audit row');
select tests.act_as_admin(:'adm');
select throws_ok(format($$ select admin_decide_report(%L, 'dismiss', 'Une raison assez longue') $$, :'r_msg2'), '42501', 'already_decided', 'deciding twice is refused');
select lives_ok(format($$ select admin_decide_report(%L, 'ban', 'Comportement grave et repete.') $$, :'r_msg3'), 'ban on a message');
select is((select banned_at is not null from profiles where id = :'hal'), true, 'the message author is banned');
select lives_ok(format($$ select admin_decide_report(%L, 'remove', 'Activite non conforme.') $$, :'r_act4'), 'remove an activity');
select is((select archived_at is not null from activities where id = '00000000-0000-0000-0000-0000000000a4'), true, 'the activity is archived');
select lives_ok(format($$ select admin_decide_report(%L, 'remove', 'Seance non conforme.') $$, :'r_ses'), 'remove a session');
select is((select status from sessions where id = :'s1'), 'cancelled_by_organiser', 'the session is cancelled');
select lives_ok(format($$ select admin_decide_report(%L, 'remove', 'Collectif non conforme.') $$, :'r_col'), 'remove a collectif');
select is((select count(*) from collectifs where id = '00000000-0000-0000-0000-00000000c0a1')::int, 0, 'the collectif is deleted');
select lives_ok(format($$ select admin_decide_report(%L, 'warn', 'Avertissement pour la forme.') $$, :'r_asso'), 'warn on an association');
select lives_ok(format($$ select admin_decide_report(%L, 'warn', 'Le message a deja disparu.') $$, :'r_msg1'), 'a decision on a target that is already gone succeeds');
select lives_ok(format($$ select admin_decide_report(%L, 'dismiss', 'Rien a signaler ici.') $$, :'r_act1'), 'dismiss one of two reports on an activity');
select tests.act_as_superuser();
select is((select status from reports where id = :'r_act1b'), 'dismissed', 'the other open report on the same target is closed too');
select is((select statement_of_reasons from reports where id = :'r_act1b'), 'Rien a signaler ici.', 'with the same statement');
select is((select count(*) from admin_audit_log where action = 'report_decision')::int, 8, 'one audit row per decision, none for the sibling');

-- notifications
select is((select count(*) from notification_outbox where user_id = :'gus' and kind = 'report_handled')::int, 5, 'each reporter gets a handled notice');
select is((select title || ' / ' || body from notification_outbox where user_id = :'gus' and kind = 'report_handled' limit 1), 'Information de modération / Ouvrez l''application pour voir le détail.', 'the reporter text is generic');
select is((select title || ' / ' || body from notification_outbox where user_id = :'fay' and kind = 'moderation_notice'), 'Information de modération / Ouvrez l''application pour voir le détail.', 'the owner text is generic');
select is((select data from notification_outbox where user_id = :'fay' and kind = 'moderation_notice'), jsonb_build_object('kind', 'moderation_notice', 'report_id', :'r_msg2'::uuid), 'the data holds only the kind and the report');
select is((select count(*) from notification_outbox where user_id = :'org' and kind = 'moderation_notice')::int, 2, 'the owner of a removed activity and session is told, not for a dismissal');
select is((select count(*) from notification_outbox where user_id = :'ben' and kind = 'moderation_notice')::int, 1, 'the owner of a gone message is still told');

-- notices
select tests.act_as(:'fay');
select is(jsonb_array_length(my_moderation_notices()->'decisions'), 1, 'the owner sees the decision');
select is(my_moderation_notices()->'decisions'->0->>'statement_of_reasons', 'Message contraire aux regles.', 'with its statement');
select is(jsonb_array_length(my_moderation_notices()->'handled_reports'), 0, 'and no handled report of their own');
select tests.act_as(:'gus');
select is(jsonb_array_length(my_moderation_notices()->'handled_reports'), 5, 'the reporter sees their handled reports');
select is(position('Message contraire' in my_moderation_notices()::text), 0, 'but not the statement');
select is(jsonb_array_length(my_moderation_notices()->'decisions'), 0, 'nor decisions about others');
select tests.act_as(:'org');
select is(jsonb_array_length(my_moderation_notices()->'decisions'), 2, 'a dismissal is not shown to the owner');
select tests.act_as_anon();
select throws_ok($$ select my_moderation_notices() $$, '42501', null, 'anon has no notices');

-- blocked list
select tests.act_as(:'ana');
select is(my_blocked(), jsonb_build_array(jsonb_build_object('user_id', :'dan'::uuid, 'first_name', 'Dan')), 'my_blocked lists own blocks');
select tests.act_as(:'dan');
select is(my_blocked(), '[]'::jsonb, 'my_blocked shows nobody the people who blocked them');

-- the word filter
select tests.act_as_admin(:'ana');
select throws_ok($$ select admin_set_banned_word('elephant', true) $$, '42501', 'not_allowed', 'only admins edit the word list');
select tests.act_as_admin(:'adm');
select lives_ok($$ select admin_set_banned_word('  Éléphant ', true) $$, 'an admin adds a word');
select is((select word from banned_words), 'elephant', 'words are stored unaccented and lower case');
select tests.act_as_superuser();
select is((select count(*) from admin_audit_log where action = 'banned_word_add')::int, 1, 'the change is audited');
select tests.act_as(:'ana');
select throws_ok($$ insert into messages (activity_id, body) values ('00000000-0000-0000-0000-0000000000a1', 'un elephant rose') $$, '23514', 'content_refused', 'a banned word is refused');
select throws_ok($$ insert into messages (activity_id, body) values ('00000000-0000-0000-0000-0000000000a1', 'Un ÉLÉPHANT, rose') $$, '23514', 'content_refused', 'accents and capitals do not help');
select lives_ok($$ insert into messages (activity_id, body) values ('00000000-0000-0000-0000-0000000000a1', 'des elephantes et un pelephant') $$, 'a word that merely contains it is accepted');
select tests.act_as(:'pia');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values (auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Elephant club', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 3, '19:00') $$, '23514', 'content_refused', 'an activity title is filtered');
select throws_ok($$ insert into collectifs (name, town_label, town_point, created_by) values ('Mon éléphant', 'Lyon', 'POINT(4.85 45.77)', auth.uid()) $$, '23514', 'content_refused', 'a collectif name is filtered');
select tests.act_as_superuser();
select lives_ok($$ insert into messages (activity_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000a1', (select id from profiles limit 1), 'elephant du service') $$, 'the service role is not filtered');
select tests.act_as_admin(:'adm');
select lives_ok($$ select admin_set_banned_word('elephant', false) $$, 'an admin removes a word');
select is((select count(*) from banned_words)::int, 0, 'the list is empty again');

-- spam becomes an automatic report
select tests.act_as(:'pia');
select lives_ok($$ insert into activities (id, organiser_id, category_id, title, description, place_label, place, recurrence_kind, start_date, start_time) values ('00000000-0000-0000-0000-0000000000a5', auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Promo', 'http://a.fr http://b.fr http://c.fr http://d.fr', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 3, '19:00') $$, 'a spammy activity is accepted');
select tests.act_as_superuser();
select is((select count(*) from reports where source = 'auto' and target_type = 'activity' and target_id = '00000000-0000-0000-0000-0000000000a5' and reporter_id is null and reason = 'fake_or_spam')::int, 1, 'it creates one automatic report');
select tests.act_as(:'ana');
select lives_ok($$ insert into messages (activity_id, body) values ('00000000-0000-0000-0000-0000000000a1', 'Achetez ici'), ('00000000-0000-0000-0000-0000000000a1', 'Achetez ici'), ('00000000-0000-0000-0000-0000000000a1', 'Achetez ici') $$, 'the same message three times is accepted');
select tests.act_as_superuser();
select is((select count(*) from reports where source = 'auto' and target_type = 'message' and reporter_id is null)::int, 1, 'it creates one automatic report');
select is((select count(*) from reports r join report_snapshots s on s.report_id = r.id where r.source = 'auto')::int, 1, 'the automatic message report keeps its snapshot');

-- hardening round: column grants, admins, word list bounds, blocks in both directions, owners
select tests.act_as(:'gus');
select throws_ok($$ select statement_of_reasons from reports $$, '42501', null, 'a reporter cannot read the statement through the table');
select throws_ok($$ select target_owner from reports $$, '42501', null, 'a reporter cannot read the owner');
select throws_ok($$ select decided_by from reports $$, '42501', null, 'a reporter cannot read the moderator');
select lives_ok($$ select id, status, decided_at from reports $$, 'a reporter reads the granted columns');

select tests.act_as_superuser();
update profiles set role = 'admin' where id = :'adm2';
insert into activity_members (activity_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', :'adm2'), ('00000000-0000-0000-0000-0000000000a1', :'uma'),
  ('00000000-0000-0000-0000-0000000000a1', :'vic'), ('00000000-0000-0000-0000-0000000000a1', :'wen');
insert into messages (id, activity_id, sender_id, body) values
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000a1', :'vic', 'Message de Vic'),
  ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000a1', :'adm2', 'Message de admin');
insert into blocks (blocker_id, blocked_id) values (:'uma', :'vic'), (:'vic', :'wen');
insert into associations (id, name, source, claimed_by, created_by) values
  ('00000000-0000-0000-0000-0000000000d2', 'Club Deux', 'community', :'cat', :'ben');
insert into associations (id, name, source, created_by) values
  ('00000000-0000-0000-0000-0000000000d3', 'Club Trois', 'community', :'ben');

-- a block made by the reporter does not stop a report; one made by the other person does
select tests.act_as(:'uma');
select lives_ok(format($$ insert into reports (target_type, target_id, reason) values ('user', %L, 'harassment') $$, :'vic'), 'the blocker can report the person they blocked');
select lives_ok($$ insert into reports (target_type, target_id, reason) values ('message', '00000000-0000-0000-0000-0000000000b5', 'harassment') $$, 'the blocker can report that persons message');
select tests.act_as(:'wen');
select throws_ok(format($$ insert into reports (target_type, target_id, reason) values ('user', %L, 'other') $$, :'vic'), '42501', 'not_allowed', 'a person blocked by the target cannot report them');
select throws_ok($$ insert into reports (target_type, target_id, reason) values ('message', '00000000-0000-0000-0000-0000000000b5', 'other') $$, '42501', 'not_allowed', 'nor their message');

-- forged source and owner from a client are overwritten
select tests.act_as(:'uma');
select lives_ok(format($$ insert into reports (target_type, target_id, reason, source, target_owner) values ('user', %L, 'other', 'auto', %L) $$, :'adm2', :'uma'), 'a forged source and owner are accepted but overwritten');
select tests.act_as_superuser();
select is((select source || '/' || reporter_id::text || '/' || target_owner::text from reports where target_type = 'user' and target_id = :'adm2'), 'user/' || :'uma' || '/' || :'adm2', 'source, reporter and owner are set by the server');

-- association owners
select tests.act_as(:'wen');
select lives_ok($$ insert into reports (target_type, target_id, reason) values ('association', '00000000-0000-0000-0000-0000000000d2', 'other'), ('association', '00000000-0000-0000-0000-0000000000d3', 'other'), ('association', '00000000-0000-0000-0000-0000000000d1', 'other') $$, 'associations can be reported');
select tests.act_as_superuser();
select is((select target_owner from reports where target_id = '00000000-0000-0000-0000-0000000000d2' and reporter_id = :'wen'), :'cat'::uuid, 'the owner of a claimed association is the claimant');
select is((select target_owner from reports where target_id = '00000000-0000-0000-0000-0000000000d3'), :'ben'::uuid, 'otherwise it is the creator');
select id as r_adm2 from reports where target_type = 'user' and target_id = :'adm2' \gset
select id as r_d1 from reports where target_id = '00000000-0000-0000-0000-0000000000d1' and reporter_id = :'wen' \gset
insert into reports (reporter_id, target_type, target_id, reason) values (:'uma', 'message', '00000000-0000-0000-0000-0000000000b6', 'other');
select id as r_selfmsg from reports where target_id = '00000000-0000-0000-0000-0000000000b6' \gset

-- admins cannot be banned or removed, nor can a moderator ban themself
select tests.act_as_admin(:'adm');
select throws_ok(format($$ select admin_decide_report(%L, 'ban', 'Tentative de bannir un admin.') $$, :'r_adm2'), '42501', 'not_allowed', 'banning an admin is refused');
select throws_ok(format($$ select admin_decide_report(%L, 'remove', 'Tentative de retirer un admin.') $$, :'r_adm2'), '42501', 'not_allowed', 'removing an admin user is refused');
select lives_ok(format($$ select admin_decide_report(%L, 'warn', 'Avertissement a un admin.') $$, :'r_adm2'), 'warning an admin is allowed');
select tests.act_as_admin(:'adm2');
select throws_ok(format($$ select admin_decide_report(%L, 'ban', 'Tentative de se bannir.') $$, :'r_selfmsg'), '42501', 'not_allowed', 'a moderator cannot ban themself');
select tests.act_as_admin(:'adm');
select lives_ok(format($$ select admin_decide_report(%L, 'ban', 'Aucun responsable connu.') $$, :'r_d1'), 'a ban with no known owner still records the decision');
select tests.act_as_superuser();
select is((select details ->> 'owner_missing' from admin_audit_log where target_id = :'r_d1'), 'true', 'the audit row notes the missing owner');

-- the word list is bounded
select tests.act_as_admin(:'adm');
select throws_ok($$ select admin_set_banned_word('ab', true) $$, '23514', null, 'a two-character word is refused');
select throws_ok($$ select admin_set_banned_word('---', true) $$, '23514', null, 'a word without letters or digits is refused');
select tests.act_as_superuser();
insert into banned_words (word) select 'mot' || lpad(n::text, 4, '0') from generate_series(1, 500) n;
select tests.act_as_admin(:'adm');
select throws_ok($$ select admin_set_banned_word('encoreun', true) $$, '42501', 'limit_reached', 'the list is capped at 500 words');
select tests.act_as_superuser();
delete from banned_words;

-- structure
select is(has_function_privilege('authenticated', 'public.text_has_banned_word(text)', 'execute'), false, 'the word matcher is internal');
select is(has_function_privilege('anon', 'public.admin_reports(text, timestamptz, uuid, int)', 'execute'), false, 'anon cannot call the queue');
select is(has_function_privilege('authenticated', 'public.my_blocked()', 'execute'), true, 'authenticated can list blocks');
select * from finish();
rollback;
