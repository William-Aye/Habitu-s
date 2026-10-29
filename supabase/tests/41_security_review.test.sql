-- Pre-launch security review (Task 4, database batch): one section per finding.
begin;
\ir helpers.inc
select plan(5);
select tests.create_user('org@sr.fr', 'Orla') as org \gset
select tests.create_user('mem@sr.fr', 'Malo') as mem \gset
select tests.create_user('out@sr.fr', 'Oscar') as out \gset
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000f1', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go du soir', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00');
insert into activity_members (activity_id, user_id, status) values ('00000000-0000-0000-0000-0000000000f1', :'mem', 'member');
update activities set welcome_member_id = :'mem' where id = '00000000-0000-0000-0000-0000000000f1';

-- ---- DB-1: the welcome member (a member of the activity) is never readable from the table -------
select tests.act_as_anon();
select throws_ok($$ select welcome_member_id from activities $$, '42501', null, 'DB-1: anon cannot read activities.welcome_member_id');
select is((select title from activities where id = '00000000-0000-0000-0000-0000000000f1'), 'Go du soir', 'DB-1: anon still reads the public columns');
select tests.act_as(:'out');
select throws_ok($$ select welcome_member_id from activities $$, '42501', null, 'DB-1: a signed-in stranger cannot read activities.welcome_member_id');
select tests.act_as(:'mem');
select is(get_activity('00000000-0000-0000-0000-0000000000f1')->>'welcome_first_name', 'Malo', 'DB-1: members still get the welcome person through get_activity');
select tests.act_as(:'org');
select lives_ok($$ update activities set welcome_member_id = null where id = '00000000-0000-0000-0000-0000000000f1' $$, 'DB-1: the organiser still sets the welcome person');
select tests.act_as_superuser();

select * from finish();
rollback;
