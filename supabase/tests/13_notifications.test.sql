begin;
\ir helpers.inc
select plan(72);
select tests.create_user('org@not.fr', 'Olivier') as org \gset
select tests.create_user('mem@not.fr', 'Mia') as mem \gset
select tests.create_user('memen@not.fr', 'Mike') as memen \gset
select tests.create_user('mem2@not.fr', 'Marc') as mem2 \gset
select tests.create_user('out@not.fr', 'Hugo') as outsider \gset
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
select tests.create_user('noname@not.fr', 'x') as noname \gset
update profiles set language = 'en' where id = :'memen';
update profiles set first_name = '' where id = :'noname';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');

-- structure and privileges
select has_table('public', 'push_tokens', 'push_tokens exists');
select has_table('public', 'notification_outbox', 'notification_outbox exists');
select is(has_table_privilege('authenticated', 'public.notification_outbox', 'select'), false, 'authenticated cannot read the outbox');
select is(has_table_privilege('anon', 'public.notification_outbox', 'select'), false, 'anon cannot read the outbox');
select is(has_function_privilege('anon', 'public.register_push_token(text, text)', 'execute'), false, 'anon cannot register a token');
select is((select schedule from cron.job where jobname = 'enqueue-reminders'), '*/15 * * * *', 'reminder job every 15 minutes');
select is((select schedule from cron.job where jobname = 'drain-outbox'), '* * * * *', 'drain job every minute');
select is((select schedule from cron.job where jobname = 'prune-outbox'), '45 3 * * *', 'prune job scheduled');
select has_column('public', 'notification_outbox', 'last_error', 'outbox stores the last error');
select is(has_function_privilege('authenticated', 'public.claim_outbox(int)', 'execute') or has_function_privilege('anon', 'public.claim_outbox(int)', 'execute'), false, 'API roles cannot claim the outbox');
select is(has_function_privilege('authenticated', 'public.drain_outbox()', 'execute') or has_function_privilege('anon', 'public.drain_outbox()', 'execute'), false, 'API roles cannot drain the outbox');
select is(has_function_privilege('authenticated', 'public.enqueue_reminders(timestamptz)', 'execute') or has_function_privilege('anon', 'public.enqueue_reminders(timestamptz)', 'execute'), false, 'API roles cannot enqueue reminders');

-- push tokens
select tests.act_as(:'mem');
select lives_ok($$select public.register_push_token('ExponentPushToken[aaaaaaaaaa]', 'ios')$$, 'register a token');
select lives_ok($$select public.register_push_token('ExponentPushToken[aaaaaaaaaa]', 'android')$$, 'registering again upserts');
select is((select count(*)::int from push_tokens), 1, 'one row for the caller');
select is((select platform from push_tokens), 'android', 'upsert updated the platform');
select throws_ok($$select public.register_push_token('x', 'ios')$$, '22023', null, 'short token refused');
select tests.act_as(:'memen');
select is((select count(*)::int from push_tokens), 0, 'another user sees none of it');
select lives_ok($$select public.register_push_token('ExponentPushToken[aaaaaaaaaa]', 'ios')$$, 'a shared device re-assigns the token');
select is(public.export_my_data()->'push_tokens'->0->>'token', 'ExponentPushToken[aaaaaaaaaa]', 'the export lists the caller''s push token');
select tests.act_as_superuser();
select is((select user_id from push_tokens where token = 'ExponentPushToken[aaaaaaaaaa]'), :'memen'::uuid, 'token now belongs to the new user');
select tests.act_as(:'mem');
select is((select count(*)::int from push_tokens), 0, 'the previous user no longer has it');
select is(public.export_my_data()->'push_tokens', '[]'::jsonb, 'the export of the previous user has no token');
select throws_ok($$select count(*) from notification_outbox$$, '42501', null, 'outbox is unreadable by authenticated');
select tests.act_as_anon();
select throws_ok($$select public.register_push_token('ExponentPushToken[bbbbbbbbbb]', 'ios')$$, '42501', null, 'anon cannot call register_push_token');
select tests.act_as_superuser();

