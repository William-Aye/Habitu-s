begin;
\ir helpers.inc
select plan(31);
select tests.create_user('org@ff.fr', 'Olivier') as org \gset
select tests.create_user('mem@ff.fr', 'Mia') as mem \gset
select tests.create_user('mem2@ff.fr', 'Marc') as mem2 \gset
select tests.create_user('wel@ff.fr', 'Wendy') as wel \gset
select tests.create_user('req@ff.fr', 'Rose') as req \gset
select tests.create_user('resp@ff.fr', 'Rita') as resp \gset
select tests.create_user('inv@ff.fr', 'Ines') as inv \gset
select tests.create_user('inv2@ff.fr', 'Ivan') as inv2 \gset
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');

-- an activity of 2 seats with future sessions
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, max_size) values
  ('00000000-0000-0000-0000-0000000000f1', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go du soir', 'Cafe', 'POINT(4.85 45.77)', 'weekly',
   current_date + 2, '19:00', 2);
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000f1', :'mem', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'mem2', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'wel', 'member');
select id as s1 from sessions where activity_id = '00000000-0000-0000-0000-0000000000f1' order by starts_at limit 1 \gset
select id as s2 from sessions where activity_id = '00000000-0000-0000-0000-0000000000f1' order by starts_at offset 1 limit 1 \gset
insert into attendances (session_id, user_id, status) values
  (:'s1', :'mem', 'confirmed'), (:'s2', :'mem', 'confirmed'), (:'s1', :'mem2', 'confirmed'), (:'s1', :'wel', 'cancelled');
-- a past session with an attendance of mem
insert into sessions (id, activity_id, starts_at) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', now() - interval '3 days');
insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-0000000000e1', :'mem', 'confirmed');
update activities set welcome_member_id = :'wel' where id = '00000000-0000-0000-0000-0000000000f1';

-- M2: the welcome person's name needs an active membership
select tests.act_as(:'mem');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f1')->>'welcome_first_name', 'Wendy', 'welcome name shown while the welcome person is a member');
select tests.act_as_superuser();
-- I2: leaving frees the seats
select is((select count(*)::int from attendances where session_id = :'s1' and status = 'confirmed'), 2, 'seats before leaving: 2');
select tests.act_as(:'mem');
delete from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f1' and user_id = :'mem';
select tests.act_as_superuser();
select is((select count(*)::int from attendances where user_id = :'mem' and session_id in (:'s1', :'s2')), 0, 'leaving deletes future attendances');
select is((select count(*)::int from attendances where user_id = :'mem' and session_id = '00000000-0000-0000-0000-0000000000e1'), 1, 'past attendances are kept');
select is((select count(*)::int from attendances where session_id = :'s1' and status = 'confirmed'), 1, 'the seat is free');
select is((select count(*)::int from attendances where user_id = :'mem2' and session_id = :'s1'), 1, 'other attendances are untouched');

-- removed by the organiser: attendances gone, welcome role cleared
select tests.act_as(:'mem2');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f1')->>'welcome_first_name', 'Wendy', 'welcome name before the welcome person is removed');
select tests.act_as_superuser();
update activity_members set status = 'removed' where activity_id = '00000000-0000-0000-0000-0000000000f1' and user_id = :'wel';
select is((select welcome_member_id from activities where id = '00000000-0000-0000-0000-0000000000f1'), null, 'a removed welcome person is cleared');
update activity_members set status = 'removed' where activity_id = '00000000-0000-0000-0000-0000000000f1' and user_id = :'mem2';
select is((select count(*)::int from attendances where user_id = :'mem2'), 0, 'a removed member keeps no future attendance');
-- M2 (view): a welcome id that is no longer an active member is not named
select tests.act_as_superuser();
update activity_members set status = 'member' where activity_id = '00000000-0000-0000-0000-0000000000f1' and user_id in (:'wel', :'mem2');
update activities set welcome_member_id = :'wel' where id = '00000000-0000-0000-0000-0000000000f1';
alter table activity_members disable trigger activity_members_removed;
update activity_members set status = 'removed' where activity_id = '00000000-0000-0000-0000-0000000000f1' and user_id = :'wel';
alter table activity_members enable trigger activity_members_removed;
select tests.act_as(:'mem2');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f1')->'welcome_first_name', 'null'::jsonb,
  'the view hides a welcome person who is no longer a member');
