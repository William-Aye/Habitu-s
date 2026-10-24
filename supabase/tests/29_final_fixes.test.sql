begin;
\ir helpers.inc
select plan(103);
select tests.create_user('adm@ff.fr', 'Admin') as adm \gset
select tests.create_user('bad@ff.fr', 'Bertrand') as bad \gset
select tests.create_user('gud@ff.fr', 'Gaelle') as gud \gset
select tests.create_user('mem@ff.fr', 'Marc') as mem \gset
select tests.create_user('old@ff.fr', 'Olivier') as old \gset
select tests.create_user('olb@ff.fr', 'Odile') as olb \gset
update profiles set role = 'admin' where id = :'adm';
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
insert into associations (id, name, purpose, source, confidence, location, city) values
  ('00000000-0000-0000-0000-0000000000a1', 'Club de go de Lyon', 'Jeu de go', 'rna', 60, 'SRID=4326;POINT(4.84 45.76)', 'Lyon'),
  ('00000000-0000-0000-0000-0000000000a2', 'Club de go retire', 'Jeu de go', 'rna', 60, 'SRID=4326;POINT(4.84 45.76)', 'Lyon'),
  ('00000000-0000-0000-0000-0000000000a3', 'Club 100% sur', 'Autre', 'rna', 60, 'SRID=4326;POINT(4.84 45.76)', 'Lyon');
update associations set removed_at = now() where id = '00000000-0000-0000-0000-0000000000a2';
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, max_size) values
  ('00000000-0000-0000-0000-0000000000f1', :'gud', '00000000-0000-0000-0000-0000000000c1', 'Go actif', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 100, '19:00', 10),
  ('00000000-0000-0000-0000-0000000000f2', :'gud', '00000000-0000-0000-0000-0000000000c1', 'Go archive', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 100, '19:00', 10),
  ('00000000-0000-0000-0000-0000000000f3', :'bad', '00000000-0000-0000-0000-0000000000c1', 'Go du banni', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 100, '19:00', 10);
update activities set archived_at = now() where id = '00000000-0000-0000-0000-0000000000f2';
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000f1', :'bad', 'member'), ('00000000-0000-0000-0000-0000000000f1', :'mem', 'member');
insert into sessions (id, activity_id, starts_at) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', now() + interval '3 days');
insert into blocks (blocker_id, blocked_id) values (:'bad', :'gud');

-- ---- I2: banned people cannot write -------------------------------------------------------
select has_function('public', 'refuse_banned_writer', 'the shared trigger function exists');
select is(has_function_privilege('authenticated', 'public.refuse_banned_writer()', 'execute'), false, 'API roles cannot call the trigger function');
select is((select count(*) from pg_trigger where tgname = 'refuse_banned_writer' and not tgisinternal)::int, 12, 'the trigger is on twelve tables');
update profiles set banned_at = now() where id = :'bad';

