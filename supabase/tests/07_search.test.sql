begin;
\ir helpers.inc
select plan(96);
select has_schema('search');
select is(search.score(0.865, false, 0, 0, false), 100::smallint, 'top similarity = 100');
select is(search.score(0.77, false, 0, 0, false), 0::smallint, 'floor similarity = 0');
select is(search.score(0.8175, false, 0, 0, false), 50::smallint, 'midpoint = 50');
select is(search.score(0.8175, true, 0, 0, false), 58::smallint, 'keyword boost +8');
select is(search.score(0.8175, false, 0, 15, false), 35::smallint, 'penalty subtracts');
select is(search.score(0.8175, false, 0, 0, true), 55::smallint, 'Nouvelle +5');
select is(search.score(null, true, 1.0, 0, false), 90::smallint, 'keyword-only full name match');
select is(search.score(null, false, 0.9, 0, false), 0::smallint, 'keyword-only without hit');
select is(search.penalty(true, 85::smallint, 'rna', false), 25, 'not public');
select is(search.penalty(true, 40::smallint, 'rna', false), 35, 'not public + low confidence');
select is(search.penalty(false, 0::smallint, 'community', false), 10, 'community counted once');
select ok(search.is_hidden(0::smallint, 'rna'), 'confidence 0 hidden');
select ok(not search.is_hidden(20::smallint, 'osm'), '20 visible');
select ok(not search.is_hidden(0::smallint, 'community'), 'community never hidden by confidence');
select ok(search.is_dormant(null, null, null, '2016-10-21', 'rna', '2026-10-22'), 'over 10 years');
select ok(not search.is_dormant(null, null, null, '2016-10-23', 'rna', '2026-10-22'), 'under 10 years');
select ok(search.is_dormant(null, null, null, null, 'rna', '2026-10-22'), 'never published');
select ok(not search.is_dormant('https://x.fr', null, null, null, 'rna', '2026-10-22'), 'website');
select ok(not search.is_dormant(null, 'node/1', null, null, 'rna+osm', '2026-10-22'), 'osm match');
select ok(not search.is_dormant(null, null, null, null, 'community', '2026-10-22'), 'community');
select is(search.anonymise_query('  Yoga   LYON '), 'yoga lyon', 'normalised');
select is(search.anonymise_query('appelez 0612345678 yoga'), 'appelez yoga', 'phone removed');
select is(search.anonymise_query('jean@exemple.fr cours'), 'cours', 'email removed');

insert into associations (id, name, source, confidence, location)
values ('00000000-0000-0000-0000-00000000f001', 'Club de Go de Lyon', 'rna', 60,
        'SRID=4326;POINT(4.83456 45.76789)');
select is(ST_AsText((select town_point from associations where id = '00000000-0000-0000-0000-00000000f001')),
          'POINT(4.83 45.77)', 'town_point snapped to 0.01 degree');
insert into associations (id, name, source, confidence)
values ('00000000-0000-0000-0000-00000000f002', 'Club d''Échecs de Lyon', 'rna', 60);
select ok((select search_tsv from associations where id = '00000000-0000-0000-0000-00000000f002')
          @@ websearch_to_tsquery('french', search.unaccent('echecs')),
          'stored associations.search_tsv matches an unaccented word');
select throws_ok($$ insert into search_misses (query, area_label) values ('q', 'Lyon'), ('q', 'Lyon') $$,
                 '23505', null, 'search_misses aggregates per (query, area, day)');
select ok(not has_function_privilege('authenticated', f, 'execute'), f || ' not callable by API roles')
  from unnest(array['search.score(float8,boolean,real,int,boolean)', 'search.base_score(float8,boolean,real)',
    'search.penalty(boolean,smallint,text,boolean)', 'search.is_hidden(smallint,text)',
    'search.is_dormant(text,text,uuid,date,text,date)', 'search.anonymise_query(text)',
    'search.params()']) f;
