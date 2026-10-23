begin;
\ir helpers.inc
select plan(11);
select tests.create_user('org@ro.fr', 'Olivier') as org \gset
select tests.create_user('mem@ro.fr', 'Mia') as mem \gset
select tests.create_user('pend@ro.fr', 'Paula') as pend \gset
select tests.create_user('out@ro.fr', 'Hugo') as outsider \gset
select tests.create_user('rem@ro.fr', 'Rémi') as removed \gset
select tests.create_user('blk@ro.fr', 'Basile') as blocker \gset
select tests.create_user('bld@ro.fr', 'Blaise') as blocked \gset
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, approval_mode) values
  ('00000000-0000-0000-0000-0000000000f1', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go du mardi', 'Cafe', 'POINT(4.85 45.77)', 'weekly', '2026-10-20', '19:00', 'approval');
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000f1', :'mem', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'pend', 'pending'),
  ('00000000-0000-0000-0000-0000000000f1', :'removed', 'removed'),
  ('00000000-0000-0000-0000-0000000000f1', :'blocker', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'blocked', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'outsider', 'member');
delete from activity_members where user_id = :'outsider';  -- a member who left
insert into blocks (blocker_id, blocked_id) values (:'blocker', :'org'), (:'org', :'blocked');

select tests.act_as_anon();
select throws_ok($$ select * from public.activity_roster('00000000-0000-0000-0000-0000000000f1') $$, '42501', null, 'anon is denied');
select tests.act_as(:'outsider');
select throws_ok($$ select * from public.activity_roster('00000000-0000-0000-0000-0000000000f1') $$, '42501', 'not allowed', 'a stranger is denied');
select tests.act_as(:'mem');
select throws_ok($$ select * from public.activity_roster('00000000-0000-0000-0000-0000000000f1') $$, '42501', 'not allowed', 'a member is denied');
select tests.act_as(:'org');
select is((select count(*) from public.activity_roster('00000000-0000-0000-0000-0000000000f1'))::int, 2, 'the organiser sees members and requests, not removed, left or blocked people');
select is((select count(*) from public.activity_roster('00000000-0000-0000-0000-0000000000f1') where first_name = 'Rémi')::int, 0, 'a removed member is absent');
select is((select count(*) from public.activity_roster('00000000-0000-0000-0000-0000000000f1') where first_name = 'Hugo')::int, 0, 'a member who left is absent');
select is((select count(*) from public.activity_roster('00000000-0000-0000-0000-0000000000f1') where first_name = 'Basile')::int, 0, 'someone who blocked the organiser is excluded');
select is((select count(*) from public.activity_roster('00000000-0000-0000-0000-0000000000f1') where first_name = 'Blaise')::int, 0, 'someone the organiser blocked is excluded');
select ok(not has_function_privilege('anon', 'public.activity_roster(uuid)', 'execute'), 'anon has no execute privilege');
select is((select first_name from public.activity_roster('00000000-0000-0000-0000-0000000000f1') where status = 'pending'), 'Paula', 'a request carries a first name');
select is((select count(*) from public.activity_roster('00000000-0000-0000-0000-0000000000f1') where status = 'member')::int, 1, 'members are listed');
select * from finish();
rollback;
