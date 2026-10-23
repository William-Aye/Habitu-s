begin;
\ir helpers.inc
select plan(7);
select tests.create_user('org@fv.fr', 'Olivier') as org \gset
select tests.create_user('mem@fv.fr', 'Mia') as mem \gset
select tests.create_user('old@fv.fr', 'Oscar') as oldie \gset
select tests.create_user('out@fv.fr', 'Hugo') as outsider \gset
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000f1', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go du mardi', 'Cafe', 'POINT(4.85 45.77)', 'weekly', '2026-10-20', '19:00');
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000f1', :'mem', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'oldie', 'member');
update activities set welcome_member_id = :'oldie' where id = '00000000-0000-0000-0000-0000000000f1';
insert into sessions (id, activity_id, starts_at) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', now() - interval '3 days');

select tests.act_as(:'mem');
select is((public.get_activity('00000000-0000-0000-0000-0000000000f1')->>'my_past_attendance_count')::int, 0, 'a new member has attended nothing');
select tests.act_as_superuser();
insert into attendances (session_id, user_id, status) values ('00000000-0000-0000-0000-0000000000e1', :'mem', 'confirmed');
select tests.act_as(:'mem');
select is((public.get_activity('00000000-0000-0000-0000-0000000000f1')->>'my_past_attendance_count')::int, 1, 'one past confirmed session counts');
select tests.act_as_superuser();
update attendances set status = 'cancelled' where user_id = :'mem';
select tests.act_as(:'mem');
select is((public.get_activity('00000000-0000-0000-0000-0000000000f1')->>'my_past_attendance_count')::int, 0, 'a cancelled attendance does not count');

select tests.act_as(:'outsider');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f1') ? 'my_past_attendance_count', false, 'hidden from non-members');
select tests.act_as_anon();
select is(public.get_activity('00000000-0000-0000-0000-0000000000f1') ? 'my_past_attendance_count', false, 'hidden from visitors');

select tests.act_as(:'mem');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f1')->>'welcome_first_name', 'Oscar', 'the welcome person is named');
select tests.act_as_superuser();
insert into blocks (blocker_id, blocked_id) values (:'oldie', :'mem');
select tests.act_as(:'mem');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f1')->>'welcome_first_name', null, 'a blocked welcome person is hidden');
select * from finish();
rollback;