select tests.act_as(:'bad');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values (auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Nouveau', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 3, '19:00') $$, '42501', 'not_allowed', 'banned: no activity');
select throws_ok($$ insert into collectifs (name, town_label, town_point, created_by) values ('Nouveau collectif', 'Lyon', 'POINT(4.85 45.77)', auth.uid()) $$, '42501', 'not_allowed', 'banned: no collectif');
select throws_ok($$ insert into collectif_members (collectif_id, user_id, role) values (gen_random_uuid(), auth.uid(), 'organiser') $$, '42501', 'not_allowed', 'banned: no collectif membership');
select throws_ok($$ insert into messages (activity_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000f1', auth.uid(), 'Bonjour') $$, '42501', 'not_allowed', 'banned: no message');
select throws_ok($$ insert into associations (name, source, created_by) values ('Club du banni', 'community', auth.uid()) $$, '42501', 'not_allowed', 'banned: no community club');
select throws_ok($$ insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f2', auth.uid()) $$, '42501', 'not_allowed', 'banned: no join request');
select throws_ok($$ insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-0000000000e1', auth.uid(), 'confirmed') $$, '42501', 'not_allowed', 'banned: no attendance');
select throws_ok($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'activity', '00000000-0000-0000-0000-0000000000f1', 'other') $$, '42501', 'not_allowed', 'banned: no report');
select throws_ok($$ insert into feedback (user_id, type, body) values (auth.uid(), 'idea', 'Idee') $$, '42501', 'not_allowed', 'banned: no feedback');
select throws_ok($$ insert into association_claims (association_id, claimant_id, proof_method, role_in_association, contact_email) values ('00000000-0000-0000-0000-0000000000a1', auth.uid(), 'domain_email', 'President', 'a@club.fr') $$, '42501', 'not_allowed', 'banned: no claim');
select throws_ok($$ insert into category_requests (user_id, requested_name) values (auth.uid(), 'Origami') $$, '42501', 'not_allowed', 'banned: no category request');
select throws_ok(format($q$ insert into blocks (blocker_id, blocked_id) values (auth.uid(), %L) $q$, :'mem'), '42501', 'not_allowed', 'banned: no new block');
select lives_ok(format($q$ delete from blocks where blocker_id = auth.uid() and blocked_id = %L $q$, :'gud'), 'banned: may still delete their own data');
select tests.act_as_superuser();
select is((select count(*) from blocks where blocker_id = :'bad')::int, 0, 'the delete went through');

select tests.act_as(:'mem');
select lives_ok($$ insert into category_requests (user_id, requested_name) values (auth.uid(), 'Origami') $$, 'control: a normal member can still write');
select tests.act_as_superuser();

-- messages_notify: a banned sender notifies nobody
insert into messages (activity_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000f1', :'bad', 'Message du banni');
select is((select count(*) from notification_outbox where kind = 'chat_message')::int, 0, 'a banned sender''s message notifies nobody');
insert into messages (activity_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000f1', :'mem', 'Message normal');
select ok((select count(*) from notification_outbox where kind = 'chat_message') > 0, 'control: a normal message notifies');

-- ---- I3: removed content out of the table API --------------------------------------------
select tests.act_as_anon();
select is((select count(*) from associations where id = '00000000-0000-0000-0000-0000000000a2')::int, 0, 'anon cannot read a removed club');
select is((select count(*) from associations where id = '00000000-0000-0000-0000-0000000000a1')::int, 1, 'anon reads an active club');
select is((select count(*) from activities where id = '00000000-0000-0000-0000-0000000000f2')::int, 0, 'anon cannot read an archived activity');
select is((select count(*) from activities where id = '00000000-0000-0000-0000-0000000000f1')::int, 1, 'anon reads an active activity');
select tests.act_as(:'mem');
select is((select count(*) from activities where id = '00000000-0000-0000-0000-0000000000f2')::int, 0, 'another user cannot read an archived activity');
select is((select count(*) from associations where id = '00000000-0000-0000-0000-0000000000a2')::int, 0, 'a signed-in user cannot read a removed club');
select tests.act_as(:'gud');
select is((select count(*) from activities where id = '00000000-0000-0000-0000-0000000000f2')::int, 1, 'the organiser reads their own archived activity');
select tests.act_as_aal1(:'adm');
select is((select count(*) from activities where id = '00000000-0000-0000-0000-0000000000f2')::int, 0, 'an admin without the second factor cannot read it');
select tests.act_as_admin(:'adm');
select is((select count(*) from activities where id = '00000000-0000-0000-0000-0000000000f2')::int, 1, 'an admin with the second factor reads an archived activity');
select is((select count(*) from associations where id = '00000000-0000-0000-0000-0000000000a2')::int, 1, 'an admin reads a removed club');
select tests.act_as_superuser();

-- ---- I4: admin club search ---------------------------------------------------------------
select tests.act_as(:'mem');
select throws_ok($$ select admin_search_associations('club') $$, '42501', 'not_allowed', 'search refuses a non-admin');
select tests.act_as_aal1(:'adm');
select throws_ok($$ select admin_search_associations('club') $$, '42501', 'not_allowed', 'search refuses an admin without the second factor');
select tests.act_as_anon();
select throws_ok($$ select admin_search_associations('club') $$, '42501', null, 'anon cannot call the search');
select tests.act_as_admin(:'adm');
select is(jsonb_array_length(admin_search_associations('club')), 2, 'search finds non-removed clubs only');
select is(admin_search_associations('go de lyon') #>> '{0,name}', 'Club de go de Lyon', 'search matches on name');
select is(admin_search_associations('retire'), '[]'::jsonb, 'search skips removed clubs');
select is(admin_search_associations('c'), '[]'::jsonb, 'a one-letter query returns nothing');
select is(admin_search_associations('%%'), '[]'::jsonb, 'wildcards are matched literally');
select is(jsonb_array_length(admin_search_associations('100%')), 1, 'a literal percent sign still matches');
select is(jsonb_array_length(admin_search_associations('club', 1)), 1, 'the limit applies');
select tests.act_as_superuser();

-- ---- lifting a ban -----------------------------------------------------------------------
update auth.users set banned_until = now() + interval '100 years' where id = :'bad';
select tests.act_as(:'mem');
select throws_ok(format($q$ select admin_lift_ban(%L, 'Levee apres reexamen') $q$, :'bad'), '42501', 'not_allowed', 'lift refuses a non-admin');
select throws_ok($$ select admin_banned_users() $$, '42501', 'not_allowed', 'the banned list refuses a non-admin');
select tests.act_as_aal1(:'adm');
select throws_ok(format($q$ select admin_lift_ban(%L, 'Levee apres reexamen') $q$, :'bad'), '42501', 'not_allowed', 'lift refuses an admin without the second factor');
select tests.act_as_admin(:'adm');
select is(jsonb_array_length(admin_banned_users()), 1, 'the banned list has one person');
select is(admin_banned_users('bert') #>> '{0,first_name}', 'Bertrand', 'the banned list searches by first name');
select is(admin_banned_users('zzz'), '[]'::jsonb, 'no match gives an empty list');
select is((admin_banned_users() #>> '{0,id}')::uuid, :'bad'::uuid, 'the list returns the id');
select ok(admin_banned_users() #>> '{0,banned_at}' is not null, 'the list returns banned_at');
select throws_ok(format($q$ select admin_lift_ban(%L, 'court') $q$, :'bad'), '23514', 'invalid_statement', 'lift needs a statement');
select throws_ok(format($q$ select admin_lift_ban(%L, '') $q$, :'bad'), '23514', 'invalid_statement', 'lift refuses an empty statement');
select throws_ok(format($q$ select admin_lift_ban(%L, 'Levee apres reexamen') $q$, :'mem'), 'P0002', 'not_found', 'lift refuses someone who is not banned');
select lives_ok(format($q$ select admin_lift_ban(%L, 'Levee apres reexamen') $q$, :'bad'), 'lift works');
select tests.act_as_superuser();
select is((select banned_until from auth.users where id = :'bad'), null, 'banned_until cleared');
select is((select banned_at from profiles where id = :'bad'), null, 'banned_at cleared');
select is((select action || ':' || (details->>'statement') from admin_audit_log where action = 'ban_lifted'), 'ban_lifted:Levee apres reexamen', 'the lift is audited with its statement');
select tests.act_as(:'bad');
select lives_ok($$ insert into category_requests (user_id, requested_name) values (auth.uid(), 'Origami') $$, 'after the lift they can write again');
select tests.act_as_superuser();

-- ---- orphaned collectifs -----------------------------------------------------------------
insert into collectifs (id, name, description, town_label, town_point, created_by) values
  ('00000000-0000-0000-0000-00000000c0a1', 'Les Gardiens du Go', 'Jeu de go', 'Lyon', 'POINT(4.85 45.77)', :'gud'),
  ('00000000-0000-0000-0000-00000000c0a2', 'Les Orphelins du Go', 'Jeu de go', 'Lyon', 'POINT(4.85 45.77)', :'gud');
-- The leaving trigger would delete a collectif with nobody left; skip it to build the orphan state the guard defends against.
set local session_replication_role = replica;
delete from collectif_members where collectif_id in ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-00000000c0a2');
reset session_replication_role;
insert into collectif_members (collectif_id, user_id, role, status, accepted_at) values
  ('00000000-0000-0000-0000-00000000c0a1', :'gud', 'responsable', 'active', now());
select tests.act_as_anon();
select isnt(public.get_collectif('00000000-0000-0000-0000-00000000c0a1'), null, 'a collectif with an active organiser is shown');
select is(public.get_collectif('00000000-0000-0000-0000-00000000c0a2'), null, 'a collectif with nobody left is hidden');
select is((select count(*)::int from jsonb_array_elements(public.search_explore(4.85, 45.77, 10, 'gardiens du go')->'results') r where r->>'kind' = 'collectif'), 1, 'search shows the collectif with an organiser');
select is((select count(*)::int from jsonb_array_elements(public.search_explore(4.85, 45.77, 10, 'orphelins du go')->'results') r where r->>'title' = 'Les Orphelins du Go'), 0, 'search hides the orphaned collectif');
select tests.act_as_superuser();

-- ---- M2: export --------------------------------------------------------------------------
insert into reports (id, reporter_id, target_type, target_id, reason, status, decision, statement_of_reasons, decided_at, target_owner)
values ('00000000-0000-0000-0000-0000000000b1', :'mem', 'user', :'old', 'other', 'actioned', 'warn', 'Propos deplaces en seance', now(), :'old'),
       ('00000000-0000-0000-0000-0000000000b2', :'old', 'user', :'mem', 'other', 'dismissed', 'dismiss', 'Rien de grave constate', now(), :'mem');
insert into association_claims (association_id, claimant_id, proof_method, role_in_association, contact_email, admin_note)
values ('00000000-0000-0000-0000-0000000000a1', :'old', 'domain_email', 'President', 'a@club.fr', 'note interne');
select tests.act_as(:'old');
select public.export_my_data()::text as exp \gset
select tests.act_as_superuser();
select is(jsonb_array_length((:'exp'::jsonb)->'decisions_about_me'), 1, 'the export has the decisions taken about the person');
select is((:'exp'::jsonb)#>>'{decisions_about_me,0,decision}', 'warn', 'decision');
select is((:'exp'::jsonb)#>>'{decisions_about_me,0,statement_of_reasons}', 'Propos deplaces en seance', 'statement');
select is((:'exp'::jsonb)#>>'{decisions_about_me,0,target_type}', 'user', 'target_type');
select ok((:'exp'::jsonb)#>'{decisions_about_me,0,decided_at}' is not null, 'decided_at');
select is((:'exp'::jsonb)#>>'{reports_filed,0,decision}', 'dismiss', 'reports_filed carries the decision');
select ok((:'exp'::jsonb)#>'{reports_filed,0,decided_at}' is not null, 'reports_filed carries decided_at');
select is((:'exp'::jsonb)#>'{association_claims,0}' ? 'admin_note', false, 'the exported claim has no admin note');
select is((:'exp'::jsonb)#>>'{association_claims,0,role_in_association}', 'President', 'but keeps the rest');

-- ---- M8: no inactivity notice for banned people ------------------------------------------
update profiles set last_seen_at = now() - interval '36 months' where id in (:'old', :'olb');
update profiles set banned_at = now() where id = :'olb';
select public.run_inactive_accounts();
select isnt((select inactivity_notice_at from profiles where id = :'old'), null, 'control: an inactive person gets the notice');
select is((select inactivity_notice_at from profiles where id = :'olb'), null, 'a banned person gets none');

-- ---- moderation removal cannot be undone by the organiser ---------------------------------
select has_column('public', 'activities', 'removed_by_moderation_at', 'activities.removed_by_moderation_at exists');
-- today an organiser may un-archive their own normal archived activity, and still can
select tests.act_as(:'gud');
select lives_ok($$ update activities set archived_at = null where id = '00000000-0000-0000-0000-0000000000f2' $$, 'an organiser can un-archive their own normal archived activity');
select tests.act_as_superuser();
update activities set archived_at = now() where id = '00000000-0000-0000-0000-0000000000f2';

insert into reports (id, reporter_id, target_type, target_id, reason) values
  ('00000000-0000-0000-0000-0000000000b3', :'mem', 'activity', '00000000-0000-0000-0000-0000000000f1', 'other');
select tests.act_as_admin(:'adm');
select lives_ok($$ select admin_decide_report('00000000-0000-0000-0000-0000000000b3', 'remove', 'Activite retiree apres examen') $$, 'moderation removes the activity');
select tests.act_as_superuser();
select ok((select archived_at is not null and removed_by_moderation_at is not null from activities where id = '00000000-0000-0000-0000-0000000000f1'), 'removal archives it and marks it as moderated');

select tests.act_as(:'gud');
select throws_ok($$ update activities set archived_at = null where id = '00000000-0000-0000-0000-0000000000f1' $$, '42501', 'not_allowed', 'the organiser cannot un-archive a moderated activity');
select throws_ok($$ update activities set removed_by_moderation_at = null where id = '00000000-0000-0000-0000-0000000000f1' $$, '42501', 'not_allowed', 'the organiser cannot clear the moderation mark');
select throws_ok($$ update activities set archived_at = null, removed_by_moderation_at = null where id = '00000000-0000-0000-0000-0000000000f1' $$, '42501', 'not_allowed', 'nor both together');
select lives_ok($$ update activities set title = 'Go renomme' where id = '00000000-0000-0000-0000-0000000000f1' $$, 'other edits are not this guard''s business');
select throws_ok($$ update activities set removed_by_moderation_at = now() where id = '00000000-0000-0000-0000-0000000000f2' $$, '42501', 'not_allowed', 'an organiser cannot set the mark either');
select throws_ok($$ insert into sessions (activity_id, starts_at) values ('00000000-0000-0000-0000-0000000000f1', now() + interval '9 days') $$, '42501', 'not_allowed', 'no new session on a moderated activity');
select tests.act_as(:'old');
select throws_ok($$ insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', auth.uid()) $$, '42501', 'not_allowed', 'no new membership on a moderated activity');
select throws_ok($$ insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-0000000000e1', auth.uid(), 'confirmed') $$, '42501', 'not_allowed', 'no new attendance on a moderated activity');
select tests.act_as_admin(:'adm');
select lives_ok($$ update activities set archived_at = null, removed_by_moderation_at = null where id = '00000000-0000-0000-0000-0000000000f1' $$, 'an admin can restore it');
select tests.act_as_aal1(:'adm');
select is((select count(*) from (select 1 from activities where id = '00000000-0000-0000-0000-0000000000f1' and archived_at is null) x)::int, 1, 'restored');
select tests.act_as_superuser();

-- a session removal: the activity is marked only when it was already archived
insert into sessions (id, activity_id, starts_at) values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f2', now() + interval '5 days');
insert into reports (id, reporter_id, target_type, target_id, reason) values
  ('00000000-0000-0000-0000-0000000000b4', :'mem', 'session', '00000000-0000-0000-0000-0000000000e1', 'other'),
  ('00000000-0000-0000-0000-0000000000b5', :'mem', 'session', '00000000-0000-0000-0000-0000000000e2', 'other');
select tests.act_as_admin(:'adm');
select admin_decide_report('00000000-0000-0000-0000-0000000000b4', 'remove', 'Seance annulee apres examen');
select admin_decide_report('00000000-0000-0000-0000-0000000000b5', 'remove', 'Seance annulee apres examen');
select tests.act_as_superuser();
select is((select status from sessions where id = '00000000-0000-0000-0000-0000000000e1'), 'cancelled_by_organiser', 'the session is cancelled');
select is((select removed_by_moderation_at from activities where id = '00000000-0000-0000-0000-0000000000f1'), null, 'its live activity is not marked');
select isnt((select removed_by_moderation_at from activities where id = '00000000-0000-0000-0000-0000000000f2'), null, 'an activity that was already archived is marked');

-- a ban marks the banned person''s activities too
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, max_size) values
  ('00000000-0000-0000-0000-0000000000f4', :'olb', '00000000-0000-0000-0000-0000000000c1', 'Go de Odile', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 100, '19:00', 10);
select ban_user(:'olb', 'abus');
select isnt((select removed_by_moderation_at from activities where id = '00000000-0000-0000-0000-0000000000f4'), null, 'a ban marks the banned person''s activities as moderated');

-- ---- banned accounts are purged after 36 months and 30 days -------------------------------
select tests.create_user('bn1@ff.fr', 'Bn1') as bn1 \gset
select tests.create_user('bn2@ff.fr', 'Bn2') as bn2 \gset
select tests.create_user('bn3@ff.fr', 'Bn3') as bn3 \gset
update profiles set banned_at = now(), last_seen_at = now() - interval '37 months 1 day' where id = :'bn1';
update profiles set banned_at = now(), last_seen_at = now() - interval '35 months' where id = :'bn2';
update profiles set banned_at = now(), role = 'admin', last_seen_at = now() - interval '40 months' where id = :'bn3';
select public.run_inactive_accounts();
select is((select count(*) from auth.users where id = :'bn1')::int, 0, 'a banned account inactive for 37 months is purged without any notice');
select is((select count(*) from auth.users where id = :'bn2')::int, 1, 'a banned account inactive for 35 months is kept');
select is((select count(*) from auth.users where id = :'bn3')::int, 1, 'a banned admin is never purged');

-- ---- evidence of a moderated activity cannot be deleted by its organiser ------------------
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, max_size) values
  ('00000000-0000-0000-0000-0000000000f5', :'gud', '00000000-0000-0000-0000-0000000000c1', 'Go modere', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 100, '19:00', 10),
  ('00000000-0000-0000-0000-0000000000f6', :'gud', '00000000-0000-0000-0000-0000000000c1', 'Go libre', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 100, '19:00', 10);
update activities set archived_at = now(), removed_by_moderation_at = now() where id = '00000000-0000-0000-0000-0000000000f5';
select tests.act_as(:'gud');
with d as (delete from activities where id = '00000000-0000-0000-0000-0000000000f5' returning 1)
select is((select count(*) from d)::int, 0, 'the organiser cannot delete a moderated activity');
with d as (delete from activities where id = '00000000-0000-0000-0000-0000000000f6' returning 1)
select is((select count(*) from d)::int, 1, 'the organiser can still delete an unmoderated activity');
select tests.act_as_admin(:'adm');
with d as (delete from activities where id = '00000000-0000-0000-0000-0000000000f5' returning 1)
select is((select count(*) from d)::int, 1, 'an admin can delete a moderated activity');
select tests.act_as_superuser();

-- ---- files only through the audited RPCs ---------------------------------------------------
insert into feedback (id, user_id, type, body, screenshot_path) values
  ('00000000-0000-0000-0000-0000000000d1', :'mem', 'idea', 'Avec capture', :'mem' || '/00000000-0000-0000-0000-0000000000f1.png');
insert into association_claims (id, association_id, claimant_id, proof_method, role_in_association, document_path) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', :'mem', 'document', 'President', :'mem' || '/statuts.pdf');
select tests.act_as_admin(:'adm');
select throws_ok($$ select screenshot_path from feedback $$, '42501', null, 'an admin cannot select feedback.screenshot_path directly');
select throws_ok($$ select document_path from association_claims $$, '42501', null, 'an admin cannot select association_claims.document_path directly');
select throws_ok($$ select * from feedback $$, '42501', null, 'select * on feedback is refused too');
select lives_ok($$ select id, type, body, status from feedback $$, 'the other feedback columns stay readable');
select is(admin_feedback_screenshot_path('00000000-0000-0000-0000-0000000000d1'), :'mem' || '/00000000-0000-0000-0000-0000000000f1.png', 'the audited RPC still returns the screenshot path');
select is(admin_claim_document_path('00000000-0000-0000-0000-0000000000d2'), :'mem' || '/statuts.pdf', 'the audited RPC still returns the document path');
select tests.act_as(:'mem');
select lives_ok($$ select id, type, body from feedback where user_id = auth.uid() $$, 'a person still reads their other feedback columns');
select lives_ok(format($q$ insert into feedback (type, body, screenshot_path) values ('idea', 'Autre', %L) $q$, :'mem' || '/00000000-0000-0000-0000-0000000000f2.png'), 'a person can still send feedback with a screenshot');
select tests.act_as_superuser();

select * from finish();
rollback;
