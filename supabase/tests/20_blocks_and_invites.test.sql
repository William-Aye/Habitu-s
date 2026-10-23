begin;
\ir helpers.inc
select plan(30);
select tests.create_user('org@bi.fr', 'Olivier') as org \gset
select tests.create_user('bl@bi.fr', 'Blaise') as bl \gset
select tests.create_user('rb@bi.fr', 'Rita') as rb \gset
select tests.create_user('ok@bi.fr', 'Omar') as ok \gset
select tests.create_user('resp@bi.fr', 'Rosa') as resp \gset
select tests.create_user('cand@bi.fr', 'Camille') as cand \gset
select tests.create_user('arch@bi.fr', 'Arno') as arch \gset
select tests.create_user('pend@bi.fr', 'Paul') as pend \gset
select tests.create_user('out@bi.fr', 'Hugo') as outsider \gset
select tests.create_user('fresh@bi.fr', 'Nael') as fresh \gset
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
update profiles set created_at = now() where id = :'fresh';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');

-- ---------------------------------------------------------------------------------------------
-- Ruling 2: blocks hide and remove
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, max_size) values
  ('00000000-0000-0000-0000-0000000000f1', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go du soir', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', 4),
  ('00000000-0000-0000-0000-0000000000f2', :'bl', '00000000-0000-0000-0000-0000000000c1', 'Go de Blaise', 'Parc', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', 4);
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000f1', :'bl', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'rb', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'ok', 'member'),
  ('00000000-0000-0000-0000-0000000000f2', :'org', 'member');
select id as s1 from sessions where activity_id = '00000000-0000-0000-0000-0000000000f1' order by starts_at limit 1 \gset
select id as s2 from sessions where activity_id = '00000000-0000-0000-0000-0000000000f2' order by starts_at limit 1 \gset
insert into attendances (session_id, user_id, status) values
  (:'s1', :'bl', 'confirmed'), (:'s1', :'rb', 'confirmed'), (:'s1', :'ok', 'confirmed'), (:'s2', :'org', 'confirmed');
select tests.act_as(:'bl');
select isnt(public.get_activity('00000000-0000-0000-0000-0000000000f1'), null, 'before any block the activity is visible');

-- the organiser blocks one member; another member blocks the organiser
select tests.act_as(:'org');
insert into blocks (blocker_id, blocked_id) values (:'org', :'bl');
select tests.act_as(:'rb');
insert into blocks (blocker_id, blocked_id) values (:'rb', :'org');
select tests.act_as_superuser();
select is((select count(*)::int from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f1' and user_id in (:'bl', :'rb')), 0,
  'both block directions remove the membership');
select is((select count(*)::int from attendances where session_id = :'s1' and user_id in (:'bl', :'rb')), 0, 'and free their future seats');
select is((select count(*)::int from attendances where session_id = :'s1' and status = 'confirmed'), 1, 'only the unrelated member keeps a seat');
select is((select count(*)::int from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f2' and user_id = :'org'), 0,
  'the blocker''s membership in the blocked person''s activity is removed too');
select is((select count(*)::int from attendances where session_id = :'s2'), 0, 'with their seat there');
select is((select count(*)::int from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f1' and user_id = :'ok'), 1, 'unrelated memberships stay');

select tests.act_as(:'bl');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f1'), null, 'get_activity is null for the blocked user');
select tests.act_as(:'rb');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f1'), null, 'get_activity is null for the user who blocked the organiser');
select tests.act_as(:'ok');
select isnt(public.get_activity('00000000-0000-0000-0000-0000000000f1'), null, 'an unrelated user still sees it');
select tests.act_as(:'org');
select isnt(public.get_activity('00000000-0000-0000-0000-0000000000f1'), null, 'the organiser still sees their own activity');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f2'), null, 'the blocker no longer sees the blocked person''s activity');

select tests.act_as(:'bl');
select throws_ok($$ insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', auth.uid()) $$,
  '42501', 'not_allowed', 'the blocked user cannot join');
select tests.act_as(:'rb');
select throws_ok($$ insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', auth.uid()) $$,
  '42501', 'not_allowed', 'the user who blocked the organiser cannot join');
select tests.act_as(:'ok');
select is((select jsonb_array_length(public.my_activities())), 1, 'my_activities of an unrelated member still lists the activity');
select tests.act_as(:'org');
select is((select count(*)::int from jsonb_array_elements(public.my_activities()) e where e->>'id' = '00000000-0000-0000-0000-0000000000f2'), 0,
  'my_activities of the blocker no longer lists the blocked person''s activity');
select tests.act_as(:'ok');
select lives_ok($$ insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f2', auth.uid()) $$,
  'an unrelated user can join');

-- a removal survives block then unblock: the removed person cannot simply rejoin
select tests.act_as_superuser();
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000f5', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go sans Hugo', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00');
insert into activity_members (activity_id, user_id, status) values ('00000000-0000-0000-0000-0000000000f5', :'outsider', 'removed');
select tests.act_as(:'org');
insert into blocks (blocker_id, blocked_id) values (:'org', :'outsider');
delete from blocks where blocker_id = auth.uid() and blocked_id = :'outsider';
select tests.act_as_superuser();
select is((select status from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f5' and user_id = :'outsider'), 'removed',
  'a removed membership survives block then unblock');
select tests.act_as(:'outsider');
select throws_ok($$ insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f5', auth.uid()) $$,
  '23505', null, 'and the removed person still cannot rejoin');

-- ---------------------------------------------------------------------------------------------
-- Ruling 3: invitations only inside a shared activity
select tests.act_as_superuser();
insert into collectifs (id, name, town_label, town_point, created_by) values
  ('00000000-0000-0000-0000-00000000c0a1', 'Les Joueurs', 'Lyon', 'POINT(4.85 45.77)', :'resp');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, organised_by_collectif_id) values
  ('00000000-0000-0000-0000-0000000000f3', :'resp', '00000000-0000-0000-0000-0000000000c1', 'Go collectif', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', '00000000-0000-0000-0000-00000000c0a1'),
  ('00000000-0000-0000-0000-0000000000f4', :'resp', '00000000-0000-0000-0000-0000000000c1', 'Go ancien', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', '00000000-0000-0000-0000-00000000c0a1');
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000f3', :'cand', 'member'),
  ('00000000-0000-0000-0000-0000000000f3', :'fresh', 'member'),
  ('00000000-0000-0000-0000-0000000000f4', :'arch', 'member');
insert into activity_members (activity_id, user_id, status) values ('00000000-0000-0000-0000-0000000000f3', :'pend', 'pending');
update activities set archived_at = now() where id = '00000000-0000-0000-0000-0000000000f4';

select tests.act_as(:'resp');
select lives_ok(format($f$ insert into collectif_members (collectif_id, user_id, role, status) values ('00000000-0000-0000-0000-00000000c0a1', %L, 'organiser', 'invited') $f$, :'cand'),
  'inviting a member of the collectif''s activity works');
select is((select invited_by from collectif_members where user_id = :'cand'), :'resp'::uuid, 'invited_by is pinned to the caller');
select throws_ok(format($f$ insert into collectif_members (collectif_id, user_id, role, status) values ('00000000-0000-0000-0000-00000000c0a1', %L, 'organiser', 'invited') $f$, :'outsider'),
  '42501', 'not_allowed', 'a stranger cannot be invited');
select throws_ok(format($f$ insert into collectif_members (collectif_id, user_id, role, status) values ('00000000-0000-0000-0000-00000000c0a1', %L, 'organiser', 'invited') $f$, :'arch'),
  '42501', 'not_allowed', 'a member of an archived activity only cannot be invited');
select throws_ok(format($f$ insert into collectif_members (collectif_id, user_id, role, status) values ('00000000-0000-0000-0000-00000000c0a1', %L, 'organiser', 'invited') $f$, :'pend'),
  '42501', 'not_allowed', 'a pending requester cannot be invited');
select throws_ok(format($f$ insert into collectif_members (collectif_id, user_id, role, status) values ('00000000-0000-0000-0000-00000000c0a1', %L, 'organiser', 'invited') $f$, :'fresh'),
  '42501', 'not_allowed', 'an account that cannot organise yet cannot be invited');

-- the cap counts by inviter, including invitations since deleted
select tests.act_as_superuser();
delete from collectif_members where user_id = :'cand';
select is((select count(*)::int from collectif_invite_log where invited_by = :'resp'), 1, 'the invitation log keeps the deleted invitation');
select has_table('public', 'collectif_invite_log', 'the log table exists');
select is(has_table_privilege('authenticated', 'public.collectif_invite_log', 'select'), false, 'API roles cannot read the log');
select is(has_table_privilege('authenticated', 'public.collectif_invite_log', 'insert'), false, 'nor write to it');
select tests.act_as_superuser();
-- ten more invitations in the log for the same inviter: the next one is refused although none is stored
insert into collectif_invite_log (invited_by, invited_at) select :'resp', now() from generate_series(1, 9);
select tests.act_as(:'resp');
select throws_ok(format($f$ insert into collectif_members (collectif_id, user_id, role, status) values ('00000000-0000-0000-0000-00000000c0a1', %L, 'organiser', 'invited') $f$, :'cand'),
  '42501', 'limit_reached', 'the tenth-plus-first invitation is refused although earlier ones were deleted');

select * from finish();
rollback;
