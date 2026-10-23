begin;
\ir helpers.inc
select plan(59);
select tests.create_user('resp@col.fr', 'Rose') as resp \gset
select tests.create_user('org1@col.fr', 'Oscar') as org1 \gset
select tests.create_user('org2@col.fr', 'Olga') as org2 \gset
select tests.create_user('out@col.fr', 'Paul') as outsider \gset
select tests.create_user('new@col.fr', 'Nina') as fresh \gset
select tests.create_user('root@col.fr', 'Root') as root \gset
update profiles set role = 'admin' where id = :'root';
update profiles set age_confirmed = true;
update profiles set created_at = now() - interval '2 days' where id <> :'fresh';
update profiles set created_at = now() - interval '1 hour' where id = :'fresh';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
insert into associations (id, name, source, verified) values ('00000000-0000-0000-0000-0000000000a2', 'Club libre', 'community', false);

-- structure
select has_table('public', 'collectifs', 'collectifs table');
select is(has_table_privilege('anon', 'public.collectif_members', 'INSERT'), false, 'anon cannot insert members');

-- can_organise
select tests.act_as(:'fresh');
select is(public.can_organise(), false, 'a 1-hour-old account cannot organise');
select tests.act_as_superuser();
update profiles set created_at = now() - interval '25 hours' where id = :'fresh';
select tests.act_as(:'fresh');
select is(public.can_organise(), true, 'a 25-hour-old account can organise');
select tests.act_as_superuser();
update profiles set created_at = now() - interval '1 hour' where id = :'fresh';
select tests.act_as(:'fresh');
select throws_ok($$ insert into collectifs (name, town_label, town_point, created_by) values ('Les Joueurs', 'Lyon', 'POINT(4.85 45.77)', auth.uid()) $$,
  '42501', null, 'a new account cannot create a collectif');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Go le mardi', 'Cafe', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00') $$,
  '42501', null, 'a new account cannot create an activity');

-- collectif creation
select tests.act_as(:'resp');
select lives_ok($$ insert into collectifs (id, name, description, town_label, town_point, created_by)
  values ('00000000-0000-0000-0000-00000000c0a1', 'Les Joueurs du Parc', 'Jeux de societe', 'Lyon', 'POINT(4.8512 45.7689)', auth.uid()) $$,
  'creator makes a collectif');
select is((select role || '/' || status from collectif_members where collectif_id = '00000000-0000-0000-0000-00000000c0a1' and user_id = :'resp'),
  'responsable/active', 'creator is the active responsable');
select is((select ST_AsText(town_point::geometry) from collectifs where id = '00000000-0000-0000-0000-00000000c0a1'),
  'POINT(4.85 45.77)', 'town snapped to 0.01 degree');
select throws_ok($$ insert into collectifs (name, town_label, town_point, created_by) values ('ab', 'Lyon', 'POINT(4.85 45.77)', auth.uid()) $$,
  '23514', null, 'name of 2 chars rejected');
select throws_ok(format($f$ insert into collectifs (name, town_label, town_point, created_by) values ('Les Autres', 'Lyon', 'POINT(4.85 45.77)', %L) $f$, :'outsider'),
  '42501', null, 'cannot create a collectif for someone else');
select lives_ok($$ insert into collectifs (id, name, town_label, town_point, created_by) values ('00000000-0000-0000-0000-00000000c0a2', 'Second collectif', 'Lyon', 'POINT(4.85 45.77)', auth.uid()) $$, 'second collectif in 24h');
select throws_ok($$ insert into collectifs (name, town_label, town_point, created_by) values ('Troisieme collectif', 'Lyon', 'POINT(4.85 45.77)', auth.uid()) $$,
  '42501', 'limit_reached', 'third collectif in 24h refused');

-- invitations
select lives_ok(format($f$ insert into collectif_members (collectif_id, user_id, role) values ('00000000-0000-0000-0000-00000000c0a1', %L, 'organiser') $f$, :'org1'), 'responsable invites org1 (status defaults to invited)');
select lives_ok(format($f$ insert into collectif_members (collectif_id, user_id, role, status) values ('00000000-0000-0000-0000-00000000c0a1', %L, 'organiser', 'invited') $f$, :'org2'), 'responsable invites org2');
select lives_ok(format($f$ insert into collectif_members (collectif_id, user_id, role, status) values ('00000000-0000-0000-0000-00000000c0a1', %L, 'organiser', 'invited') $f$, :'fresh'), 'responsable invites a new account');
select throws_ok(format($f$ insert into collectif_members (collectif_id, user_id, role, status) values ('00000000-0000-0000-0000-00000000c0a1', %L, 'organiser', 'active') $f$, :'outsider'),
  '42501', null, 'cannot add an already-active member');
select tests.act_as(:'outsider');
select throws_ok(format($f$ insert into collectif_members (collectif_id, user_id, role, status) values ('00000000-0000-0000-0000-00000000c0a1', %L, 'organiser', 'invited') $f$, :'outsider'),
  '42501', null, 'non-responsable cannot invite');

