begin;
\ir helpers.inc
select plan(82);
select tests.create_user('org@ses.fr', 'Olivier') as org \gset
select tests.create_user('mem@ses.fr', 'Mia') as mem \gset
select tests.create_user('mem2@ses.fr', 'Marc') as mem2 \gset
select tests.create_user('pend@ses.fr', 'Paula') as pend \gset
select tests.create_user('out@ses.fr', 'Hugo') as outsider \gset
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
update profiles set photo_url = 'https://example.org/mia.jpg', home_area_label = 'Croix-Rousse' where id = :'mem';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
insert into tags (id, slug, label_fr, label_en) values ('00000000-0000-0000-0000-0000000000b1', 'go', 'Go', 'Go');
insert into associations (id, name, source, verified) values ('00000000-0000-0000-0000-0000000000a1', 'Club de go', 'community', false);

-- structure and privileges
select has_function('public', 'generate_sessions', array['uuid', 'date', 'date'], 'generate_sessions exists');
select is(has_function_privilege('authenticated', 'public.generate_sessions(uuid, date, date)', 'execute'), false, 'API roles cannot run the generator');
select is(has_function_privilege('anon', 'public.get_activity(uuid)', 'execute'), true, 'anon may read an activity page');
select is(has_function_privilege('anon', 'public.my_activities()', 'execute'), false, 'anon cannot call my_activities');
select is((select schedule from cron.job where jobname = 'extend-sessions'), '30 2 * * *', 'nightly horizon job at 02:30 UTC');

-- weekly across the DST change (Europe/Paris leaves summer time on 2026-10-25)
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000f1', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go du mardi', 'Cafe du Parc', 'POINT(4.85 45.77)', 'weekly', '2026-10-20', '19:00');
select is((select count(*) from sessions where activity_id = '00000000-0000-0000-0000-0000000000f1' and starts_at <= now())::int, 0,
  'automatic generation never creates past sessions');
select ok((select count(*) from sessions where activity_id = '00000000-0000-0000-0000-0000000000f1') > 0, 'sessions generated on insert');
-- Explicit p_from: the generator may backfill fixed (possibly past) dates when called by the platform.
delete from sessions where activity_id = '00000000-0000-0000-0000-0000000000f1';
select is(public.generate_sessions('00000000-0000-0000-0000-0000000000f1', '2026-12-14', '2026-10-20'), 8, 'weekly Tuesday from 2026-10-20 gives 8 sessions to 2026-12-14');
select is((select starts_at at time zone 'Europe/Paris' from sessions where activity_id = '00000000-0000-0000-0000-0000000000f1'
             and (starts_at at time zone 'Europe/Paris')::date = '2026-10-27'), '2026-10-27 19:00'::timestamp, '2026-10-27 (after DST) is 19:00 Paris');
select is((select starts_at at time zone 'Europe/Paris' from sessions where activity_id = '00000000-0000-0000-0000-0000000000f1'
             and (starts_at at time zone 'Europe/Paris')::date = '2026-10-20'), '2026-10-20 19:00'::timestamp, '2026-10-20 (before DST) is 19:00 Paris');
select is((select starts_at from sessions where activity_id = '00000000-0000-0000-0000-0000000000f1'
             and (starts_at at time zone 'Europe/Paris')::date = '2026-10-27') - (select starts_at from sessions where activity_id = '00000000-0000-0000-0000-0000000000f1'
             and (starts_at at time zone 'Europe/Paris')::date = '2026-10-20'), interval '7 days 1 hour', 'one more real hour across the DST change');
select is((select array_agg(distinct extract(isodow from starts_at at time zone 'Europe/Paris')::int) from sessions where activity_id = '00000000-0000-0000-0000-0000000000f1'),
  array[2], 'all on Tuesdays');
select is(public.generate_sessions('00000000-0000-0000-0000-0000000000f1', '2026-12-14', '2026-10-20'), 0, 'second call inserts nothing');

-- every 3 days from a Monday, and chosen weekdays
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, recurrence_interval_days, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000f2', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go tous les 3 jours', 'Parc', 'POINT(4.85 45.77)', 'every_n_days', 3, '2026-10-19', '19:00');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, recurrence_weekdays, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000f3', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go lundi et jeudi', 'Parc', 'POINT(4.85 45.77)', 'weekdays', '{1,4}', '2026-10-19', '19:00');
delete from sessions where activity_id in ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3');
select is(public.generate_sessions('00000000-0000-0000-0000-0000000000f2', '2026-11-01', '2026-10-19'), 5, 'every 3 days: 5 sessions 19 Oct to 1 Nov');
select is((select array_agg(extract(isodow from starts_at at time zone 'Europe/Paris')::int order by starts_at) from sessions where activity_id = '00000000-0000-0000-0000-0000000000f2'),
  array[1, 4, 7, 3, 6], 'Mon, Thu, Sun, Wed, Sat');
