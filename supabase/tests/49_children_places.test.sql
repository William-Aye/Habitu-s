-- Activities with children: the place stays hidden from everyone who is not an accepted member,
-- the organiser or an admin, through the raw API, the read functions and the search.
begin;
\ir helpers.inc
select plan(34);

select tests.create_user('org@cp.fr', 'Olivier') as org \gset
select tests.create_user('mem@cp.fr', 'Mia') as mem \gset
select tests.create_user('pend@cp.fr', 'Paula') as pend \gset
select tests.create_user('out@cp.fr', 'Hugo') as outsider \gset
select tests.create_user('adm@cp.fr', 'Ada') as adm \gset
update profiles set age_confirmed = true, created_at = now() - interval '10 days',
                    photo_url = id::text || '/' || md5(id::text) || '.jpg';
update profiles set role = 'admin' where id = :'adm';
insert into categories (id, slug, name_fr, name_en, icon) values
  ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
select id as fam from categories where slug = 'family-sorties-parents-enfants' \gset

-- F: with children. G: without. F2: with children, placed for the radius-edge cases.
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000f1', :'org', :'fam', 'Sortie au square', 'Square des Enfants', 'POINT(4.85123 45.76789)', 'weekly', current_date + 2, '10:00'),
  ('00000000-0000-0000-0000-0000000000f2', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go du parc', 'Club', 'POINT(4.85321 45.77012)', 'weekly', current_date + 2, '18:00'),
  ('00000000-0000-0000-0000-0000000000f3', :'org', :'fam', 'Sortie au bord', 'Berges', 'POINT(4.85 45.7649)', 'weekly', current_date + 3, '10:00');
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000f1', :'mem', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', :'pend', 'pending'),
  ('00000000-0000-0000-0000-0000000000f2', :'mem', 'member');

-- ---- the raw API never gives the place columns ------------------------------------------------
select tests.act_as_anon();
select throws_ok('select place from activities', '42501', null, 'anon cannot read activities.place');
select throws_ok('select place_label from activities', '42501', null, 'anon cannot read activities.place_label');
select throws_ok('select search_point from activities', '42501', null, 'anon cannot read activities.search_point');
select throws_ok('select place from sessions', '42501', null, 'anon cannot read sessions.place');
select throws_ok('select place_label from sessions', '42501', null, 'anon cannot read sessions.place_label');
select lives_ok('select id, title, with_children from activities', 'anon still reads the other activity columns');
select lives_ok('select id, activity_id, starts_at, status from sessions', 'anon still reads the other session columns');
select tests.act_as(:'outsider');
select throws_ok('select place from activities', '42501', null, 'a member of the public cannot read activities.place');
select throws_ok('select place_label from activities', '42501', null, 'a member of the public cannot read activities.place_label');
select throws_ok('select search_point from activities', '42501', null, 'a member of the public cannot read activities.search_point');
select throws_ok('select place from sessions', '42501', null, 'a member of the public cannot read sessions.place');
select throws_ok('select place_label from sessions', '42501', null, 'a member of the public cannot read sessions.place_label');
select lives_ok('select id, title, with_children from activities', 'signed-in people still read the other activity columns');
select lives_ok('select id, activity_id, starts_at, status from sessions', 'signed-in people still read the other session columns');

-- ---- get_activity -----------------------------------------------------------------------------
create or replace function pg_temp.hidden(p jsonb) returns jsonb language sql as $$
  select jsonb_build_object('hidden', p->'place_hidden', 'place', p->'place_label', 'lon', p->'lon', 'lat', p->'lat',
                            'with_children', p->'with_children')
$$;
create or replace function pg_temp.session_places(p jsonb) returns bigint language sql as $$
  select count(*) from jsonb_array_elements(p->'next_sessions') s where s->>'place_label' is not null
$$;
grant execute on function pg_temp.hidden(jsonb), pg_temp.session_places(jsonb) to anon, authenticated;

select tests.act_as_anon();
select is(pg_temp.hidden(get_activity('00000000-0000-0000-0000-0000000000f1')),
  '{"hidden": true, "place": null, "lon": null, "lat": null, "with_children": true}'::jsonb, 'anon: place hidden');
select is(pg_temp.session_places(get_activity('00000000-0000-0000-0000-0000000000f1')), 0::bigint, 'anon: no session place');
select is(get_activity('00000000-0000-0000-0000-0000000000f1')->'children_requirements_missing', '[]'::jsonb, 'anon: no requirement list');
select tests.act_as(:'outsider');
select is(pg_temp.hidden(get_activity('00000000-0000-0000-0000-0000000000f1')),
  '{"hidden": true, "place": null, "lon": null, "lat": null, "with_children": true}'::jsonb, 'stranger: place hidden');
