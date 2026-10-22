begin;
\ir helpers.inc
select plan(48);
select has_schema('importer');
select has_table('public', 'import_runs', 'import_runs exists');
select has_column('public', 'associations', 'embedding_hash', 'associations.embedding_hash');
select is(importer.normalise_name('Association Le Club de Go d''Évry !'), 'go evry', 'normalise_name strips filler words and accents');
select is(importer.confidence(current_date - 365, true, true, true, current_date), 100::smallint, 'max confidence');
select is(importer.confidence(null, false, false, false, current_date), 20::smallint, 'base confidence');
select is(importer.confidence(current_date - 6*365, false, false, false, current_date), 20::smallint, 'old publication adds nothing');

select tests.create_user('u@test.fr', 'U') as u \gset
insert into import_runs (status) values ('succeeded');
select tests.act_as(:'u');
select throws_ok($$ select * from importer.staged_rna $$, '42501', null, 'API roles cannot read staging');
select is((select count(*) from import_runs)::int, 0, 'non-admin sees no runs');
select throws_ok($$ select importer.normalise_name('x') $$, '42501', null, 'authenticated cannot execute importer functions');
select tests.act_as_superuser();
update public.profiles set role = 'admin' where id = :'u';
select tests.act_as(:'u');
select is((select count(*) from import_runs)::int, 1, 'admin sees the run');
select tests.act_as_anon();
select throws_ok($$ select * from import_runs $$, '42501', null, 'anon cannot read runs');
-- ---------------------------------------------------------------------------------------------
-- importer.apply_run: merge of one run, scoped to département 69.
select tests.act_as_superuser();
select tests.create_user('claimant@test.fr', 'Claire') as claimant \gset
select tests.create_user('organiser@test.fr', 'Omar') as organiser \gset
insert into import_runs (scope) values (array['69']) returning id as run \gset