select tests.act_as_superuser();

-- blocks clear pending requests in both directions
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, approval_mode) values
  ('00000000-0000-0000-0000-0000000000f2', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go sur demande', 'Parc', 'POINT(4.85 45.77)', 'weekly',
   current_date + 2, '19:00', 'approval'),
  ('00000000-0000-0000-0000-0000000000f3', :'req', '00000000-0000-0000-0000-0000000000c1', 'Go de Rose', 'Parc', 'POINT(4.85 45.77)', 'weekly',
   current_date + 2, '19:00', 'approval');
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000f2', :'req', 'pending'),
  ('00000000-0000-0000-0000-0000000000f3', :'org', 'pending'),
  ('00000000-0000-0000-0000-0000000000f3', :'mem', 'pending');
select tests.act_as(:'org');
insert into blocks (blocker_id, blocked_id) values (:'org', :'req');
select tests.act_as_superuser();
select is((select count(*)::int from activity_members where user_id = :'req' and activity_id = '00000000-0000-0000-0000-0000000000f2'), 0,
  'the blocked requester pending on the blocker''s activity is removed');
select is((select count(*)::int from activity_members where user_id = :'org' and activity_id = '00000000-0000-0000-0000-0000000000f3'), 0,
  'the blocker''s pending request on the blocked person''s activity is removed');
select is((select count(*)::int from activity_members where user_id = :'mem' and activity_id = '00000000-0000-0000-0000-0000000000f3'), 1,
  'unrelated pending requests stay');

-- collectif invitations
insert into collectifs (id, name, town_label, town_point, created_by) values
  ('00000000-0000-0000-0000-00000000c0a1', 'Les Joueurs', 'Lyon', 'POINT(4.85 45.77)', :'resp');
select tests.act_as(:'resp');
insert into collectif_members (collectif_id, user_id, role, status) values ('00000000-0000-0000-0000-00000000c0a1', :'inv', 'organiser', 'invited');
select tests.act_as_superuser();
select is((select dedupe_key from notification_outbox where user_id = :'inv' and kind = 'collectif_invitation'),
  'collectif_invite:00000000-0000-0000-0000-00000000c0a1:' || :'inv', 'the invitation notification has a dedupe key');
select is((select data from notification_outbox where user_id = :'inv' and kind = 'collectif_invitation'),
  jsonb_build_object('collectif_id', '00000000-0000-0000-0000-00000000c0a1'), 'its data carries the collectif id');
-- decline and re-invite: no second notification
select tests.act_as(:'inv');
delete from collectif_members where user_id = :'inv';
select tests.act_as(:'resp');
insert into collectif_members (collectif_id, user_id, role, status) values ('00000000-0000-0000-0000-00000000c0a1', :'inv', 'organiser', 'invited');
select tests.act_as_superuser();
select is((select count(*)::int from notification_outbox where user_id = :'inv' and kind = 'collectif_invitation'), 1, 're-inviting does not re-notify');
-- a block between the responsable and the invitee clears the pending invitation
insert into blocks (blocker_id, blocked_id) values (:'inv', :'resp');
select is((select count(*)::int from collectif_members where user_id = :'inv'), 0, 'a block clears the pending collectif invitation');
delete from blocks;

-- cap: 10 invitations per responsable per 24 h (the one above already counts once via invited_at)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bulk' || g || '@ff.fr', '',
       '{}'::jsonb, '{"first_name":"Bulk"}'::jsonb, now(), now()
  from generate_series(1, 11) g;
create temp table bulk as select id, row_number() over (order by email) as n from auth.users where email like 'bulk%@ff.fr';
grant select on bulk to authenticated;
select tests.act_as(:'resp');
select lives_ok($$ insert into collectif_members (collectif_id, user_id, role, status)
  select '00000000-0000-0000-0000-00000000c0a1', id, 'organiser', 'invited' from bulk where n <= 10 $$, 'ten invitations in a day are accepted');