select is(pg_temp.session_places(get_activity('00000000-0000-0000-0000-0000000000f1')), 0::bigint, 'stranger: no session place');
select tests.act_as(:'pend');
select is(pg_temp.hidden(get_activity('00000000-0000-0000-0000-0000000000f1')),
  '{"hidden": true, "place": null, "lon": null, "lat": null, "with_children": true}'::jsonb, 'pending requester: place hidden');
select is(pg_temp.session_places(get_activity('00000000-0000-0000-0000-0000000000f1')), 0::bigint, 'pending requester: no session place');

select tests.act_as(:'mem');
select ok((select j->>'place_hidden' = 'false' and j->>'place_label' = 'Square des Enfants'
                  and (j->>'lon')::float8 = 4.85123 and (j->>'lat')::float8 = 45.76789
             from (select get_activity('00000000-0000-0000-0000-0000000000f1') j) x), 'member: exact place');
select ok(pg_temp.session_places(get_activity('00000000-0000-0000-0000-0000000000f1')) > 0, 'member: session places');
select tests.act_as(:'org');
select ok((select j->>'place_hidden' = 'false' and (j->>'lon')::float8 = 4.85123 and (j->>'lat')::float8 = 45.76789
             from (select get_activity('00000000-0000-0000-0000-0000000000f1') j) x), 'organiser: exact place');
select tests.act_as_admin(:'adm');
select ok((select j->>'place_hidden' = 'false' and (j->>'lon')::float8 = 4.85123 and (j->>'lat')::float8 = 45.76789
                  and (select count(*) from jsonb_array_elements(j->'next_sessions') s where s->>'place_label' is not null) > 0
             from (select get_activity('00000000-0000-0000-0000-0000000000f1') j) x), 'admin: exact place and session places');

select tests.act_as_anon();
select ok((select j->>'place_hidden' = 'false' and j->>'place_label' = 'Club' and (j->>'lon')::float8 = 4.85321
             from (select get_activity('00000000-0000-0000-0000-0000000000f2') j) x), 'activities without children are unchanged');

-- ---- my_activities ----------------------------------------------------------------------------
select tests.act_as(:'pend');
select is((select e->'place_label' from jsonb_array_elements(my_activities()) e where e->>'id' = '00000000-0000-0000-0000-0000000000f1'),
  'null'::jsonb, 'my_activities: no place for a pending requester');
select tests.act_as(:'org');
select is((select e->>'place_label' from jsonb_array_elements(my_activities()) e where e->>'id' = '00000000-0000-0000-0000-0000000000f1'),
  'Square des Enfants', 'my_activities: the organiser keeps the place');

-- ---- search -----------------------------------------------------------------------------------
select tests.act_as_anon();
select ok((select (e->>'lon')::float8 = 4.85 and (e->>'lat')::float8 = 45.77 and e->'subtitle' = 'null'::jsonb
                  and e->'with_children' = 'true'::jsonb
             from jsonb_array_elements(search_explore(4.85, 45.77, 5)->'results') e
            where e->>'id' = '00000000-0000-0000-0000-0000000000f1'), 'search: rounded point, no place label');
select ok((select (e->>'lon')::float8 = 4.85321 and (e->>'lat')::float8 = 45.77012 and e->>'subtitle' = 'Club'
                  and e->'with_children' = 'false'::jsonb
             from jsonb_array_elements(search_explore(4.85, 45.77, 5)->'results') e
            where e->>'id' = '00000000-0000-0000-0000-0000000000f2'), 'search: exact point without children');
-- F3 is at 45.7649 (rounded 45.76). From 45.8081 the exact point is 4.8 km away, the rounded one 5.35 km.
select is((select count(*) from jsonb_array_elements(search_explore(4.85, 45.8081, 5)->'results') e
            where e->>'id' = '00000000-0000-0000-0000-0000000000f3'), 0::bigint, 'search: the radius uses the rounded point (outside)');
-- From 45.7168 the rounded point is 4.8 km away, the exact one 5.35 km.
select is((select count(*) from jsonb_array_elements(search_explore(4.85, 45.7168, 5)->'results') e
            where e->>'id' = '00000000-0000-0000-0000-0000000000f3'), 1::bigint, 'search: the radius uses the rounded point (inside)');

-- ---- an activity moved into the Parents category ----------------------------------------------
select tests.act_as(:'org');
update activities set category_id = :'fam' where id = '00000000-0000-0000-0000-0000000000f2';
select tests.act_as_anon();
select is(get_activity('00000000-0000-0000-0000-0000000000f2')->'place_hidden', 'true'::jsonb, 'moved into Parents: place hidden at once');
select tests.act_as(:'mem');
select is(get_activity('00000000-0000-0000-0000-0000000000f2')->>'place_label', 'Club', 'moved into Parents: existing members keep it');

select * from finish();
rollback;