select ok(has_function_privilege('authenticated', f, 'execute'), f || ' callable by authenticated')
  from unnest(array['search.unaccent(text)', 'search.normalise_name(text)']) f;
select tests.create_user('svc-orga@test.fr') as svc_orga \gset
set local role service_role;
select lives_ok($$ insert into associations (name, source, location)
                    values ('Club du service', 'community', 'SRID=4326;POINT(0.5 0.5)') $$,
                'service_role inserts an association (name_norm, search_tsv)');
select lives_ok(format($f$ insert into activities (organiser_id, category_id, title, place_label, place,
                    recurrence_kind, start_date, start_time)
                  values (%L, (select id from categories where slug = 'games-go'), 'Partie du service', 'Nulle part',
                          'SRID=4326;POINT(0.5 0.5)', 'weekly', '2026-11-01', '19:00') $f$, :'svc_orga'),
                'service_role inserts an activity (search_tsv)');
reset role;
select ok(not has_function_privilege('service_role', 'search.score(float8,boolean,real,int,boolean)', 'execute'),
          'search.score not callable by service_role');
select is((select proconfig from pg_proc
           where oid = 'search.explore_rows(geography,float8,text,extensions.vector,text[],smallint,boolean,text[])'::regprocedure),
          null, 'explore_rows has no SET clause, so it is inlined into search_explore');
select tests.act_as_anon();
select throws_ok($$ select address from associations $$, '42501', null, 'anon cannot read address');
select throws_ok($$ select location from associations $$, '42501', null, 'anon cannot read location');
select throws_ok($$ select created_by from associations $$, '42501', null, 'anon cannot read created_by');
select throws_ok($$ select claimed_by from associations $$, '42501', null, 'anon cannot read claimed_by');
select lives_ok($$ select name, city, town_point from associations $$, 'anon reads public columns');
select throws_ok($$ select * from query_embedding_cache $$, '42501', null, 'cache is service-only');
select throws_ok($$ insert into association_waiters (association_id, user_id)
                    values ('00000000-0000-0000-0000-00000000f001', gen_random_uuid()) $$,
                 '42501', null, 'anon cannot wait');

-- ---------------------------------------------------------------------------------------------
-- search_explore. Fixtures as superuser; each row's similarity to tests.vec(1.0) is exactly s.
select tests.act_as_superuser();

create function tests.vec(s float8) returns extensions.vector language sql immutable as $$
  select (array[s, sqrt(1 - s * s)] || array_fill(0::float8, array[382]))::extensions.vector
$$;
-- A point n km north and e km east of (lon, lat); defaults to Lyon (4.835, 45.764).
create function tests.pt(n float8, e float8 default 0, lon float8 default 4.835, lat float8 default 45.764)
returns geography language sql immutable as $$
  select ST_SetSRID(ST_MakePoint(lon + e / (111.32 * cos(radians(lat))), lat + n / 111.2), 4326)::geography
$$;
create function tests.ids(r jsonb) returns uuid[] language sql immutable as $$
  select coalesce(array_agg((e->>'id')::uuid order by n), '{}')
  from jsonb_array_elements(r->'results') with ordinality as x(e, n)
$$;
create function tests.pos(r jsonb, p_id text) returns bigint language sql immutable as $$
  select n from jsonb_array_elements(r->'results') with ordinality as x(e, n) where e->>'id' = p_id
$$;
create function tests.item(r jsonb, p_id text) returns jsonb language sql immutable as $$
  select e from jsonb_array_elements(r->'results') e where e->>'id' = p_id
$$;
-- Lyon search with the reference query embedding.
create function tests.lyon(q text, radius int default 10, sort text default 'best') returns jsonb
language sql volatile as $$
  select public.search_explore(4.835, 45.764, radius, q, tests.vec(1.0), p_sort => sort, p_limit => 50)
$$;
grant execute on all functions in schema tests to anon, authenticated;

insert into tags (slug, label_fr, label_en) values ('games-go', 'Jeu de go', 'Go') on conflict (slug) do nothing;