select is((select bool_and((starts_at at time zone 'Europe/Paris')::time = '19:00') from sessions where activity_id = '00000000-0000-0000-0000-0000000000f2'),
  true, 'every 3 days: no drift across DST');
select is(public.generate_sessions('00000000-0000-0000-0000-0000000000f3', '2026-11-01', '2026-10-19'), 4, 'weekdays {1,4}: 4 sessions 19 Oct to 1 Nov');
select is((select array_agg(distinct extract(isodow from starts_at at time zone 'Europe/Paris')::int) from sessions where activity_id = '00000000-0000-0000-0000-0000000000f3'),
  array[1, 4], 'Mondays and Thursdays only');

-- a live activity: weekly from the day after tomorrow, max 3 people
insert into activities (id, organiser_id, category_id, title, description, place_label, place, recurrence_kind, start_date, start_time, max_size, organised_by_association_id) values
  ('00000000-0000-0000-0000-0000000000f4', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go du soir', 'Parties libres', 'Bar du Coin', 'POINT(4.8512 45.7689)', 'weekly',
   current_date + 2, '19:00', 3, '00000000-0000-0000-0000-0000000000a1');
insert into activity_tags (activity_id, tag_id) values ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from sessions where activity_id = '00000000-0000-0000-0000-0000000000f4')::int, 8, '8 weeks of sessions generated on insert');
select is(public.generate_sessions('00000000-0000-0000-0000-0000000000f4', current_date + 56), 0, 'nightly run within the horizon adds nothing');
select is(public.generate_sessions('00000000-0000-0000-0000-0000000000f4', current_date + 63), 1, 'nightly run extends the horizon by one week');
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000f4', :'mem', 'member'),
  ('00000000-0000-0000-0000-0000000000f4', :'mem2', 'member'),
  ('00000000-0000-0000-0000-0000000000f4', :'pend', 'pending');
select id as s1 from sessions where activity_id = '00000000-0000-0000-0000-0000000000f4' order by starts_at limit 1 \gset

-- capacity
select tests.act_as(:'mem');
select lives_ok(format($f$ insert into attendances (session_id, user_id, status, guest_count) values (%L, auth.uid(), 'confirmed', 1) $f$, :'s1'),
  'member confirms with a guest (2 of 3)');
select throws_ok(format($f$ update attendances set guest_count = 2 where session_id = %L and user_id = auth.uid() $f$, :'s1'),
  '23514', null, 'guest_count 2 refused');
select tests.act_as(:'mem2');
select throws_ok(format($f$ insert into attendances (session_id, user_id, status, guest_count) values (%L, auth.uid(), 'confirmed', 1) $f$, :'s1'),
  'P0001', 'session_full', 'second confirmation with a guest would make 4 of 3');
select lives_ok(format($f$ insert into attendances (session_id, user_id, status, guest_count) values (%L, auth.uid(), 'confirmed', 0) $f$, :'s1'),
  'second confirmation alone fits (3 of 3)');
select throws_ok(format($f$ update attendances set guest_count = 1 where session_id = %L and user_id = auth.uid() $f$, :'s1'),
  'P0001', 'session_full', 'adding a guest to a full session refused');
select lives_ok(format($f$ update attendances set status = 'cancelled' where session_id = %L and user_id = auth.uid() $f$, :'s1'),
  'cancelling is always possible');
select lives_ok(format($f$ update attendances set status = 'confirmed' where session_id = %L and user_id = auth.uid() $f$, :'s1'),
  're-confirming fits again');
select tests.act_as_superuser();
-- Concurrency: the capacity trigger locks the session row before counting, so two confirmations
-- for the same session are serialised.
select matches((select prosrc from pg_proc where proname = 'attendances_capacity'), 'for update', 'capacity check locks the session row');

-- activity page
update activities set welcome_member_id = :'mem' where id = '00000000-0000-0000-0000-0000000000f4';
select tests.act_as_anon();
select is(public.get_activity('00000000-0000-0000-0000-0000000000f4')->>'title', 'Go du soir', 'anon sees the activity');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'next_sessions'->0->>'confirmed_count', '3', 'counts include guests');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'next_sessions'->0->>'is_full', 'true', 'full session flagged');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'next_sessions'->0 ? 'attendees', false, 'anon sees no attendees');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f4') ? 'welcome_first_name', false, 'anon sees no welcome first name');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f4')->>'my_status', 'none', 'anon status none');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'organised_by', '{"kind": "association", "id": "00000000-0000-0000-0000-0000000000a1", "name": "Club de go"}'::jsonb, 'organised by the association');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'organiser') k),
  array['first_name', 'id', 'photo_url'], 'organiser: public fields only (id for report and block)');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'organiser'->>'id', :'org', 'the organiser id is present');