-- RLS reads
select tests.act_as_anon();
select is((select count(*)::int from collectifs), 2, 'anon reads collectifs');
select is((select count(*)::int from collectif_members where collectif_id = '00000000-0000-0000-0000-00000000c0a1'), 1, 'anon sees only the active row, not invited ones');

-- an invited (not yet accepted) organiser cannot attach a collectif
select tests.act_as(:'org1');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, organised_by_collectif_id)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Go collectif', 'Cafe', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00', '00000000-0000-0000-0000-00000000c0a1') $$,
  '42501', null, 'invited organiser cannot set the collectif');
select is((select count(*)::int from collectif_members where collectif_id = '00000000-0000-0000-0000-00000000c0a1'), 2, 'invitee sees the active row and own invitation only');
select tests.act_as(:'outsider');
select lives_ok(format($f$ update collectif_members set status = 'active' where user_id = %L $f$, :'org1'), 'someone else updating the invitation matches no row');
select tests.act_as_superuser();
select is((select status from collectif_members where user_id = :'org1' and collectif_id = '00000000-0000-0000-0000-00000000c0a1'), 'invited', 'still invited: only the invitee accepts');
select tests.act_as(:'fresh');
select throws_ok(format($f$ update collectif_members set status = 'active' where user_id = %L $f$, :'fresh'),
  '42501', null, 'invitee who cannot organise yet cannot accept');
select tests.act_as(:'org1');
select lives_ok(format($f$ update collectif_members set status = 'active' where collectif_id = '00000000-0000-0000-0000-00000000c0a1' and user_id = %L $f$, :'org1'), 'invitee accepts');
select is((select accepted_at is not null from collectif_members where user_id = :'org1' and collectif_id = '00000000-0000-0000-0000-00000000c0a1'), true, 'accepted_at set');

-- active organiser may set the collectif; both organising bodies refused
select lives_ok($$ insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, organised_by_collectif_id)
  values ('00000000-0000-0000-0000-0000000000f1', auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Go collectif', 'Cafe', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00', '00000000-0000-0000-0000-00000000c0a1') $$,
  'active organiser sets the collectif');
select throws_ok($$ update activities set organised_by_association_id = '00000000-0000-0000-0000-0000000000a2' where id = '00000000-0000-0000-0000-0000000000f1' $$,
  '23514', null, 'association and collectif together refused');
select tests.act_as(:'outsider');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, organised_by_collectif_id)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Go intrus', 'Cafe', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00', '00000000-0000-0000-0000-00000000c0a1') $$,
  '42501', null, 'non-member cannot set the collectif');

-- welcome member + daily activity limit
select tests.act_as(:'org1');
select throws_ok(format($f$ update activities set welcome_member_id = %L where id = '00000000-0000-0000-0000-0000000000f1' $f$, :'outsider'),
  '42501', null, 'welcome member must be organiser or member');
select lives_ok(format($f$ update activities set welcome_member_id = %L where id = '00000000-0000-0000-0000-0000000000f1' $f$, :'org1'), 'organiser can be the welcome member');
select lives_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
  select auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Go bis ' || g, 'Cafe', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00' from generate_series(1, 2) g $$,
  'activities 2 and 3 in 24h');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Go quatre', 'Cafe', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00') $$,
  '42501', 'limit_reached', 'fourth activity in 24h refused');

-- limits cannot be dodged with timestamps
select tests.act_as(:'outsider');
select lives_ok($$ insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, created_at, published_at)
  select case g when 1 then '00000000-0000-0000-0000-0000000000e1'::uuid else gen_random_uuid() end, auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Go ancien ' || g, 'Cafe', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00', '2020-01-01', '2020-01-01' from generate_series(1, 3) g $$,
  'backdated inserts are accepted but counted as now');
select is((select count(*)::int from activities where organiser_id = :'outsider' and created_at = now() and published_at = now()), 3, 'created_at and published_at pinned to now on insert');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, created_at)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000c1', 'Go quatre', 'Cafe', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00', '2020-01-01') $$,
  '42501', 'limit_reached', 'fourth backdated activity refused');
select lives_ok($$ update activities set created_at = '2020-01-01', published_at = '2020-01-01' where id = '00000000-0000-0000-0000-0000000000e1' $$, 'updating dates is accepted');
select is((select created_at = now() and published_at = now() from activities where id = '00000000-0000-0000-0000-0000000000e1'), true, 'created_at and published_at unchanged by update');
select throws_ok($$ update activities set organised_by_collectif_id = '00000000-0000-0000-0000-00000000c0a1' where id = '00000000-0000-0000-0000-0000000000e1' $$,
  '42501', null, 'non-member cannot update organised_by_collectif_id');
select tests.act_as(:'org2');
select lives_ok($$ insert into collectifs (name, town_label, town_point, created_by, created_at)
  select 'Ancien ' || g, 'Lyon', 'POINT(4.85 45.77)', auth.uid(), '2020-01-01' from generate_series(1, 2) g $$, 'two backdated collectifs');
