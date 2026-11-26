-- Activities with children: the child_safety report reason, the priority queue, and the facts an
-- organiser sees about a request.
begin;
\ir helpers.inc
select plan(18);

select tests.create_user('org@cs.fr', 'Olivier') as org \gset
select tests.create_user('mem@cs.fr', 'Mia') as mem \gset
select tests.create_user('pend@cs.fr', 'Paula') as pend \gset
select tests.create_user('rep@cs.fr', 'Rose') as rep \gset
select tests.create_user('adm@cs.fr', 'Ada') as adm \gset
update profiles set age_confirmed = true, created_at = now() - interval '10 days',
                    photo_url = id::text || '/' || md5(id::text) || '.jpg';
update profiles set created_at = now() - interval '40 days', bio = 'Maman de deux enfants.' where id = :'pend';
update profiles set bio = 'Membre active.' where id = :'mem';
update profiles set role = 'admin' where id = :'adm';
insert into categories (id, slug, name_fr, name_en, icon) values
  ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
select id as fam from categories where slug = 'family-sorties-parents-enfants' \gset
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000f1', :'org', :'fam', 'Sortie au square', 'Square des Enfants', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '10:00'),
  ('00000000-0000-0000-0000-0000000000f2', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go du parc', 'Club', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '18:00');
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000f1', :'mem', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'pend', 'pending'),
  ('00000000-0000-0000-0000-0000000000f1', :'rep', 'member');
select id as fsession from sessions where activity_id = '00000000-0000-0000-0000-0000000000f1' order by starts_at limit 1 \gset
insert into messages (id, activity_id, sender_id, body) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', :'mem', 'Rendez-vous au portail.');

-- ---- the reason -------------------------------------------------------------------------------
select tests.act_as(:'rep');
select lives_ok(format($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'user', %L, 'child_safety') $$, :'mem'),
  'child_safety on a person');
select lives_ok($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'activity', '00000000-0000-0000-0000-0000000000f2', 'child_safety') $$,
  'child_safety on an activity');
select lives_ok(format($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'session', %L, 'child_safety') $$, :'fsession'),
  'child_safety on a session');
select lives_ok($$ insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'message', '00000000-0000-0000-0000-0000000000a1', 'child_safety') $$,
  'child_safety on a message');

-- ---- what is a priority -----------------------------------------------------------------------
select tests.act_as_superuser();
select is(public.report_is_priority('child_safety', 'activity', '00000000-0000-0000-0000-0000000000f2'), true, 'the child_safety reason is a priority anywhere');
select is(public.report_is_priority('harassment', 'activity', '00000000-0000-0000-0000-0000000000f1'), true, 'any report on an activity with children is a priority');
select is(public.report_is_priority('harassment', 'session', :'fsession'), true, 'any report on one of its sessions is a priority');
select is(public.report_is_priority('harassment', 'message', '00000000-0000-0000-0000-0000000000a1'), true, 'any report on a message in its chat is a priority');
select is(public.report_is_priority('harassment', 'activity', '00000000-0000-0000-0000-0000000000f2'), false, 'other reports are not');

insert into reports (reporter_id, target_type, target_id, reason) values
  (:'rep', 'activity', '00000000-0000-0000-0000-0000000000f1', 'harassment'),
  (:'rep', 'activity', '00000000-0000-0000-0000-0000000000f2', 'harassment');

-- ---- the queue --------------------------------------------------------------------------------
select tests.act_as_admin(:'adm');
select is((admin_reports()->>'priority_open_count')::int, 5, 'the queue counts the open priority reports');
select ok((select bool_and((i->>'priority')::boolean) and count(*) = 5
             from jsonb_array_elements(admin_reports(p_priority => true)->'items') i), 'the priority list holds only priority reports');
select ok(exists (select 1 from jsonb_array_elements(admin_reports()->'items') i
                   where i->>'target_id' = '00000000-0000-0000-0000-0000000000f2' and i->>'reason' = 'harassment'
                     and i->'priority' = 'false'::jsonb), 'the full list marks other reports as not priority');
select ok(exists (select 1 from jsonb_array_elements(admin_reports()->'items') i
                   where i->>'target_id' = '00000000-0000-0000-0000-0000000000f1' and i->>'preview' like '%Square des Enfants%'),
  'an admin still sees the place of an activity with children in the preview');
select tests.act_as(:'rep');
select throws_ok($$ select admin_reports(p_priority => true) $$, '42501', null, 'a user cannot read the priority list');

-- ---- the facts about a request ----------------------------------------------------------------
select tests.act_as(:'org');
select is((select jsonb_build_object('bio', bio, 'since', member_since = now() - interval '40 days')
             from activity_roster('00000000-0000-0000-0000-0000000000f1') where status = 'pending'),
  '{"bio": "Maman de deux enfants.", "since": true}'::jsonb, 'a request shows the bio and the date the account was created');
select ok((select bool_and(bio is null and member_since is null)
             from activity_roster('00000000-0000-0000-0000-0000000000f1') where status = 'member'),
  'members carry neither');

select tests.act_as_superuser();
select is(has_function_privilege('authenticated', 'public.admin_reports(text, timestamptz, uuid, integer, boolean)', 'execute'), true, 'signed-in callers may call admin_reports (it checks admin itself)');
select is(has_function_privilege('anon', 'public.admin_reports(text, timestamptz, uuid, integer, boolean)', 'execute'), false, 'anon may not');

select * from finish();
rollback;
