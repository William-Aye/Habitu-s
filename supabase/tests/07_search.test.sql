begin;
\ir helpers.inc
select plan(41);
select has_schema('search');
select is(search.score(0.88, false, 0, 0, false), 100::smallint, 'top similarity = 100');
select is(search.score(0.75, false, 0, 0, false), 0::smallint, 'floor similarity = 0');
select is(search.score(0.815, false, 0, 0, false), 50::smallint, 'midpoint = 50');
select is(search.score(0.815, true, 0, 0, false), 58::smallint, 'keyword boost +8');
select is(search.score(0.815, false, 0, 15, false), 35::smallint, 'penalty subtracts');
select is(search.score(0.815, false, 0, 0, true), 55::smallint, 'Nouvelle +5');
select is(search.score(null, true, 1.0, 0, false), 90::smallint, 'keyword-only full name match');
select is(search.score(null, false, 0.9, 0, false), 0::smallint, 'keyword-only without hit');
select is(search.penalty(true, 85::smallint, 'rna', false), 15, 'not public');
select is(search.penalty(true, 40::smallint, 'rna', false), 25, 'not public + low confidence');
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
select tests.act_as_anon();
select throws_ok($$ select address from associations $$, '42501', null, 'anon cannot read address');
select throws_ok($$ select location from associations $$, '42501', null, 'anon cannot read location');
select lives_ok($$ select name, city, town_point from associations $$, 'anon reads public columns');
select throws_ok($$ select * from query_embedding_cache $$, '42501', null, 'cache is service-only');
select throws_ok($$ insert into association_waiters (association_id, user_id)
                    values ('00000000-0000-0000-0000-00000000f001', gen_random_uuid()) $$,
                 '42501', null, 'anon cannot wait');
select * from finish();
rollback;