-- Lyon associations: (suffix, name, source, confidence, likely_not_public, rna_published_on, km north, s)
insert into associations (id, name, source, confidence, likely_not_public, rna_published_on, city, location, embedding)
select ('00000000-0000-0000-0000-0000000e0' || v.n)::uuid, v.name, v.src, v.conf, v.lnp, v.pub::date, 'Lyon',
       tests.pt(v.km), case when v.s is null then null else tests.vec(v.s) end
from (values
  ('001', 'Ludothèque de Caluire', 'rna', 85, false, '2020-01-01', 12.0, 0.90),
  ('002', 'Cercle Huit', 'rna', 85, false, '2020-01-01', 8.0, 0.87),
  ('003', 'Cercle Un', 'rna', 85, false, '2020-01-01', 1.0, 0.80),
  ('004', 'Bande Proche', 'rna', 85, false, '2020-01-01', 2.0, 0.8553),
  ('005', 'Bande Loin', 'rna', 85, false, '2020-01-01', 6.0, 0.8592),
  ('006', 'Score Quarante', 'rna', 85, false, '2020-01-01', 3.0, 0.808),
  ('007', 'Score Soixante-Quinze', 'rna', 85, false, '2020-01-01', 3.0, 0.8413),
  ('008', 'Jumeau Ouvert', 'rna', 85, false, '2020-01-01', 4.0, 0.86),
  ('009', 'Jumeau Fermé', 'rna', 85, true, '2020-01-01', 4.0, 0.86),
  ('010', 'Confiance Quarante', 'osm', 40, false, null, 3.0, 0.83),
  ('011', 'Les Joueurs de Molkky de la Guillotière', 'community', 0, false, null, 2.0, null),
  ('012', 'Cercle Caché de Pétanque', 'rna', 0, false, '2020-01-01', 2.0, 0.90),
  ('013', 'Amicale des Philatélistes du Rhône', 'rna', 60, false, '2000-01-01', 2.0, 0.80),
  ('014', 'Club d''Échecs de Lyon', 'rna', 85, false, '2020-01-01', 3.0, 0.82),
  ('015', 'Club de Go Lyonnais', 'rna', 85, false, '2020-01-01', 2.0, 0.83)
) v(n, name, src, conf, lnp, pub, km, s);
update associations set osm_id = 'node/9010' where id = '00000000-0000-0000-0000-0000000e0010';
insert into association_tags (association_id, tag_id)
select '00000000-0000-0000-0000-0000000e0015', id from tags where slug = 'games-go';
-- Only the purpose mentions the query, with an accent; similarity below the floor.
insert into associations (id, name, purpose, source, confidence, rna_published_on, city, location, embedding)
values ('00000000-0000-0000-0000-0000000e0016', 'Cercle de la Tour Prends', 'Parties d''échecs le samedi',
        'rna', 85, '2020-01-01', 'Lyon', tests.pt(2.5), tests.vec(0.70));

-- Lyon activities: (suffix, title, published days ago, recurrence, start_date, weekdays, newcomer, organiser, s)
create temp table fx_users as
select tests.create_user('orga@test.fr') as orga, tests.create_user('blocker@test.fr') as blocker,
       tests.create_user('u@test.fr') as u;
insert into blocks (blocker_id, blocked_id) select blocker, u from fx_users;
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind,
  recurrence_interval_days, recurrence_weekdays, start_date, start_time, newcomer_friendly, published_at, embedding)
select ('00000000-0000-0000-0000-0000000a0' || v.n)::uuid,
       case when v.blocked then f.blocker else f.orga end,
       (select id from categories where slug = case when v.n = '006' then 'games-go' else 'culture-cinema' end),
       v.title, 'Place Bellecour', tests.pt(3.0),
       v.kind, case when v.kind = 'every_n_days' then 3 end, v.wd::smallint[], v.start::date, '19:00',
       v.newcomer, now() - make_interval(days => v.ago), tests.vec(v.s)