select is(jsonb_array_length(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'next_sessions'), 8, 'next 8 sessions');
select tests.act_as(:'mem');
select is(jsonb_array_length(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'next_sessions'->0->'attendees'), 2, 'member sees the 2 attendees');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'next_sessions'->0->'attendees'->0) k),
  array['first_name', 'id', 'photo_url'], 'attendees: public fields only (id for report and block)');
select is((select array_agg(e->>'id' order by e->>'id') from jsonb_array_elements(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'next_sessions'->0->'attendees') e),
  (select array_agg(x order by x) from unnest(array[:'mem', :'mem2']) x), 'a member sees the attendee ids');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f4')->>'welcome_first_name', 'Mia', 'member sees the welcome first name');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f4')->>'my_status', 'member', 'member status');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'next_sessions'->0->'my_attendance', '{"status": "confirmed", "guest_count": 1}'::jsonb, 'own attendance');
select tests.act_as(:'outsider');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'next_sessions'->0 ? 'attendees', false, 'signed-in non-member sees no attendees');
select tests.act_as(:'pend');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f4')->>'my_status', 'pending', 'pending status');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'next_sessions'->0 ? 'attendees', false, 'pending applicant sees no attendees');
select tests.act_as(:'org');
select is(jsonb_array_length(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'next_sessions'->0->'attendees'), 2, 'organiser sees the attendees');

-- blocks hide attendees in both directions (counts unchanged)
select tests.act_as_superuser();
insert into blocks (blocker_id, blocked_id) values (:'mem2', :'mem');
select tests.act_as(:'mem');
select is((select array_agg(e->>'first_name') from jsonb_array_elements(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'next_sessions'->0->'attendees') e),
  array['Mia'], 'a member does not see someone who blocked them');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'next_sessions'->0->>'confirmed_count', '3', 'counts still include everyone');
select tests.act_as(:'mem2');
select is((select array_agg(e->>'first_name') from jsonb_array_elements(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'next_sessions'->0->'attendees') e),
  array['Marc'], 'a member does not see someone they blocked');
select is((select array_agg(e->>'first_name') from jsonb_array_elements(public.my_activities()->0->'next_session'->'attendees') e),
  array['Marc'], 'my_activities attendees exclude blocked people too');
select tests.act_as(:'org');
select is(jsonb_array_length(public.get_activity('00000000-0000-0000-0000-0000000000f4')->'next_sessions'->0->'attendees'), 2, 'the organiser, not involved, still sees both');
select tests.act_as_superuser();
delete from blocks;

-- archived activity
select tests.act_as_superuser();
update activities set archived_at = now() where id = '00000000-0000-0000-0000-0000000000f3';
select tests.act_as(:'outsider');
select is(public.get_activity('00000000-0000-0000-0000-0000000000f3'), null, 'archived activity hidden from non-organisers');
select tests.act_as(:'org');
select isnt(public.get_activity('00000000-0000-0000-0000-0000000000f3'), null, 'organiser still sees an archived activity');

-- my activities
select tests.act_as(:'org');
select is((select array_agg(e->>'id' order by e->>'id') from jsonb_array_elements(public.my_activities()) e),
  array['00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f4'], 'organiser: own non-archived activities');
select tests.act_as(:'mem');
select is((select e->'next_session'->>'id' from jsonb_array_elements(public.my_activities()) e where e->>'id' = '00000000-0000-0000-0000-0000000000f4'),
  :'s1', 'member: joined activity with its next session');
select is((select e->'next_session'->'my_attendance'->>'status' from jsonb_array_elements(public.my_activities()) e where e->>'id' = '00000000-0000-0000-0000-0000000000f4'),
  'confirmed', 'member: own attendance on the next session');
select tests.act_as(:'pend');
select is((select e->>'my_status' from jsonb_array_elements(public.my_activities()) e where e->>'id' = '00000000-0000-0000-0000-0000000000f4'),
  'pending', 'pending applicant: activity listed as pending');

-- the organiser changes the time: unconfirmed sessions move, the confirmed one is kept
select tests.act_as(:'org');
select lives_ok($$ update activities set start_time = '20:00' where id = '00000000-0000-0000-0000-0000000000f4' $$, 'organiser changes the time');
select tests.act_as_superuser();
select is((select starts_at at time zone 'Europe/Paris' from sessions where id = :'s1'), ((current_date + 2) + time '19:00'), 'confirmed session kept at 19:00');
select is((select count(*) from sessions where activity_id = '00000000-0000-0000-0000-0000000000f4' and (starts_at at time zone 'Europe/Paris')::time = '19:00')::int,
  1, 'only the confirmed session stays at 19:00');
