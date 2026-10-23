begin;
\ir helpers.inc
select plan(10);
select tests.create_user('resp@fv.fr', 'Rita') as resp \gset
select tests.create_user('cand@fv.fr', 'Camille') as cand \gset
select tests.create_user('blk1@fv.fr', 'Bruno') as blk1 \gset
select tests.create_user('blk2@fv.fr', 'Berta') as blk2 \gset
select tests.create_user('org@fv.fr', 'Oriane') as orgn \gset
select tests.create_user('inv@fv.fr', 'Ines') as inv \gset
select tests.create_user('new@fv.fr', 'Nael') as fresh \gset
select tests.create_user('out@fv.fr', 'Hugo') as outsider \gset
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
update profiles set created_at = now() where id = :'fresh';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
insert into collectifs (id, name, town_label, town_point, created_by) values
  ('00000000-0000-0000-0000-00000000c0a1', 'Les Joueurs', 'Lyon', 'POINT(4.85 45.77)', :'resp');
insert into collectif_members (collectif_id, user_id, role, status, accepted_at) values
  ('00000000-0000-0000-0000-00000000c0a1', :'orgn', 'organiser', 'active', now()),
  ('00000000-0000-0000-0000-00000000c0a1', :'inv', 'organiser', 'invited', null);
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, organised_by_collectif_id) values
  ('00000000-0000-0000-0000-0000000000f1', :'resp', '00000000-0000-0000-0000-0000000000c1', 'Go du mardi', 'Cafe', 'POINT(4.85 45.77)', 'weekly', '2026-10-20', '19:00', '00000000-0000-0000-0000-00000000c0a1');
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000f1', :'cand', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'blk1', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'blk2', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'orgn', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'inv', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'fresh', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'outsider', 'pending');
insert into blocks (blocker_id, blocked_id) values (:'resp', :'blk1'), (:'blk2', :'resp');

select is(has_function_privilege('anon', 'public.collectif_candidates(uuid)', 'EXECUTE'), false, 'anon cannot execute');
select is(has_function_privilege('public', 'public.collectif_candidates(uuid)', 'EXECUTE'), false, 'public cannot execute');

select tests.act_as(:'outsider');
select throws_ok($$ select * from public.collectif_candidates('00000000-0000-0000-0000-00000000c0a1') $$, '42501', null, 'an outsider is denied');

select tests.act_as(:'resp');
select is((select array_agg(first_name) from public.collectif_candidates('00000000-0000-0000-0000-00000000c0a1')), array['Camille'],
  'only the eligible member remains');
select is((select count(*)::int from public.collectif_candidates('00000000-0000-0000-0000-00000000c0a1') where first_name in ('Bruno', 'Berta')), 0,
  'blocked pairs are excluded in both directions');
select is((select count(*)::int from public.collectif_candidates('00000000-0000-0000-0000-00000000c0a1') where first_name = 'Oriane'), 0, 'an existing organiser is excluded');
select is((select count(*)::int from public.collectif_candidates('00000000-0000-0000-0000-00000000c0a1') where first_name = 'Ines'), 0, 'an invited person is excluded');
select is((select count(*)::int from public.collectif_candidates('00000000-0000-0000-0000-00000000c0a1') where first_name in ('Nael', 'Hugo')), 0, 'accounts that cannot organise yet and pending requesters are excluded');

select tests.act_as(:'orgn');
select is((select array_agg(first_name) from public.collectif_candidates('00000000-0000-0000-0000-00000000c0a1')), array['Berta','Bruno','Camille'], 'an active organiser can list candidates (blocks are per caller)');

select tests.act_as(:'inv');
select throws_ok($$ select * from public.collectif_candidates('00000000-0000-0000-0000-00000000c0a1') $$, '42501', null, 'an invited person is denied');
select * from finish();
rollback;