from fx_users f, (values
  ('001', 'Atelier Arduino', 30, 'every_n_days', '2026-10-01', null, false, false, 0.70),
  ('002', 'Soirée jeux nouvelle', 3, 'every_n_days', '2026-10-01', null, false, false, 0.85),
  ('003', 'Soirée jeux ancienne', 20, 'every_n_days', '2026-10-01', null, false, false, 0.85),
  ('004', 'Marche du mardi', 30, 'weekly', '2026-10-20', null, false, false, 0.84),
  ('005', 'Marche du jeudi', 30, 'weekly', '2026-10-22', null, false, false, 0.84),
  ('006', 'Café débutants', 30, 'weekdays', '2026-10-01', '{1,3}', true, false, 0.84),
  ('007', 'Partie bloquée', 30, 'every_n_days', '2026-10-01', null, false, true, 0.84)
) v(n, title, ago, kind, start, wd, newcomer, blocked, s);

-- radius
select ok(tests.pos(tests.lyon('zorglub'), '00000000-0000-0000-0000-0000000e0001') is null,
          'radius: a match at 12 km is absent at 10 km');
select ok(tests.pos(tests.lyon('zorglub', 25), '00000000-0000-0000-0000-0000000e0001') is not null,
          'radius: a match at 12 km is present at 25 km');
-- order
select ok(tests.pos(tests.lyon('zorglub'), '00000000-0000-0000-0000-0000000e0002')
          < tests.pos(tests.lyon('zorglub'), '00000000-0000-0000-0000-0000000e0003'),
          'order: similarity 0.87 at 8 km ranks above 0.80 at 1 km');
select ok((tests.item(r, '00000000-0000-0000-0000-0000000e0004')->>'score')::int / 5
          = (tests.item(r, '00000000-0000-0000-0000-0000000e0005')->>'score')::int / 5
          and tests.pos(r, '00000000-0000-0000-0000-0000000e0004') < tests.pos(r, '00000000-0000-0000-0000-0000000e0005'),
          'order: same 5-point band, the nearer row first')
  from tests.lyon('zorglub') r;
select ok(count(*) > 3 and bool_and(d >= coalesce(prev, 0)),
          'order: nearest sorts non-weak rows by distance')
  from (select (e->>'distance_km')::numeric d, lag((e->>'distance_km')::numeric) over (order by n) prev
        from jsonb_array_elements(tests.lyon('zorglub', 10, 'nearest')->'results') with ordinality x(e, n)
        where not (e->>'is_weak')::boolean) t;
-- divider
select ok(max(n) filter (where not w) < min(n) filter (where w), 'divider: weak rows come after all others')
  from (select n, (e->>'is_weak')::boolean w
        from jsonb_array_elements(tests.lyon('zorglub')->'results') with ordinality x(e, n)) t;
select is(tests.item(tests.lyon('zorglub'), '00000000-0000-0000-0000-0000000e0006') - array['id','kind','title','subtitle','snippet','lon','lat','distance_km','is_new','source_label','tag_slugs'],
          '{"score": 40, "label": "weak", "is_weak": true}'::jsonb, 'divider: score 40 is weak');
select is(tests.item(tests.lyon('zorglub'), '00000000-0000-0000-0000-0000000e0007') - array['id','kind','title','subtitle','snippet','lon','lat','distance_km','is_new','source_label','tag_slugs'],
          '{"score": 75, "label": "very_relevant", "is_weak": false}'::jsonb, 'divider: score 75 is very relevant');
-- penalties
select ok(tests.pos(r, '00000000-0000-0000-0000-0000000e0008') < tests.pos(r, '00000000-0000-0000-0000-0000000e0009'),
          'penalties: the likely-not-public twin ranks below')
  from tests.lyon('zorglub') r;
select is(tests.item(tests.lyon('zorglub'), '00000000-0000-0000-0000-0000000e0010')->>'source_label', 'unverified',
          'penalties: confidence 40 is unverified');
