begin;
\ir helpers.inc
select plan(6);
select tests.create_user('org@ro.fr', 'Olivier') as org \gset
select tests.create_user('mem@ro.fr', 'Mia') as mem \gset
select tests.create_user('pend@ro.fr', 'Paula') as pend \gset
select tests.create_user('out@ro.fr', 'Hugo') as outsider \gset
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, approval_mode) values
  ('00000000-0000-0000-0000-0000000000f1', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go du mardi', 'Cafe', 'POINT(4.85 45.77)', 'weekly', '2026-10-20', '19:00', 'approval');
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000f1', :'mem', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'pend', 'pending');

select tests.act_as_anon();
select throws_ok($$ select * from public.activity_roster('00000000-0000-0000-0000-0000000000f1') $$, '42501', null, 'anon is denied');
select tests.act_as(:'outsider');
select throws_ok($$ select * from public.activity_roster('00000000-0000-0000-0000-0000000000f1') $$, '42501', 'not allowed', 'a stranger is denied');
select tests.act_as(:'mem');
select throws_ok($$ select * from public.activity_roster('00000000-0000-0000-0000-0000000000f1') $$, '42501', 'not allowed', 'a member is denied');
select tests.act_as(:'org');
select is((select count(*) from public.activity_roster('00000000-0000-0000-0000-0000000000f1'))::int, 2, 'the organiser sees members and requests');
select is((select first_name from public.activity_roster('00000000-0000-0000-0000-0000000000f1') where status = 'pending'), 'Paula', 'a request carries a first name');
select is((select count(*) from public.activity_roster('00000000-0000-0000-0000-0000000000f1') where status = 'member')::int, 1, 'members are listed');
select * from finish();
rollback;