-- activities
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, approval_mode) values
  ('00000000-0000-0000-0000-0000000000f1', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go du mardi', 'Cafe du Parc', 'POINT(4.85 45.77)', 'weekly', current_date + 30, '19:00', 'open'),
  ('00000000-0000-0000-0000-0000000000f2', :'org', '00000000-0000-0000-0000-0000000000c1', 'Club prive', 'Salle', 'POINT(4.85 45.77)', 'weekly', current_date + 30, '19:00', 'approval');

-- new member / join request / accepted
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000f1', :'mem', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'memen', 'member');
select is((select count(*)::int from notification_outbox where user_id = :'org' and kind = 'new_member'), 2, 'one new_member row per join');
select is((select title || ' / ' || body from notification_outbox where user_id = :'org' and kind = 'new_member' and body like 'Mia%'),
  'Nouveau membre dans Go du mardi / Mia a rejoint l''activité.', 'organiser text in French, first name only');
-- blocks (either direction) and the empty first name
insert into blocks (blocker_id, blocked_id) values (:'org', :'mem2'), (:'outsider', :'org');
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000f1', :'mem2', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'outsider', 'member');
select is((select count(*)::int from notification_outbox where user_id = :'org' and kind = 'new_member'), 2, 'blocked either way: the organiser is not notified');
insert into activity_members (activity_id, user_id, status) values ('00000000-0000-0000-0000-0000000000f1', :'noname', 'member');
select is((select body from notification_outbox where user_id = :'org' and kind = 'new_member' and body like 'Quelqu%'), 'Quelqu''un a rejoint l''activité.', 'an empty first name gets a neutral phrase');
delete from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f1' and user_id = :'mem';
insert into activity_members (activity_id, user_id, status) values ('00000000-0000-0000-0000-0000000000f1', :'mem', 'member');
select is((select count(*)::int from notification_outbox where user_id = :'org' and kind = 'new_member' and body like 'Mia%'), 1, 'leaving and re-joining does not notify again');
insert into activity_members (activity_id, user_id, status) values ('00000000-0000-0000-0000-0000000000f2', :'memen', 'pending');
select is((select count(*)::int from notification_outbox where user_id = :'org' and kind = 'join_request'), 1, 'one join_request row');
delete from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f2' and user_id = :'memen';
insert into activity_members (activity_id, user_id, status) values ('00000000-0000-0000-0000-0000000000f2', :'memen', 'pending');
select is((select count(*)::int from notification_outbox where user_id = :'org' and kind = 'join_request'), 1, 'asking again does not notify again');
update activity_members set status = 'member' where activity_id = '00000000-0000-0000-0000-0000000000f2' and user_id = :'memen';
select is((select title from notification_outbox where user_id = :'memen' and kind = 'request_accepted'), 'Request accepted', 'accepted requester notified in English');
select is((select count(*)::int from notification_outbox where user_id = :'memen' and kind = 'request_accepted'), 1, 'exactly one request_accepted row');

-- sessions
insert into sessions (id, activity_id, starts_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', now() + interval '10 days'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f1', now() + interval '11 days');
insert into attendances (session_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000a1', :'mem', 'confirmed'),
  ('00000000-0000-0000-0000-0000000000a1', :'memen', 'confirmed'),
  ('00000000-0000-0000-0000-0000000000a1', :'mem2', 'cancelled'),
  ('00000000-0000-0000-0000-0000000000a1', :'org', 'confirmed');
select is((select count(*)::int from notification_outbox where kind = 'late_cancellation'), 0, 'no late-cancellation row for ordinary states');
insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-0000000000a2', :'mem', 'cancelled');
select is((select count(*)::int from notification_outbox where kind = 'late_cancellation'), 0, 'ordinary cancellation does not notify');
update attendances set status = 'cancelled_late' where session_id = '00000000-0000-0000-0000-0000000000a2' and user_id = :'mem';
select is((select count(*)::int from notification_outbox where user_id = :'org' and kind = 'late_cancellation'), 1, 'late cancellation notifies the organiser once');
select ok((select body from notification_outbox where kind = 'late_cancellation') like 'Mia ne viendra pas%', 'late cancellation text uses the first name');
update attendances set status = 'confirmed' where session_id = '00000000-0000-0000-0000-0000000000a2' and user_id = :'mem';
update attendances set status = 'cancelled_late' where session_id = '00000000-0000-0000-0000-0000000000a2' and user_id = :'mem';
select is((select count(*)::int from notification_outbox where kind = 'late_cancellation'), 1, 'toggling does not notify the organiser again');

update sessions set starts_at = starts_at + interval '1 hour' where id = '00000000-0000-0000-0000-0000000000a1';
select is((select count(*)::int from notification_outbox where kind = 'session_moved'), 2, 'session moved: both confirmed attendees, no one else');
select is((select title from notification_outbox where kind = 'session_moved' and user_id = :'memen'), 'Session changed: Go du mardi', 'moved text in English');
select ok((select body from notification_outbox where kind = 'session_moved' and user_id = :'mem') like 'Nouvelle date : %', 'moved text in French');
update sessions set place_label = 'Parc Blandan' where id = '00000000-0000-0000-0000-0000000000a1';
select is((select body from notification_outbox where kind = 'session_moved' and user_id = :'mem' order by id desc limit 1), 'Nouveau lieu : Parc Blandan.', 'place change text');
insert into blocks (blocker_id, blocked_id) values (:'mem', :'org');
update sessions set status = 'cancelled_by_organiser' where id = '00000000-0000-0000-0000-0000000000a1';
select is((select count(*)::int from notification_outbox where kind = 'session_cancelled' and user_id = :'mem'), 1, 'logistics reach an attendee who blocked the organiser');
select is((select count(*)::int from notification_outbox where kind = 'session_cancelled'), 2, 'cancelled: both confirmed attendees');
select is((select count(*)::int from notification_outbox where kind = 'session_cancelled' and user_id in (:'mem2', :'org')), 0, 'cancelled: not the cancelled attendee nor the organiser');

-- recurrence edit leaves a confirmed session at its old time
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000f3', :'org', '00000000-0000-0000-0000-0000000000c1', 'Echecs', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 1, '19:00');
select s.id as kept from sessions s where s.activity_id = '00000000-0000-0000-0000-0000000000f3' order by s.starts_at limit 1 \gset
insert into activity_members (activity_id, user_id, status) values ('00000000-0000-0000-0000-0000000000f3', :'mem', 'member');
insert into attendances (session_id, user_id, status) values (:'kept', :'mem', 'confirmed');
update activities set start_time = '20:00' where id = '00000000-0000-0000-0000-0000000000f3';
select is((select count(*)::int from notification_outbox where kind = 'session_rule_changed'), 1, 'rule change notifies the confirmed attendee of the kept session');
select is((select user_id from notification_outbox where kind = 'session_rule_changed'), :'mem'::uuid, 'and only that attendee');
select ok(exists (select 1 from sessions where id = :'kept'), 'the confirmed session is kept');
delete from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f3';

-- activity-level place change
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000f5', :'org', '00000000-0000-0000-0000-0000000000c1', 'Karaoke', 'Bar', 'POINT(4.85 45.77)', 'weekly', current_date + 30, '19:00');
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000f5', :'mem', 'member'),
  ('00000000-0000-0000-0000-0000000000f5', :'outsider', 'removed');
insert into sessions (id, activity_id, starts_at, place_label) values
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000f5', now() + interval '5 days', null),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000f5', now() + interval '6 days', 'Autre bar');
insert into attendances (session_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000a7', :'mem', 'confirmed'),
  ('00000000-0000-0000-0000-0000000000a7', :'outsider', 'confirmed'),
  ('00000000-0000-0000-0000-0000000000a8', :'mem', 'confirmed');
update activities set place_label = 'Nouveau bar' where id = '00000000-0000-0000-0000-0000000000f5';
select is((select count(*)::int from notification_outbox where body = 'Nouveau lieu : Nouveau bar.' and user_id = :'mem'), 1, 'activity place change: one notification, only for the session using the activity place');
select is((select count(*)::int from notification_outbox where body = 'Nouveau lieu : Nouveau bar.' and user_id = :'outsider'), 0, 'activity place change: a removed member is not notified');

-- collectif invitation
delete from blocks where blocker_id = :'mem';
insert into collectifs (id, name, town_label, town_point, created_by) values
  ('00000000-0000-0000-0000-0000000000d1', 'Les Joueurs', 'Lyon', 'POINT(4.85 45.77)', :'org');
insert into collectif_members (collectif_id, user_id, role, status) values
  ('00000000-0000-0000-0000-0000000000d1', :'mem', 'organiser', 'invited'),
  ('00000000-0000-0000-0000-0000000000d1', :'memen', 'organiser', 'invited');
select is((select count(*)::int from notification_outbox where kind = 'collectif_invitation'), 2, 'one invitation row per invitee');
select is((select title from notification_outbox where kind = 'collectif_invitation' and user_id = :'mem'), 'Invitation à un collectif', 'invitation in French');
select is((select title from notification_outbox where kind = 'collectif_invitation' and user_id = :'memen'), 'Collective invitation', 'invitation in English');
insert into collectif_members (collectif_id, user_id, role, status) values ('00000000-0000-0000-0000-0000000000d1', :'outsider', 'organiser', 'invited');
select is((select count(*)::int from notification_outbox where kind = 'collectif_invitation' and user_id = :'outsider'), 0, 'an invitee who blocked the responsable gets no invitation');

-- day-before reminders
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000f4', :'org', '00000000-0000-0000-0000-0000000000c1', 'Yoga', 'Parc', 'POINT(4.85 45.77)', 'weekly', current_date + 60, '19:00');
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000f4', :'mem', 'member'),
  ('00000000-0000-0000-0000-0000000000f4', :'memen', 'member'),
  ('00000000-0000-0000-0000-0000000000f4', :'mem2', 'member'),
  ('00000000-0000-0000-0000-0000000000f4', :'outsider', 'member');
select ((now() at time zone 'Europe/Paris')::date + time '18:30') at time zone 'Europe/Paris' as t1830 \gset
select ((now() at time zone 'Europe/Paris')::date + time '10:00') at time zone 'Europe/Paris' as t1000 \gset
insert into sessions (id, activity_id, starts_at) values
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000f4',
   ((now() at time zone 'Europe/Paris')::date + 1 + time '19:00') at time zone 'Europe/Paris');
insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-0000000000a5', :'mem2', 'cancelled');
select is(public.enqueue_reminders(:'t1000'), 0, 'nothing is enqueued before 18:00 Paris the day before');
select is(public.enqueue_reminders(:'t1830'), 3, 'three reminders after 18:00: the member who cancelled gets none');
select is((select body from notification_outbox where kind = 'session_reminder' and user_id = :'mem'),
  'Demain 19h00, Yoga — vous serez là ?', 'reminder text in French');
select is((select body from notification_outbox where kind = 'session_reminder' and user_id = :'memen'),
  'Tomorrow at 7:00 PM, Yoga — will you be there?', 'reminder text in English');
select is((select send_after from notification_outbox where kind = 'session_reminder' and user_id = :'mem'),
  :'t1830'::timestamptz, 'the reminder is due when it is enqueued, after 18:00 Paris');
select is(public.enqueue_reminders(:'t1830'), 0, 'dedupe: a second run enqueues nothing');
select is((select data->>'session_id' from notification_outbox where kind = 'session_reminder' and user_id = :'mem'),
  '00000000-0000-0000-0000-0000000000a5', 'reminder carries the session id');

-- stale reminders are never delivered
update notification_outbox set send_after = now() - interval '1 minute' where kind = 'session_reminder';
insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-0000000000a5', :'mem', 'cancelled');
update activity_members set status = 'removed' where activity_id = '00000000-0000-0000-0000-0000000000f4' and user_id = :'outsider';
select claim_outbox as claimed from (select public.claim_outbox(1000)) c \gset
select is((select count(*)::int from jsonb_array_elements(:'claimed'::jsonb) e where e->>'kind' = 'session_reminder'), 1, 'cancelled or departed members get no reminder');
select is((select (e->>'user_id')::uuid from jsonb_array_elements(:'claimed'::jsonb) e where e->>'kind' = 'session_reminder'), :'memen'::uuid, 'only the member still attending gets it');
update notification_outbox set send_after = now() - interval '1 minute' where kind = 'session_reminder' and sent_at is null;
update sessions set status = 'cancelled_by_organiser' where id = '00000000-0000-0000-0000-0000000000a5';
select is((select count(*)::int from jsonb_array_elements(public.claim_outbox(1000)) e where e->>'kind' = 'session_reminder'), 0, 'a reminder for a cancelled session is not delivered');
select is((select count(*)::int from notification_outbox where kind = 'session_reminder' and sent_at is null), 0, 'stale reminders are closed');

-- claiming and draining
update notification_outbox set send_after = now() - interval '1 minute' where sent_at is null;
select is((select jsonb_array_length(public.claim_outbox(1000))), (select count(*)::int from notification_outbox where sent_at is null), 'claim returns every due row');
select is(public.claim_outbox(1000), '[]'::jsonb, 'claimed rows are not handed out twice');
select lives_ok($$select public.drain_outbox()$$, 'drain without secrets does nothing');
select is((select count(*)::int from net.http_request_queue), 0, 'no HTTP request queued without secrets');
select vault.create_secret('test-key', 'send_push_key');
select vault.create_secret('http://localhost:1/functions/v1/send-push', 'send_push_url');
select public.drain_outbox();
select is((select count(*)::int from net.http_request_queue), 0, 'no HTTP request when nothing is due');
update notification_outbox set send_after = now() where id = (select min(id) from notification_outbox where sent_at is null);
select public.drain_outbox();
select is((select count(*)::int from net.http_request_queue), 1, 'one HTTP request queued when a row is due and secrets exist');
select * from finish();
rollback;