select throws_ok($$ insert into collectif_members (collectif_id, user_id, role, status)
  select '00000000-0000-0000-0000-00000000c0a1', id, 'organiser', 'invited' from bulk where n = 11 $$, '42501', 'limit_reached', 'the eleventh is refused');
select tests.act_as_superuser();
select lives_ok($$ insert into collectif_members (collectif_id, user_id, role, status)
  select '00000000-0000-0000-0000-00000000c0a1', id, 'organiser', 'invited' from bulk where n = 11 $$, 'the service role is not limited');
select is(has_function_privilege('authenticated', 'public.collectif_members_invite_limit()', 'execute'), false, 'the limit trigger function is not callable');

-- reports can target a collectif
select tests.act_as(:'mem');
select lives_ok($$ insert into reports (reporter_id, target_type, target_id, reason)
  values (auth.uid(), 'collectif', '00000000-0000-0000-0000-00000000c0a1', 'fake_or_spam') $$, 'a collectif can be reported');
select throws_ok($$ insert into reports (reporter_id, target_type, target_id, reason)
  values (auth.uid(), 'planet', '00000000-0000-0000-0000-00000000c0a1', 'other') $$, '23514', null, 'other target types stay refused');

-- export: collectif memberships, collectifs created, notifications
select tests.act_as(:'resp');
select is(jsonb_array_length(public.export_my_data()->'collectif_memberships'), 1, 'export lists the collectif memberships');
select is(public.export_my_data()->'collectifs_created'->0->>'name', 'Les Joueurs', 'export lists the collectifs created');
select tests.act_as(:'inv2');
select is(public.export_my_data()->'notifications', '[]'::jsonb, 'export lists notifications (none yet)');
select tests.act_as_superuser();
insert into notification_outbox (user_id, kind, title, body) values (:'inv2', 'x', 'Titre', 'Corps');
select tests.act_as(:'inv2');
select is(public.export_my_data()->'notifications'->0->>'title', 'Titre', 'export lists the caller''s notifications');

-- M6: candidates ignore archived activities
select tests.act_as_superuser();
update activities set organised_by_collectif_id = '00000000-0000-0000-0000-00000000c0a1', organiser_id = :'resp' where id = '00000000-0000-0000-0000-0000000000f2';
insert into activity_members (activity_id, user_id, status) values ('00000000-0000-0000-0000-0000000000f2', :'mem', 'pending');
update activity_members set status = 'member' where activity_id = '00000000-0000-0000-0000-0000000000f2' and user_id = :'mem';
select tests.act_as(:'resp');
select is((select count(*)::int from public.collectif_candidates('00000000-0000-0000-0000-00000000c0a1') where first_name = 'Mia'), 1, 'a member of a live activity is a candidate');
select tests.act_as_superuser();
update activities set archived_at = now() where id = '00000000-0000-0000-0000-0000000000f2';
select tests.act_as(:'resp');
select is((select count(*)::int from public.collectif_candidates('00000000-0000-0000-0000-00000000c0a1') where first_name = 'Mia'), 0, 'members of archived activities are not candidates');

-- I1: linkable search puts prefix matches first
select tests.act_as_superuser();
insert into associations (name, source, verified) values ('Zumba Echecs', 'rna', false), ('Echecs Zebre', 'rna', false), ('Aaa Echecs', 'rna', false);
select tests.act_as(:'mem');
select is((select array_agg(name) from public.search_linkable_associations('echecs')), array['Echecs Zebre', 'Aaa Echecs', 'Zumba Echecs'],
  'prefix matches come first, then by name');

-- I5: an answer that sends only the status (upsert without guest_count) keeps the guest and passes RLS
select tests.act_as_superuser();
insert into activity_members (activity_id, user_id, status) values ('00000000-0000-0000-0000-0000000000f1', :'inv2', 'member');
insert into attendances (session_id, user_id, status, guest_count) values (:'s2', :'inv2', 'cancelled', 1);
select tests.act_as(:'inv2');
insert into attendances (session_id, user_id, status) values (:'s2', :'inv2', 'confirmed')
  on conflict (session_id, user_id) do update set status = excluded.status;
select is((select status || ':' || guest_count from attendances where session_id = :'s2' and user_id = :'inv2'), 'confirmed:1',
  'a status-only upsert keeps the guest');

select * from finish();
rollback;