-- community
select is(tests.item(tests.lyon('molkky'), '00000000-0000-0000-0000-0000000e0011')->>'source_label', 'community',
          'community: shown for molkky, labelled community');
-- hidden
select ok(tests.pos(tests.lyon('Cercle Caché de Pétanque'), '00000000-0000-0000-0000-0000000e0012') is null
          and tests.pos(public.search_explore(4.835, 45.764, p_limit => 50), '00000000-0000-0000-0000-0000000e0012') is null,
          'hidden: confidence 0 RNA row never returned, even by exact name');
-- dormant
select ok(tests.pos(public.search_explore(4.835, 45.764, p_limit => 50), '00000000-0000-0000-0000-0000000e0013') is null,
          'dormant: absent in browse');
select ok(tests.pos(tests.lyon('zorglub'), '00000000-0000-0000-0000-0000000e0013') is null,
          'dormant: absent for a generic query at similarity 0.80');
select ok(tests.pos(tests.lyon('Amicale des Philatélistes du Rhône'), '00000000-0000-0000-0000-0000000e0013') is not null,
          'dormant: present for its name');
-- new
select is((tests.item(tests.lyon('zorglub'), '00000000-0000-0000-0000-0000000a0002')->>'is_new')::boolean, true,
          'new: published 3 days ago is new');
select is((tests.item(r, '00000000-0000-0000-0000-0000000a0002')->>'score')::int
          - (tests.item(r, '00000000-0000-0000-0000-0000000a0003')->>'score')::int, 5, 'new: +5 over the 20-day twin')
  from tests.lyon('zorglub') r;
-- keyword
select is((tests.item(r, '00000000-0000-0000-0000-0000000e0014')->>'score')::int, 61,
          'keyword: echecs boosts Club d''Échecs de Lyon (similarity 53 + 8)')
  from tests.lyon('echecs') r;
select is((tests.item(r, '00000000-0000-0000-0000-0000000e0016')->>'score')::int, 8,
          'keyword: French FTS on the purpose (échecs) returns a row below the similarity floor')
  from tests.lyon('echecs') r;
select ok(tests.pos(tests.lyon('arduinno'), '00000000-0000-0000-0000-0000000a0001') is not null,
          'keyword: arduinno matches Atelier Arduino by name similarity');
-- keyword_only
select ok(r->>'mode' = 'keyword_only' and tests.pos(r, '00000000-0000-0000-0000-0000000e0014') is not null,
          'keyword_only: FTS match without embedding')
  from public.search_explore(4.835, 45.764, 10, 'echecs', null) r;
-- widen (Grenoble, away from the Lyon fixtures)
insert into associations (id, name, source, confidence, rna_published_on, city, location, embedding)
select ('00000000-0000-0000-0000-0000000c00' || lpad(i::text, 2, '0'))::uuid, 'Grenoble ' || i, 'rna', 85, '2020-01-01',
       'Grenoble', tests.pt(case when i = 1 then 3 else 30 end, 0, 5.72, 45.19), tests.vec(0.9)
from generate_series(1, 3) i;
select is(r - 'results' - 'has_more' - 'mode',
          '{"strong_count": 1, "strong_count_50km": 3, "suggest_radius_km": 50}'::jsonb,
          'widen: 1 strong in 10 km, 3 in 50 km')
  from public.search_explore(5.72, 45.19, 10, 'zorglub', tests.vec(1.0)) r;
insert into associations (id, name, source, confidence, rna_published_on, city, location, embedding)
select ('00000000-0000-0000-0000-0000000c00' || lpad(i::text, 2, '0'))::uuid, 'Grenoble ' || i, 'rna', 85, '2020-01-01',
       'Grenoble', tests.pt(i * 0.5, 0, 5.72, 45.19), tests.vec(0.9)