select is((select count(*) from sessions where activity_id = '00000000-0000-0000-0000-0000000000f4' and (starts_at at time zone 'Europe/Paris')::time = '20:00')::int,
  7, 'the other 7 weeks are at 20:00 (no second session on the kept date)');

-- session_matches_rule compares the generated instant: DST edge start times still match
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000f6', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go de nuit printemps', 'Parc', 'POINT(4.85 45.77)', 'weekly', '2027-03-21', '02:30'),
  ('00000000-0000-0000-0000-0000000000f7', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go de nuit automne', 'Parc', 'POINT(4.85 45.77)', 'weekly', '2026-10-18', '02:30');
delete from sessions where activity_id in ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000f7');
select is(public.generate_sessions('00000000-0000-0000-0000-0000000000f6', '2027-04-04', '2027-03-21'), 3, 'spring: 3 Sundays generated around 2027-03-28');
select is((select bool_and(public.session_matches_rule(a, s.starts_at)) from sessions s join activities a on a.id = s.activity_id
            where a.id = '00000000-0000-0000-0000-0000000000f6'), true, 'spring-forward 02:30 session matches its rule');
select is(public.generate_sessions('00000000-0000-0000-0000-0000000000f7', '2026-11-01', '2026-10-18'), 3, 'autumn: 3 Sundays generated around 2026-10-25');
select is((select bool_and(public.session_matches_rule(a, s.starts_at)) from sessions s join activities a on a.id = s.activity_id
            where a.id = '00000000-0000-0000-0000-0000000000f7'), true, 'fall-back 02:30 session matches its rule');
select is((select public.session_matches_rule(a, s.starts_at + interval '1 hour') from sessions s join activities a on a.id = s.activity_id
            where a.id = '00000000-0000-0000-0000-0000000000f6' order by s.starts_at limit 1), false, 'a session one hour off does not match');
select lives_ok($$ update activities set start_date = '2027-03-14' where id = '00000000-0000-0000-0000-0000000000f6' $$, 'start date moved one week earlier (same weekday)');
select is((select count(*) from sessions where activity_id = '00000000-0000-0000-0000-0000000000f6')::int, 3, 'spring-forward sessions not treated as moved');

-- organiser cancels one session and moves another; the nightly job keeps both, without duplicates
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000f8', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go du jeudi', 'Parc', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00');
select id as s_cancel from sessions where activity_id = '00000000-0000-0000-0000-0000000000f8' order by starts_at offset 1 limit 1 \gset
select id as s_move, starts_at as s_move_old from sessions where activity_id = '00000000-0000-0000-0000-0000000000f8' order by starts_at offset 2 limit 1 \gset
select tests.act_as(:'org');
select lives_ok(format($f$ update sessions set status = 'cancelled_by_organiser' where id = %L $f$, :'s_cancel'), 'organiser cancels a session');
select lives_ok(format($f$ update sessions set starts_at = starts_at + interval '1 day' where id = %L $f$, :'s_move'), 'organiser moves a session to the next day');
select tests.act_as_superuser();
select lives_ok($$ select public.extend_sessions() $$, 'nightly job runs');
select is((select count(*) from sessions where activity_id = '00000000-0000-0000-0000-0000000000f8')::int, 8, 'still 8 sessions');
select is((select status from sessions where id = :'s_cancel'), 'cancelled_by_organiser', 'cancelled session survives, still cancelled');
select is((select count(*) from sessions where activity_id = '00000000-0000-0000-0000-0000000000f8' and starts_at = :'s_move_old')::int, 0, 'moved slot not re-created');
select is((select starts_at from sessions where id = :'s_move'), :'s_move_old'::timestamptz + interval '1 day', 'moved session kept at its new date');
select is((select schedule || ' ' || command from cron.job where jobname = 'extend-sessions'), '30 2 * * * select public.extend_sessions()', 'cron runs extend_sessions');

-- unarchiving brings sessions back at once
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, archived_at) values
  ('00000000-0000-0000-0000-0000000000f9', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go en pause', 'Parc', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', now());
select is((select count(*) from sessions where activity_id = '00000000-0000-0000-0000-0000000000f9')::int, 0, 'archived activity gets no sessions');
select tests.act_as(:'org');
select lives_ok($$ update activities set archived_at = null where id = '00000000-0000-0000-0000-0000000000f9' $$, 'organiser unarchives');
select tests.act_as_superuser();
select is((select count(*) from sessions where activity_id = '00000000-0000-0000-0000-0000000000f9')::int, 8, 'sessions generated on unarchive');

select * from finish();
rollback;