select throws_ok($$ insert into collectifs (name, town_label, town_point, created_by, created_at) values ('Ancien trois', 'Lyon', 'POINT(4.85 45.77)', auth.uid(), '2020-01-01') $$,
  '42501', 'limit_reached', 'third backdated collectif refused');
select throws_ok($$ update collectifs set created_at = '2020-01-01' where created_by = auth.uid() $$, '42501', null, 'collectif created_at cannot be updated');

-- a real activity member can be the welcome person
select lives_ok(format($f$ insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', %L) $f$, :'org2'), 'org2 joins f1');
select tests.act_as(:'org1');
select lives_ok(format($f$ update activities set welcome_member_id = %L where id = '00000000-0000-0000-0000-0000000000f1' $f$, :'org2'), 'a real member can be the welcome person');
select throws_ok(format($f$ update collectif_members set role = 'responsable' where user_id = %L $f$, :'org1'), '42501', null, 'member cannot change own role');
select throws_ok(format($f$ update collectif_members set user_id = %L where user_id = %L $f$, :'outsider', :'org1'), '42501', null, 'member cannot change user_id');

-- responsable deletion: promote the oldest organiser; alone, the collectif goes and activities stay
select tests.act_as_superuser();
update collectif_members set accepted_at = now() - interval '2 days' where user_id = :'org1';
update collectif_members set status = 'active', accepted_at = now() - interval '1 day' where user_id = :'org2';
select tests.act_as(:'org2');
select lives_ok(format($f$ delete from collectif_members where user_id = %L and collectif_id = '00000000-0000-0000-0000-00000000c0a1' $f$, :'org2'), 'a member can leave');
select tests.act_as_superuser();
select is((select count(*)::int from collectif_members where user_id = :'org2' and collectif_id = '00000000-0000-0000-0000-00000000c0a1'), 0, 'member row gone after leaving');
insert into collectif_members (collectif_id, user_id, role, status, accepted_at) values ('00000000-0000-0000-0000-00000000c0a1', :'org2', 'organiser', 'active', now() - interval '1 day');
select tests.act_as(:'resp');
select lives_ok(format($f$ delete from collectif_members where user_id = %L and collectif_id = '00000000-0000-0000-0000-00000000c0a1' $f$, :'org2'), 'the responsable removes a member');
select tests.act_as_superuser();
select is((select count(*)::int from collectif_members where user_id = :'org2' and collectif_id = '00000000-0000-0000-0000-00000000c0a1'), 0, 'removed member row gone');
insert into collectif_members (collectif_id, user_id, role, status, accepted_at) values ('00000000-0000-0000-0000-00000000c0a1', :'org2', 'organiser', 'active', now() - interval '1 day');
select tests.act_as(:'resp');
select lives_ok($$ update collectifs set town_point = 'POINT(2.3522 48.8566)' where id = '00000000-0000-0000-0000-00000000c0a2' $$, 'responsable updates the town');
select is((select ST_AsText(town_point::geometry) from collectifs where id = '00000000-0000-0000-0000-00000000c0a2'), 'POINT(2.35 48.86)', 'town snapped on update');
select tests.act_as_superuser();
insert into collectifs (id, name, town_label, town_point, created_by) values ('00000000-0000-0000-0000-00000000c0a3', 'Troisieme', 'Lyon', 'POINT(4.85 45.77)', :'resp');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, organised_by_collectif_id)
  values ('00000000-0000-0000-0000-0000000000f3', :'org1', '00000000-0000-0000-0000-0000000000c1', 'Go troisieme', 'Cafe', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00', '00000000-0000-0000-0000-00000000c0a3');
select tests.act_as(:'resp');
select lives_ok($$ delete from collectifs where id = '00000000-0000-0000-0000-00000000c0a3' $$, 'the responsable deletes the collectif');
select tests.act_as_superuser();
select is((select organised_by_collectif_id from activities where id = '00000000-0000-0000-0000-0000000000f3'), null, 'its activity stays with a null link');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, organised_by_collectif_id)
  values ('00000000-0000-0000-0000-0000000000f2', :'outsider', '00000000-0000-0000-0000-0000000000c1', 'Go second', 'Cafe', 'POINT(4.85 45.77)', 'weekly', '2026-11-03', '19:00', '00000000-0000-0000-0000-00000000c0a2');
delete from auth.users where id = :'resp';
select is((select role from collectif_members where collectif_id = '00000000-0000-0000-0000-00000000c0a1' and user_id = :'org1'), 'responsable', 'longest-active organiser promoted');
select is((select role from collectif_members where collectif_id = '00000000-0000-0000-0000-00000000c0a1' and user_id = :'org2'), 'organiser', 'the other organiser stays organiser');
select is((select count(*)::int from collectifs where id = '00000000-0000-0000-0000-00000000c0a2'), 0, 'collectif deleted when no organiser is left');
select is((select organised_by_collectif_id from activities where id = '00000000-0000-0000-0000-0000000000f2'), null, 'its activity keeps existing with no collectif');
select * from finish();
rollback;