-- Reference points (lon, lat). Offsets below come from ST_Project, so distances are exact.
--   go1 = Club de Go de Lyon (Presqu'île)        4.835, 45.764
--   go2 = Lyon Go Club (Gerland, ~3.8 km south)  4.832, 45.730
--   ard = Villeurbanne                           4.880, 45.770
--   pars = Paris, le Marais                      2.360, 48.857
create temp table pts (k text primary key, g extensions.geography);
insert into pts values
  ('go1', 'SRID=4326;POINT(4.835 45.764)'), ('go2', 'SRID=4326;POINT(4.832 45.730)'),
  ('ard', 'SRID=4326;POINT(4.880 45.770)'), ('pars', 'SRID=4326;POINT(2.360 48.857)'),
  ('chorale', 'SRID=4326;POINT(4.827 45.774)'), ('boules', 'SRID=4326;POINT(4.826 45.749)'),
  ('escrime', 'SRID=4326;POINT(4.850 45.760)'), ('rando', 'SRID=4326;POINT(4.815 45.800)'),
  ('jardin', 'SRID=4326;POINT(4.845 45.745)');
create function pg_temp.pt(p_k text, p_metres float default 0, p_azimuth_deg float default 90)
returns extensions.geography language sql as $$
  select extensions.st_project(g, p_metres, radians(p_azimuth_deg))::extensions.geography
  from pg_temp.pts where k = p_k
$$;

-- Existing listings before the run.
insert into associations (rna_id, name, purpose, website, insee_code, location, source, locked_fields, confidence)
values
  ('W691000001', 'Chorale de la Croix-Rousse', 'Chant choral, répertoire édité par le bureau',
   'http://ancien-site.example', '69384', pg_temp.pt('chorale'), 'rna', '{purpose}', 40),
  ('W691000002', 'Amicale des boulistes de Perrache', null, null, '69382', pg_temp.pt('boules'), 'rna', '{}', 40),
  ('W691000003', 'Cercle d''escrime de la Guillotière', null, null, '69387', pg_temp.pt('escrime'), 'rna', '{}', 40),
  ('W691000004', 'Randonneurs des Monts d''Or', null, null, '69381', pg_temp.pt('rando'), 'rna', '{}', 40),
  ('W751000001', 'Club d''échecs du Marais', null, null, '75056', pg_temp.pt('pars'), 'rna', '{}', 45);
update associations set claimed_by = :'claimant' where rna_id = 'W691000003';
insert into associations (name, website, location, source, claimed_by, verified, locked_fields, created_by)
values ('Atelier Arduino Villeurbanne', 'https://arduino-villeurbanne.example', pg_temp.pt('ard'), 'community',
        :'claimant', true, '{website}', :'organiser')
returning id as community \gset
insert into association_claims (association_id, claimant_id, proof_method, status)
values (:'community', :'claimant', 'document', 'approved');
insert into activities (organiser_id, organised_by_association_id, category_id, title, place_label, place,
                        recurrence_kind, start_date, start_time)
values
  (:'organiser', :'community', (select id from categories where slug = 'games'), 'Soirée Arduino',
   'Villeurbanne', pg_temp.pt('ard'), 'weekly', current_date, '19:00'),
  (:'organiser', (select id from associations where rna_id = 'W691000004'),
   (select id from categories where slug = 'sport'), 'Rando du dimanche', 'Monts d''Or', pg_temp.pt('rando'),
   'weekly', current_date, '09:00');

-- Staging for the run.
insert into importer.staged_rna (run_id, rna_id, name, purpose, insee_code, location, geocode_precision,
                                 website, published_on, likely_not_public, tag_slugs, embedding_hash)
values
  (:'run', 'W691000010', 'Club de Go de Lyon', 'Pratique du jeu de go', '69381', pg_temp.pt('go1'), 'address',
   'https://go-lyon.example', current_date - 200, false, '{games-go}', 'h10'),
  (:'run', 'W691000011', 'Lyon Go Club', 'Jeu de go', '69387', pg_temp.pt('go2'), 'address',
   null, current_date - 200, false, '{}', 'h11'),
  (:'run', 'W691000001', 'Chorale de la Croix-Rousse', 'Chant', '69384', pg_temp.pt('chorale'), 'address',
   'https://chorale-croix-rousse.example', current_date - 100, false, '{music-chorale}', 'h01'),
  (:'run', 'W692660001', 'Atelier Arduino de Villeurbanne', 'Électronique libre', '69266',
   pg_temp.pt('ard', 80, 0), 'address', 'https://atelier-arduino.example', current_date - 100, false, '{}', 'h66'),
  (:'run', 'W691000012', 'Les Amis du Jardin Partagé', 'Jardinage collectif', '69388', pg_temp.pt('jardin'),
   'municipality', null, current_date - 100, false, '{outdoors-jardinage,not-a-real-slug}', 'h12');
insert into importer.staged_osm (run_id, osm_id, name, location, phone, tag_slugs, embedding_hash)
values
  (:'run', 'node/1001', 'Go Club Lyon', pg_temp.pt('go1', 120), '+33 4 78 00 00 01', '{games}', 'o1'),
  (:'run', 'node/1002', 'Club de Go de Lyon', pg_temp.pt('go2', 50), null, '{}', 'o2'),
  (:'run', 'way/1003', 'Club de Go Lyon Sud', pg_temp.pt('go2', 250, 180), null, '{}', 'o3'),
  (:'run', 'node/1004', 'Club d''échecs du Marais', pg_temp.pt('pars', 100), null, '{}', 'o4');

-- Sanity: fixture distances are what the assertions say.
select is((select round(extensions.st_distance(pg_temp.pt('go1'), pg_temp.pt('go1', 120))))::int, 120,
  'fixture: OSM "Go Club Lyon" is 120 m from the RNA row');
select is((select round(extensions.st_distance(pg_temp.pt('go2'), pg_temp.pt('go2', 250, 180))))::int, 250,
  'fixture: OSM "Club de Go Lyon Sud" is 250 m from the RNA row');

select importer.apply_run(:'run', array['69']) as counts \gset

-- Insert
select is((select source from associations where rna_id = 'W691000012'), 'rna', 'new RNA row inserted with source rna');
select ok((select attribution ? 'rna' from associations where rna_id = 'W691000012'), 'RNA row carries rna attribution');
-- OSM match at 120 m
select is((select count(*) from associations where rna_id = 'W691000010' or osm_id = 'node/1001')::int, 1,
  'RNA + OSM at 120 m are one row');
select is((select source from associations where rna_id = 'W691000010'), 'rna+osm', 'matched row is rna+osm');
select is((select osm_id from associations where rna_id = 'W691000010'), 'node/1001', 'matched row has osm_id');
select is((select phone from associations where rna_id = 'W691000010'), '+33 4 78 00 00 01', 'phone copied from OSM');
select is((select geocode_precision from associations where rna_id = 'W691000010'), 'osm', 'location taken from OSM');
select ok((select attribution ? 'rna' and attribution ? 'osm' from associations where rna_id = 'W691000010'),
  'merged row carries both attributions');
-- Ambiguity: 50 m vs 250 m
select is((select osm_id from associations where rna_id = 'W691000011'), 'node/1002',
  'the closer of two OSM candidates merges');
select is((select source from associations where osm_id = 'way/1003'), 'osm', 'the 250 m candidate is a separate OSM row');
-- Locks
select is((select purpose from associations where rna_id = 'W691000001'),
  'Chant choral, répertoire édité par le bureau', 'locked purpose is kept');
select is((select website from associations where rna_id = 'W691000001'),
  'https://chorale-croix-rousse.example', 'unlocked website is updated');
-- Removed / dissolved
select is((select count(*) from associations where rna_id = 'W691000002')::int, 0, 'absent unclaimed listing deleted');
select is((select confidence from associations where rna_id = 'W691000003'), 0::smallint, 'absent claimed listing kept at 0');
select is((select confidence from associations where rna_id = 'W691000004'), 0::smallint,
  'absent listing referenced by an activity kept at 0');
-- Scope
select is((select confidence from associations where rna_id = 'W751000001'), 45::smallint,
  'out-of-scope listing keeps its confidence');
select ok((select last_import_run is null and osm_id is null from associations where rna_id = 'W751000001'),
  'out-of-scope listing untouched');
select is((select count(*) from associations where osm_id = 'node/1004')::int, 0, 'out-of-scope OSM club ignored');
-- Community merge
select is((select claimed_by from associations where rna_id = 'W692660001'), :'claimant'::uuid,
  'community claimant carried over to the RNA row');
select ok((select verified and locked_fields = '{website}' from associations where rna_id = 'W692660001'),
  'verified flag and locks carried over');
select is((select website from associations where rna_id = 'W692660001'), 'https://arduino-villeurbanne.example',
  'value of the locked field carried over');
select is((select organised_by_association_id from activities where title = 'Soirée Arduino'),
  (select id from associations where rna_id = 'W692660001'), 'activity repointed to the RNA row');
select is((select association_id from association_claims where claimant_id = :'claimant'),
  (select id from associations where rna_id = 'W692660001'), 'claim repointed to the RNA row');
select is((select count(*) from associations where id = :'community')::int, 0, 'community row deleted');
-- Tags
select is((select array_agg(t.slug order by t.slug) from association_tags at join tags t on t.id = at.tag_id
           join associations a on a.id = at.association_id where a.rna_id = 'W691000012'),
  array['outdoors-jardinage'], 'tags equal staged slugs, unknown slug ignored');
select is((select array_agg(t.slug order by t.slug) from association_tags at join tags t on t.id = at.tag_id
           join associations a on a.id = at.association_id where a.rna_id = 'W691000010'),
  array['games', 'games-go'], 'merged row has RNA and OSM tags');
-- Confidence
select is((select confidence from associations where rna_id = 'W691000010'), 85::smallint,
  'recent + website + OSM, unclaimed = 85');
select is((select confidence from associations where rna_id = 'W692660001'), 75::smallint,
  'recent + website + claimed and verified = 75');
-- Run bookkeeping
select is((select status from import_runs where id = :'run'), 'succeeded', 'run succeeded');
select is((select counts from import_runs where id = :'run'), :'counts'::jsonb, 'counts stored on the run');
select is(:'counts'::jsonb,
  '{"inserted":4,"updated":1,"osm_matched":2,"osm_only":1,"community_merged":1,"removed":1,"kept_dissolved":2}'::jsonb,
  'counts');
select is((select count(*) from importer.staged_rna where run_id = :'run')
        + (select count(*) from importer.staged_osm where run_id = :'run'), 0::bigint, 'staging rows removed');
-- Privileges
select ok(not has_function_privilege('authenticated', 'importer.apply_run(uuid, text[])', 'execute'),
  'authenticated has no execute on apply_run');
select tests.act_as(:'claimant');
select throws_ok($$ select importer.apply_run(gen_random_uuid(), null) $$, '42501', null,
  'authenticated cannot execute apply_run');
select tests.act_as_superuser();
select * from finish();
rollback;