from generate_series(4, 8) i;
select is(r - 'results' - 'has_more' - 'mode',
          '{"strong_count": 6, "strong_count_50km": null, "suggest_radius_km": null}'::jsonb,
          'widen: 6 strong in 10 km, no suggestion')
  from public.search_explore(5.72, 45.19, 10, 'zorglub', tests.vec(1.0)) r;
-- filters
select ok(jsonb_array_length(r->'results') > 0
          and not exists (select 1 from jsonb_array_elements(r->'results') e where e->>'kind' = 'activity'),
          'filters: kinds association returns no activity')
  from public.search_explore(4.835, 45.764, p_kinds => '{association}', p_limit => 50) r;
select ok(tests.pos(r, '00000000-0000-0000-0000-0000000a0004') is not null, 'filters: Tuesday keeps the Tuesday weekly')
  from public.search_explore(4.835, 45.764, p_weekday => 2::smallint, p_limit => 50) r;
select ok(tests.pos(r, '00000000-0000-0000-0000-0000000a0005') is null, 'filters: Tuesday drops the Thursday weekly')
  from public.search_explore(4.835, 45.764, p_weekday => 2::smallint, p_limit => 50) r;
select ok(not exists (select 1 from jsonb_array_elements(r->'results') e where e->>'kind' = 'association'),
          'filters: a weekday drops every association')
  from public.search_explore(4.835, 45.764, p_weekday => 2::smallint, p_limit => 50) r;
select is(tests.ids(public.search_explore(4.835, 45.764, p_newcomer_friendly => true, p_limit => 50)),
          array['00000000-0000-0000-0000-0000000a0006'::uuid], 'filters: newcomer friendly only');
-- interests
select is(tests.ids(public.search_explore(4.835, 45.764,
            p_interest_category_ids => array[(select id from categories where slug = 'games-go')], p_limit => 50)),
          array['00000000-0000-0000-0000-0000000e0015'::uuid, '00000000-0000-0000-0000-0000000a0006'::uuid],
          'interests: games-go returns the go-tagged row and the games-go category activity');
select is(tests.ids(public.search_explore(4.835, 45.764,
            p_interest_category_ids => array[(select parent_id from categories where slug = 'games-go')], p_limit => 50)),
          array['00000000-0000-0000-0000-0000000e0015'::uuid, '00000000-0000-0000-0000-0000000a0006'::uuid],
          'interests: a parent category covers its children');
-- blocks
select tests.act_as((select u from fx_users));
select ok(tests.pos(public.search_explore(4.835, 45.764, p_limit => 50), '00000000-0000-0000-0000-0000000a0007') is null,
          'blocks: absent for the blocked user');
select tests.act_as_anon();
select ok(tests.pos(public.search_explore(4.835, 45.764, p_limit => 50), '00000000-0000-0000-0000-0000000a0007') is not null,
          'blocks: present for anon');
select tests.act_as_superuser();
-- pagination (Dijon)
insert into associations (id, name, source, confidence, rna_published_on, city, location, embedding)
select ('00000000-0000-0000-0000-0000000d00' || lpad(i::text, 2, '0'))::uuid, 'Dijon ' || i, 'rna', 85, '2020-01-01',
       'Dijon', tests.pt(i * 0.1, 0, 5.04, 47.32), tests.vec(0.9)
from generate_series(1, 25) i;
select is(array[(p1->>'has_more')::boolean, (p2->>'has_more')::boolean, (p3->>'has_more')::boolean],
          array[true, true, false], 'pagination: has_more true, true, false')
  from public.search_explore(5.04, 47.32, 5, 'zorglub', tests.vec(1.0), p_limit => 10, p_offset => 0) p1,
       public.search_explore(5.04, 47.32, 5, 'zorglub', tests.vec(1.0), p_limit => 10, p_offset => 10) p2,
       public.search_explore(5.04, 47.32, 5, 'zorglub', tests.vec(1.0), p_limit => 10, p_offset => 20) p3;
select is((select count(distinct i) from unnest(tests.ids(p1) || tests.ids(p2) || tests.ids(p3)) i), 25::bigint,
          'pagination: three pages return 25 distinct ids')
  from public.search_explore(5.04, 47.32, 5, 'zorglub', tests.vec(1.0), p_limit => 10, p_offset => 0) p1,
       public.search_explore(5.04, 47.32, 5, 'zorglub', tests.vec(1.0), p_limit => 10, p_offset => 10) p2,
       public.search_explore(5.04, 47.32, 5, 'zorglub', tests.vec(1.0), p_limit => 10, p_offset => 20) p3;
-- has_more stops before max_offset (Nantes, 502 rows)
insert into associations (name, source, confidence, rna_published_on, city, location, embedding)
select 'Nantes ' || i, 'rna', 85, '2020-01-01', 'Nantes', tests.pt(i * 0.005, 0, -1.55, 47.22), tests.vec(0.9)
from generate_series(1, 502) i;
select is(array[(a->>'has_more')::boolean, (b->>'has_more')::boolean], array[true, false],
          'pagination: has_more at offset 440, never past max_offset 500 at offset 450')
  from public.search_explore(-1.55, 47.22, 5, 'zorglub', tests.vec(1.0), p_limit => 50, p_offset => 440) a,
       public.search_explore(-1.55, 47.22, 5, 'zorglub', tests.vec(1.0), p_limit => 50, p_offset => 450) b;
-- misses
select public.search_explore(4.835, 45.764, 10, 'curling', null);
select results_eq($$ select query, area_label, day, hits from search_misses where query = 'curling' $$,
                  $$ values ('curling'::text, 'Lyon'::text, current_date, 1) $$, 'misses: first miss logged');
select is((select created_at from search_misses where query = 'curling'), current_date::timestamptz,
          'misses: created_at carries the day only');
select public.search_explore(4.835, 45.764, 10, 'curling', null);
select results_eq($$ select hits from search_misses where query = 'curling' $$, $$ values (2) $$,
                  'misses: same miss increments hits');
select public.search_explore(4.835, 45.764, 10, 'curling', null, p_offset => 10);
select results_eq($$ select hits from search_misses where query = 'curling' $$, $$ values (2) $$,
                  'misses: later pages are not logged');
select tests.lyon('yoga');
select is_empty($$ select 1 from search_misses where query = 'yoga' $$, 'misses: strong results are not logged');
-- input
select throws_ok($$ select public.search_explore(4.835, 45.764, 7) $$, '22023', null, 'input: radius 7');
select throws_ok($$ select public.search_explore(4.835, 45.764, 10, 'yoga', '[1,2,3]'::extensions.vector) $$,
                 '22023', null, 'input: 3-dimension embedding');
select throws_ok($$ select public.search_explore(4.835, 45.764, p_limit => 10000) $$, '22023', null, 'input: limit 10000');
select throws_ok($$ select public.search_explore(4.835, 45.764, p_offset => -1) $$, '22023', null, 'input: offset -1');
select throws_ok($$ select public.search_explore(4.835, 45.764, 10, repeat('a', 5000)) $$, '22023', null,
                 'input: 5000-character query');
select throws_ok($$ select public.search_explore(4.835, 200) $$, '22023', null, 'input: latitude 200');
select throws_ok($$ select public.search_explore(4.835, 45.764, p_sort => 'random') $$, '22023', null, 'input: sort random');
-- access
select ok(has_function_privilege('anon',
  'public.search_explore(float8,float8,int,text,extensions.vector,text[],smallint,boolean,uuid[],text,int,int)', 'execute'),
  'access: anon can execute search_explore');
select tests.act_as_anon();
select ok(count(*) > 5 and bool_and(not (e ?| array['address', 'location', 'embedding'])),
          'access: results never carry address, location or embedding')
  from jsonb_array_elements((public.search_explore(4.835, 45.764, 10, 'echecs', null)->'results')
                            || (public.search_explore(4.835, 45.764, p_limit => 50)->'results')) e;
select tests.act_as_superuser();
select * from finish();
rollback;
