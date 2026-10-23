begin;
\ir helpers.inc
select plan(133);
select has_schema('importer');
select has_table('public', 'import_runs', 'import_runs exists');
select has_column('public', 'associations', 'embedding_hash', 'associations.embedding_hash');
select is(importer.normalise_name('Association Le Club de Go d''Évry !'), 'go evry', 'normalise_name strips filler words and accents');
select is(importer.normalise_name('CLUB D''ÉCHECS DE LYON'), 'echecs lyon', 'normalise_name handles d'' apostrophe and case');
select is(importer.normalise_name('  Amicale  des   Boulistes '), 'boulistes', 'normalise_name collapses spaces');
select is(importer.normalise_name('Club N°1 Gym'), 'n 1 gym', 'normalise_name parity: n 1 gym');
select is(importer.normalise_name('Les Cœurs Vaillants'), 'coeurs vaillants', 'normalise_name parity: coeurs vaillants');
select is(importer.normalise_name(E'L’Atelier d’Écriture'), 'atelier ecriture', 'normalise_name parity: atelier ecriture');
select is(importer.normalise_name('Saint-Étienne Basket'), 'saint etienne basket', 'normalise_name parity: saint etienne basket');
select is(importer.normalise_name('Ærø Straße Łódź Đ €1'), 'aero strasse lodz 1', 'normalise_name parity: aero strasse lodz 1');
select is(importer.normalise_name('Club ½'), '1 2', 'normalise_name parity: Club ½');
select is(importer.normalise_name('Salle n²'), 'salle n', 'normalise_name parity: Salle n²');
select is(importer.normalise_name('Gym™'), 'gym', 'normalise_name parity: Gym™');
select is(importer.normalise_name('Fit ﬁt'), 'fit fit', 'normalise_name parity: Fit ﬁt');
select is(importer.normalise_name('ＡＢＣ club'), 'abc', 'normalise_name parity: ＡＢＣ club');
select is(importer.confidence(current_date - 365, true, true, true, current_date), 100::smallint, 'max confidence');
select ok(importer.same_point('SRID=4326;POINT(4.8229999999999995 45.761)', 'SRID=4326;POINT(4.823 45.761)'),
  'same_point: a last-bit difference is the same point');
select ok(not importer.same_point('SRID=4326;POINT(4.822 45.761)', 'SRID=4326;POINT(4.8221 45.761)')
          and not importer.same_point(null, 'SRID=4326;POINT(4.822 45.761)') and importer.same_point(null, null),
  'same_point: 1e-4 degree apart or one side null is a change');
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
select tests.act_as_admin(:'u');
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
  '{"inserted":4,"updated":1,"osm_matched":2,"osm_only":1,"community_merged":1,"removed":1,"kept_dissolved":2,
    "osm_unlinked":0,"downgraded_to_osm":0,"osm_removal_skipped":false}'::jsonb,
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
-- ---------------------------------------------------------------------------------------------
-- Run 2, scope {'38'} (Isère): pairing ties, competing RNA rows, locked location, osm_id holder
-- conflicts (fold / release / cancel), stale OSM links, RNA dissolved but OSM still mapped.
insert into import_runs (scope) values (array['38']) returning id as run2 \gset
insert into pg_temp.pts values
  ('gre', 'SRID=4326;POINT(5.724 45.188)'),      -- Grenoble centre
  ('echi', 'SRID=4326;POINT(5.716 45.146)'),     -- Échirolles
  ('smh', 'SRID=4326;POINT(5.765 45.167)'),      -- Saint-Martin-d'Hères
  ('meylan', 'SRID=4326;POINT(5.780 45.210)'),   -- Meylan
  ('voiron', 'SRID=4326;POINT(5.590 45.364)'),   -- Voiron
  ('vienne', 'SRID=4326;POINT(4.874 45.525)'),   -- Vienne
  ('pontch', 'SRID=4326;POINT(6.015 45.433)'),   -- Pontcharra (Isère, next to Savoie)
  ('bourgoin', 'SRID=4326;POINT(5.274 45.586)'), -- Bourgoin-Jallieu
  ('fontaine', 'SRID=4326;POINT(5.668 45.193)'); -- Fontaine

insert into associations (rna_id, osm_id, name, insee_code, location, geocode_precision, website,
                          rna_published_on, source, locked_fields, attribution, confidence)
values
  -- locked location, will be matched to an OSM feature 100 m away
  ('W381000004', null, 'Chorale de Saint-Martin-d''Hères', '38421', pg_temp.pt('smh'), 'address', null,
   null, 'rna', '{location}', '{"rna": "Licence Ouverte / Etalab 2.0"}', 40),
  -- fold: OSM-only listing, claimed, with an activity and a claim
  (null, 'node/3805', 'Atelier vélo de Meylan', '38229', pg_temp.pt('meylan'), 'osm', null,
   null, 'osm', '{}', '{"osm": "© OpenStreetMap contributors, ODbL 1.0"}', 45),
  -- release: RNA record gone, its OSM feature now matches a new RNA registration
  ('W381999001', 'node/3806', 'Club photo de Voiron', '38563', pg_temp.pt('voiron'), 'osm', null,
   current_date - 3000, 'rna+osm', '{}',
   '{"rna": "Licence Ouverte / Etalab 2.0", "osm": "© OpenStreetMap contributors, ODbL 1.0"}', 45),
  -- cancel (conflicting claims): OSM-only listing claimed by Claire ...
  (null, 'node/3807', 'Club de judo de Vienne', '38544', pg_temp.pt('vienne'), 'osm', null,
   null, 'osm', '{}', '{"osm": "© OpenStreetMap contributors, ODbL 1.0"}', 45),
  -- ... and the RNA listing claimed by Omar
  ('W381000007', null, 'Judo Club Vienne', '38544', pg_temp.pt('vienne', 100), 'address', null,
   null, 'rna', '{}', '{"rna": "Licence Ouverte / Etalab 2.0"}', 40),
  -- cancel (out of scope): OSM-only listing in Savoie holding the feature id
  (null, 'node/3808', 'Club Alpin Pontcharra', '73215', pg_temp.pt('pontch', 2000), 'osm', null,
   null, 'osm', '{}', '{"osm": "© OpenStreetMap contributors, ODbL 1.0"}', 45),
  -- stale link: the OSM feature is no longer mapped
  ('W381000009', 'node/3899', 'Harmonie de Bourgoin', '38053', pg_temp.pt('bourgoin'), 'osm', null,
   current_date - 400, 'rna+osm', '{}',
   '{"rna": "Licence Ouverte / Etalab 2.0", "osm": "© OpenStreetMap contributors, ODbL 1.0"}', 65),
  -- RNA record gone, OSM feature still mapped
  ('W381999002', 'node/3810', 'Fablab de Fontaine', '38169', pg_temp.pt('fontaine'), 'osm',
   'https://fablab-fontaine.example', current_date - 400, 'rna+osm', '{}',
   '{"rna": "Licence Ouverte / Etalab 2.0", "osm": "© OpenStreetMap contributors, ODbL 1.0"}', 85);
update associations set claimed_by = :'claimant', verified = true where osm_id in ('node/3805', 'node/3807');
update associations set claimed_by = :'claimant' where rna_id = 'W381999001';
update associations set claimed_by = :'organiser' where rna_id = 'W381000007';
insert into association_claims (association_id, claimant_id, proof_method, status)
select id, :'claimant', 'document', 'approved' from associations where osm_id = 'node/3805';
insert into activities (organiser_id, organised_by_association_id, category_id, title, place_label, place,
                        recurrence_kind, start_date, start_time)
select :'organiser', id, (select id from categories where slug = 'games'), 'Réparation vélo', 'Meylan',
       pg_temp.pt('meylan'), 'weekly', current_date, '18:30'
from associations where osm_id = 'node/3805';

insert into importer.staged_rna (run_id, rna_id, name, insee_code, location, geocode_precision,
                                 website, published_on, likely_not_public, embedding_hash)
values
  (:'run2', 'W381000001', 'Cercle d''échecs de Grenoble', '38185', pg_temp.pt('gre'), 'address',
   null, current_date - 100, false, 'g1'),
  (:'run2', 'W381000002', 'Tennis de Table Échirolles', '38151', pg_temp.pt('echi'), 'address',
   null, current_date - 100, false, 'g2'),
  (:'run2', 'W381000003', 'Tennis de Table Échirolles Jeunes', '38151', pg_temp.pt('echi', 250, 0), 'address',
   null, current_date - 100, false, 'g3'),
  (:'run2', 'W381000004', 'Chorale de Saint-Martin-d''Hères', '38421', pg_temp.pt('smh', 30), 'address',
   null, current_date - 100, false, 'g4'),
  (:'run2', 'W381000005', 'Atelier Vélo Meylan', '38229', pg_temp.pt('meylan', 100), 'address',
   null, current_date - 100, false, 'g5'),
  (:'run2', 'W381000006', 'Club Photo Voiron', '38563', pg_temp.pt('voiron', 100), 'address',
   null, current_date - 100, false, 'g6'),
  (:'run2', 'W381000007', 'Judo Club Vienne', '38544', pg_temp.pt('vienne', 100), 'address',
   null, current_date - 100, false, 'g7'),
  (:'run2', 'W381000008', 'Club alpin de Pontcharra', '38314', pg_temp.pt('pontch'), 'address',
   null, current_date - 100, false, 'g8'),
  (:'run2', 'W381000009', 'Harmonie de Bourgoin', '38053', pg_temp.pt('bourgoin'), 'address',
   null, current_date - 100, false, 'g9');
insert into importer.staged_osm (run_id, osm_id, name, location, website, embedding_hash)
values
  (:'run2', 'node/3801', 'Cercle d''Échecs de Grenoble', pg_temp.pt('gre', 50), null, 'p1'),
  (:'run2', 'node/3802', 'Cercle échecs Grenoble', pg_temp.pt('gre', 250, 180), null, 'p2'),
  (:'run2', 'node/3803', 'Tennis de table Échirolles', pg_temp.pt('echi', 200, 0), null, 'p3'),
  (:'run2', 'node/3804', 'Chorale de Saint-Martin-d''Hères', pg_temp.pt('smh', 130), null, 'p4'),
  (:'run2', 'node/3805', 'Atelier vélo de Meylan', pg_temp.pt('meylan'), null, 'p5'),
  (:'run2', 'node/3806', 'Club photo de Voiron', pg_temp.pt('voiron'), null, 'p6'),
  (:'run2', 'node/3807', 'Club de judo de Vienne', pg_temp.pt('vienne'), null, 'p7'),
  (:'run2', 'node/3808', 'Club Alpin Pontcharra', pg_temp.pt('pontch', 100), null, 'p8'),
  (:'run2', 'node/3810', 'Fablab de Fontaine', pg_temp.pt('fontaine'), 'https://fablab-fontaine.example', 'p10');

select importer.apply_run(:'run2', array['38']) as counts2 \gset

-- Equal normalised names: distance decides.
select is((select osm_id from associations where rna_id = 'W381000001'), 'node/3801',
  'equal names: the 50 m OSM candidate wins');
select is((select source from associations where osm_id = 'node/3802'), 'osm',
  'equal names: the 250 m candidate becomes an OSM-only row');
-- Two RNA rows competing for one OSM feature: higher similarity wins even when farther (200 m vs 50 m).
select is((select osm_id from associations where rna_id = 'W381000002'), 'node/3803',
  'competing RNA rows: the better name match gets the OSM feature');
select ok((select osm_id is null and source = 'rna' from associations where rna_id = 'W381000003'),
  'competing RNA rows: the other one stays RNA-only');
-- Locked location on the OSM match path.
select is((select osm_id from associations where rna_id = 'W381000004'), 'node/3804', 'locked-location row still matched');
select ok((select extensions.st_distance(location, pg_temp.pt('smh')) < 1 and geocode_precision = 'address'
           from associations where rna_id = 'W381000004'), 'locked location not replaced by the OSM point');
-- Holder conflict, fold path.
select ok((select osm_id = 'node/3805' and source = 'rna+osm' and claimed_by = :'claimant'::uuid and verified
           from associations where rna_id = 'W381000005'), 'fold: RNA row takes the feature and the claim');
select is((select organised_by_association_id from activities where title = 'Réparation vélo'),
  (select id from associations where rna_id = 'W381000005'), 'fold: activity repointed');
select is((select count(*) from association_claims c join associations a on a.id = c.association_id
           where a.rna_id = 'W381000005')::int, 1, 'fold: claim repointed');
select is((select count(*) from associations where name = 'Atelier vélo de Meylan')::int, 0,
  'fold: OSM-only row deleted');
-- Holder conflict, release path.
select is((select osm_id from associations where rna_id = 'W381000006'), 'node/3806', 'release: new RNA row takes the feature');
select ok((select osm_id is null and source = 'rna' and not attribution ? 'osm' and confidence = 0
           from associations where rna_id = 'W381999001'),
  'release: dissolved holder loses osm_id and osm attribution, kept at 0 (claimed)');
-- Holder conflict, cancel paths.
select ok((select osm_id is null and source = 'rna' from associations where rna_id = 'W381000007'),
  'cancel (claims differ): RNA row not linked');
select ok((select claimed_by = :'claimant'::uuid and source = 'osm' from associations where osm_id = 'node/3807'),
  'cancel (claims differ): OSM-only row kept with its claim');
select ok((select osm_id is null and source = 'rna' from associations where rna_id = 'W381000008'),
  'cancel (holder out of scope): RNA row not linked');
select ok((select last_import_run is null and insee_code = '73215' and confidence = 45
           from associations where osm_id = 'node/3808'), 'cancel (holder out of scope): holder untouched');
-- Stale OSM link.
select ok((select osm_id is null and source = 'rna' and not attribution ? 'osm' and attribution ? 'rna'
           from associations where rna_id = 'W381000009'), 'stale link: osm_id and osm attribution removed');
select is((select confidence from associations where rna_id = 'W381000009'), 40::smallint,
  'stale link: confidence recomputed without OSM');
-- RNA dissolved, OSM still mapped.
select ok((select source = 'osm' and rna_id is null and rna_published_on is null
                  and attribution ? 'osm' and not attribution ? 'rna'
           from associations where osm_id = 'node/3810'), 'RNA gone, OSM mapped: downgraded to an OSM listing');
select is((select confidence from associations where osm_id = 'node/3810'), 65::smallint,
  'downgraded listing confidence recomputed (website + OSM)');
select ok((:'counts2'::jsonb)->>'osm_unlinked' = '1' and (:'counts2'::jsonb)->>'downgraded_to_osm' = '1'
          and (:'counts2'::jsonb)->>'osm_removal_skipped' = 'false', 'run 2 counts');

-- ---------------------------------------------------------------------------------------------
-- Run 3, scope {'13'}: RNA staged, no OSM staged -> OSM-only listings must survive.
insert into import_runs (scope) values (array['13']) returning id as run3 \gset
insert into associations (osm_id, name, insee_code, location, geocode_precision, source, attribution, confidence)
values ('node/1301', 'Club de pétanque du Vieux-Port', '13201', 'SRID=4326;POINT(5.370 43.295)', 'osm', 'osm',
        '{"osm": "© OpenStreetMap contributors, ODbL 1.0"}', 45);
insert into importer.staged_rna (run_id, rna_id, name, insee_code, location, geocode_precision,
                                 published_on, likely_not_public, embedding_hash)
values (:'run3', 'W131000001', 'Chorale du Panier', '13202', 'SRID=4326;POINT(5.366 43.299)', 'address',
        current_date - 100, false, 'm1');
select importer.apply_run(:'run3', array['13']) as counts3 \gset
select is((select count(*) from associations where osm_id = 'node/1301')::int, 1,
  'no OSM staged: OSM-only listing survives');
select ok((:'counts3'::jsonb)->>'osm_removal_skipped' = 'true' and (:'counts3'::jsonb)->>'removed' = '0',
  'no OSM staged: removal skipped and counted');

-- ---------------------------------------------------------------------------------------------
-- Scope guards: each must raise and leave everything unchanged.
insert into import_runs (scope) values (array['69', '75']) returning id as run4 \gset
insert into importer.staged_rna (run_id, rna_id, name, insee_code, location, geocode_precision,
                                 published_on, likely_not_public, embedding_hash)
values (:'run4', 'W691000012', 'Les Amis du Jardin Partagé', '69388', pg_temp.pt('jardin'), 'municipality',
        current_date - 100, false, 'h12');
select count(*) as before4 from associations \gset
select throws_like(format('select importer.apply_run(%L, array[''69'', ''75''])', :'run4'),
  '%no staged RNA rows for département 75%', 'a département of the scope without staged RNA aborts the run');
select ok((select count(*) from associations) = :before4
          and (select last_import_run from associations where rna_id = 'W691000012') = :'run'::uuid
          and (select status from import_runs where id = :'run4') = 'running'
          and (select count(*) from associations where rna_id = 'W751000001') = 1,
  'aborted run changed nothing (Paris listing absent from staging still there)');
insert into import_runs (scope) values ('{}') returning id as run5 \gset
select throws_like(format('select importer.apply_run(%L, ''{}''::text[])', :'run5'),
  '%empty scope%', 'empty scope array aborts the run');

-- ---------------------------------------------------------------------------------------------
-- Run 6, scope null (all of France): everything absent from staging is in scope.
insert into import_runs (scope) values (null) returning id as run6 \gset
insert into importer.staged_rna (run_id, rna_id, name, insee_code, location, geocode_precision,
                                 published_on, likely_not_public, embedding_hash)
values (:'run6', 'W331000001', 'Club de Go de Bordeaux', '33063', 'SRID=4326;POINT(-0.580 44.840)', 'address',
        current_date - 100, false, 'b1');
insert into importer.staged_osm (run_id, osm_id, name, location, embedding_hash)
values (:'run6', 'node/3301', 'Fablab de Bordeaux', 'SRID=4326;POINT(-0.570 44.850)', 'b2');
select importer.apply_run(:'run6', null) as counts6 \gset
select ok((select source = 'rna' and last_import_run = :'run6'::uuid from associations where rna_id = 'W331000001'),
  'null scope: RNA row inserted');
select is((select insee_code from associations where osm_id = 'node/3301'), '33063',
  'null scope: OSM-only row inserted and placed');
select is((select count(*) from associations
           where rna_id in ('W691000012', 'W751000001', 'W131000001') or osm_id in ('way/1003', 'node/1301'))::int, 0,
  'null scope: unclaimed listings of every département absent from staging are removed');
select is((select confidence from associations where rna_id = 'W691000003'), 0::smallint,
  'null scope: claimed listing absent from staging kept at 0');
-- ---------------------------------------------------------------------------------------------
-- Run 7, scope {'33'}: a staged RNA row without a location (geocoding failed) keeps the
-- listing's existing location and precision.
insert into import_runs (scope) values (array['33']) returning id as run7 \gset
insert into importer.staged_rna (run_id, rna_id, name, insee_code, location, geocode_precision,
                                 published_on, likely_not_public, embedding_hash)
values (:'run7', 'W331000001', 'Club de Go de Bordeaux', '33063', null, null, current_date - 100, false, 'b1'),
       (:'run7', 'W331000002', 'Chorale de Bordeaux', '33063', null, null, current_date - 100, false, 'b3');
select importer.apply_run(:'run7', array['33']) as counts7 \gset
select ok((select extensions.st_equals(location::extensions.geometry, 'SRID=4326;POINT(-0.580 44.840)'::extensions.geometry)
           from associations where rna_id = 'W331000001'),
  'null staged location: existing location kept');
select is((select geocode_precision from associations where rna_id = 'W331000001'), 'address',
  'null staged location: existing geocode_precision kept');
select ok((select location is null and geocode_precision is null from associations where rna_id = 'W331000002'),
  'null staged location: new listing inserted without a location');
-- ---------------------------------------------------------------------------------------------
-- Runs 8 and 9, scope {'44'}: town stored, OSM likely_not_public staged, and a second identical
-- run rewrites no association row and no tag row (same tuple ctid before and after).
insert into import_runs (scope) values (array['44']) returning id as run8 \gset
create temp table stage44_rna as
select * from (values
  ('W441000001', 'Club de Go de Nantes', 'Jeu de go', '3 rue Kervégan', '44000', 'Nantes', '44109',
   'SRID=4326;POINT(-1.553 47.213)'::extensions.geography, 'address', null::text, current_date - 100,
   '{games-go}'::text[], 'n1'),
  ('W441000002', 'Chorale de Nantes', 'Chant', '8 quai de la Fosse', '44000', 'Nantes', '44109',
   'SRID=4326;POINT(-1.565 47.210)'::extensions.geography, 'address', 'https://chorale-nantes.example',
   current_date - 100, '{music-chorale}'::text[], 'n2')
) v(rna_id, name, purpose, address, postcode, city, insee_code, location, geocode_precision, website,
    published_on, tag_slugs, embedding_hash);
create temp table stage44_osm as
select * from (values
  ('node/4401', 'Go Club Nantes', 'SRID=4326;POINT(-1.5535 47.2132)'::extensions.geography, '+33 2 40 00 00 01',
   'https://go-club-nantes.example', false, '{games}'::text[], 'q1'),
  ('node/4402', 'Salle de sport de la Résidence', 'SRID=4326;POINT(-1.540 47.220)'::extensions.geography, null,
   null, true, '{sport}'::text[], 'q2')
) v(osm_id, name, location, phone, website, likely_not_public, tag_slugs, embedding_hash);
create function pg_temp.stage44(p_run uuid) returns void language sql as $$
  insert into importer.staged_rna (run_id, rna_id, name, purpose, address, postcode, city, insee_code, location,
                                   geocode_precision, website, published_on, likely_not_public, tag_slugs,
                                   embedding_hash)
  select p_run, rna_id, name, purpose, address, postcode, city, insee_code, location, geocode_precision, website,
         published_on, false, tag_slugs, embedding_hash
  from pg_temp.stage44_rna;
  insert into importer.staged_osm (run_id, osm_id, name, location, phone, website, likely_not_public, tag_slugs,
                                   embedding_hash)
  select p_run, osm_id, name, location, phone, website, likely_not_public, tag_slugs, embedding_hash
  from pg_temp.stage44_osm;
$$;
select pg_temp.stage44(:'run8');
select importer.apply_run(:'run8', array['44']) as counts8 \gset
select ok((select city = 'Nantes' and postcode = '44000' from associations where rna_id = 'W441000002'),
  'town (city, postcode) stored from RNA');
select ok((select source = 'rna+osm' and website = 'https://go-club-nantes.example' and geocode_precision = 'osm'
           from associations where rna_id = 'W441000001'), 'run 8: RNA row matched, website and location from OSM');
select ok((select likely_not_public and source = 'osm' from associations where osm_id = 'node/4402'),
  'OSM-only listing carries likely_not_public from staging');

create temp table snap44 as
select id, ctid::text as c from associations where insee_code = '44109';
create temp table snaptags44 as
select t.association_id, t.tag_id, t.ctid::text as c
from association_tags t join associations a on a.id = t.association_id where a.insee_code = '44109';
insert into import_runs (scope) values (array['44']) returning id as run9 \gset
select pg_temp.stage44(:'run9');
select importer.apply_run(:'run9', array['44']) as counts9 \gset
select is((select array_agg(a.ctid::text order by a.id) from associations a where a.insee_code = '44109'),
          (select array_agg(c order by id) from snap44),
  'second identical run rewrites no association row');
select is((select array_agg(t.ctid::text order by t.association_id, t.tag_id)
           from association_tags t join associations a on a.id = t.association_id where a.insee_code = '44109'),
          (select array_agg(c order by association_id, tag_id) from snaptags44),
  'second identical run rewrites no tag row');
select is((select count(*) from snaptags44)::int, 4, 'tags of the run-8 rows present (2 + 1 + 1)');
select ok((:'counts9'::jsonb)->>'inserted' = '0' and (:'counts9'::jsonb)->>'updated' = '0'
          and (:'counts9'::jsonb)->>'osm_matched' = '1' and (:'counts9'::jsonb)->>'osm_only' = '1',
  'second identical run: nothing inserted or updated, match and OSM-only still counted');
select is((select confidence from associations where rna_id = 'W441000001'), 85::smallint,
  'confidence of an unchanged row still right');

-- Tag diff: one slug removed, one added; the kept tag row is not rewritten.
insert into import_runs (scope) values (array['44']) returning id as run9b \gset
update pg_temp.stage44_rna set tag_slugs = '{music}' where rna_id = 'W441000002';
update pg_temp.stage44_rna set tag_slugs = '{}' where rna_id = 'W441000001';
select pg_temp.stage44(:'run9b');
select importer.apply_run(:'run9b', array['44']) as counts9b \gset
select is((select array_agg(t.slug order by t.slug) from association_tags at join tags t on t.id = at.tag_id
           join associations a on a.id = at.association_id where a.rna_id = 'W441000002'),
  array['music'], 'tag diff: removed slug deleted, new slug inserted');
select is((select at.ctid::text from association_tags at join tags t on t.id = at.tag_id
           join associations a on a.id = at.association_id where a.rna_id = 'W441000001' and t.slug = 'games'),
          (select s.c from snaptags44 s join tags t on t.id = s.tag_id
           join associations a on a.id = s.association_id where a.rna_id = 'W441000001' and t.slug = 'games'),
  'tag diff: a tag still staged keeps its row');

-- Claimant edits lock the edited columns; the next import keeps the claimant's values.
update associations set claimed_by = :'claimant' where rna_id = 'W441000002';
select tests.act_as(:'claimant');
update associations set website = 'https://claire-chorale.example', purpose = 'Chant choral'
where rna_id = 'W441000002';
update associations set purpose = 'Chant choral a cappella', phone = '+33 2 40 00 00 02'
where rna_id = 'W441000002';
select tests.act_as_superuser();
select is((select locked_fields from associations where rna_id = 'W441000002'),
  array['purpose', 'website', 'phone'], 'claimant edits add the edited columns to locked_fields, once each');
update profiles set role = 'admin' where id = :'organiser';
select tests.act_as_admin(:'organiser');
update associations set opening_hours = 'Mo 18:00-20:00' where rna_id = 'W441000002';
select tests.act_as_superuser();
select ok((select not 'opening_hours' = any(locked_fields) from associations where rna_id = 'W441000002'),
  'admin edits do not lock');
insert into import_runs (scope) values (array['44']) returning id as run10 \gset
update pg_temp.stage44_rna set website = 'https://autre-site.example', purpose = 'Autre objet'
where rna_id = 'W441000002';
select pg_temp.stage44(:'run10');
select importer.apply_run(:'run10', array['44']) as counts10 \gset
select ok((select website = 'https://claire-chorale.example' and purpose = 'Chant choral a cappella'
           from associations where rna_id = 'W441000002'), 'import keeps the claimant''s edited values');

-- ---------------------------------------------------------------------------------------------
-- Run 11, scope {'35'}: a municipality-level geocode does not replace an address-level one when
-- the address and commune are unchanged; it does when the address changed. Town locks follow
-- the address lock.
insert into import_runs (scope) values (array['35']) returning id as run11 \gset
insert into associations (rna_id, name, address, postcode, city, insee_code, location, geocode_precision, source,
                          locked_fields, confidence)
values
  ('W351000001', 'Cercle celtique de Rennes', '5 rue de Brest', '35000', 'Rennes', '35238',
   'SRID=4326;POINT(-1.690 48.112)', 'address', 'rna', '{}', 40),
  ('W351000002', 'Bagad de Rennes', '9 rue de Nantes', '35000', 'Rennes', '35238',
   'SRID=4326;POINT(-1.700 48.105)', 'address', 'rna', '{}', 40),
  ('W351000003', 'Rennes Échecs', '1 place de la Mairie', '35000', 'Rennes (ville)', '35238',
   'SRID=4326;POINT(-1.679 48.111)', 'address', 'rna', '{address}', 40);
insert into importer.staged_rna (run_id, rna_id, name, address, postcode, city, insee_code, location,
                                 geocode_precision, published_on, likely_not_public, embedding_hash)
values
  (:'run11', 'W351000001', 'Cercle celtique de Rennes', '5 rue de Brest', '35000', 'Rennes', '35238',
   'SRID=4326;POINT(-1.680 48.111)', 'municipality', current_date - 100, false, 'r1'),
  (:'run11', 'W351000002', 'Bagad de Rennes', '12 rue de Lorient', '35000', 'Rennes', '35238',
   'SRID=4326;POINT(-1.680 48.111)', 'municipality', current_date - 100, false, 'r2'),
  (:'run11', 'W351000003', 'Rennes Échecs', '2 place de la Mairie', '35700', 'Rennes', '35238',
   'SRID=4326;POINT(-1.680 48.111)', 'municipality', current_date - 100, false, 'r3');
select importer.apply_run(:'run11', array['35']) as counts11 \gset
select ok((select geocode_precision = 'address'
                  and extensions.st_equals(location::extensions.geometry, 'SRID=4326;POINT(-1.690 48.112)'::extensions.geometry)
           from associations where rna_id = 'W351000001'),
  'same address: municipality geocode does not replace the address-level location');
select ok((select geocode_precision = 'municipality' and address = '12 rue de Lorient'
           from associations where rna_id = 'W351000002'),
  'changed address: municipality geocode replaces the old location');
select ok((select address = '1 place de la Mairie' and postcode = '35000' and city = 'Rennes (ville)'
           from associations where rna_id = 'W351000003'), 'address lock also keeps postcode and city');

-- ---------------------------------------------------------------------------------------------
-- Run 12, scope null: a département with >= 50 live RNA listings and no staged RNA row aborts.
insert into associations (rna_id, name, insee_code, source, confidence)
select 'W01' || lpad(g::text, 7, '0'), 'Association de l''Ain ' || g, '01053', 'rna', 40
from generate_series(1, 50) g;
insert into import_runs (scope) values (null) returning id as run12 \gset
insert into importer.staged_rna (run_id, rna_id, name, insee_code, location, geocode_precision,
                                 published_on, likely_not_public, embedding_hash)
values (:'run12', 'W331000001', 'Club de Go de Bordeaux', '33063', null, null, current_date - 100, false, 'b1');
select throws_like(format('select importer.apply_run(%L, null)', :'run12'),
  '%no staged RNA rows for département 01%', 'null scope: a populated département missing from staging aborts');
update associations set confidence = 0 where rna_id like 'W01%' and rna_id <> 'W010000001';
select lives_ok(format('select importer.apply_run(%L, null)', :'run12'),
  'null scope: listings kept at confidence 0 do not count towards the guard');
-- ---------------------------------------------------------------------------------------------
-- Claimant guard: a claimant cannot write the import-owned columns, nor lock them.
select tests.act_as(:'claimant');
select throws_ok(format('update associations set %I = %s where rna_id = ''W441000002''', c, v), '42501', null,
  'claimant cannot set ' || c)
from (values ('insee_code', '''75056'''), ('postcode', '''75001'''), ('city', '''Paris'''),
             ('geocode_precision', '''municipality'''), ('embedding_hash', '''x'''),
             ('last_import_run', 'gen_random_uuid()'), ('rna_published_on', 'current_date')) v(c, v);
select throws_ok(format('update associations set locked_fields = locked_fields || %L::text[] where rna_id = ''W441000002''',
                        array[c]), '42501', null, 'claimant cannot lock ' || c)
from unnest(array['insee_code', 'postcode', 'city', 'geocode_precision', 'embedding_hash', 'last_import_run',
                  'rna_published_on']) c;
select throws_ok($$ insert into associations (name, source, created_by, insee_code) values ('X', 'community', auth.uid(), '75056') $$,
  '42501', null, 'non-admin cannot insert insee_code');
select tests.act_as_superuser();

-- ---------------------------------------------------------------------------------------------
-- Runs 13 and 14: an OSM feature is scoped by the INSEE code staged with it (the importer's
-- nearest commune), even when the nearest listing lies in another département.
insert into associations (rna_id, name, insee_code, location, source, confidence)
values ('W011000001', 'Club de Go du Pays de Gex', '01173', 'SRID=4326;POINT(6.100 46.200)', 'rna', 40);
insert into import_runs (scope) values (array['74']) returning id as run13 \gset
insert into importer.staged_rna (run_id, rna_id, name, insee_code, location, geocode_precision,
                                 published_on, likely_not_public, embedding_hash)
values (:'run13', 'W741000001', 'Chorale d''Annemasse', '74012', 'SRID=4326;POINT(6.235 46.193)', 'address',
        current_date - 100, false, 'a1');
insert into importer.staged_osm (run_id, osm_id, name, location, insee_code, embedding_hash)
values (:'run13', 'node/7401', 'Fablab du Genevois', 'SRID=4326;POINT(6.110 46.200)', '74010', 'a2');
select importer.apply_run(:'run13', array['74']) as counts13 \gset
select is((select insee_code from associations where osm_id = 'node/7401'), '74010',
  'staged OSM INSEE code kept (not replaced by the nearest listing''s)');
insert into import_runs (scope) values (array['01']) returning id as run14 \gset
insert into importer.staged_rna (run_id, rna_id, name, insee_code, location, geocode_precision,
                                 published_on, likely_not_public, embedding_hash)
values (:'run14', 'W011000001', 'Club de Go du Pays de Gex', '01173', 'SRID=4326;POINT(6.100 46.200)', 'address',
        current_date - 100, false, 'g1');
insert into importer.staged_osm (run_id, osm_id, name, location, insee_code, embedding_hash)
values (:'run14', 'node/0101', 'Club de tennis de Gex', 'SRID=4326;POINT(6.060 46.333)', '01173', 'g2');
select importer.apply_run(:'run14', array['01']) as counts14 \gset
select is((select count(*) from associations where osm_id = 'node/7401')::int, 1,
  'an 01 run does not remove the OSM listing placed in 74 by its staged code');

-- ---------------------------------------------------------------------------------------------
-- Runs 15 and 16, scope {'56'}: the website a listing took from its OSM feature goes as soon as
-- the feature is no longer staged.
insert into import_runs (scope) values (array['56']) returning id as run15 \gset
insert into importer.staged_rna (run_id, rna_id, name, insee_code, location, geocode_precision,
                                 published_on, likely_not_public, embedding_hash)
values (:'run15', 'W561000001', 'Club de Go de Vannes', '56260', 'SRID=4326;POINT(-2.760 47.658)', 'address',
        current_date - 100, false, 'v1');
insert into importer.staged_osm (run_id, osm_id, name, location, website, insee_code, embedding_hash)
values (:'run15', 'node/5601', 'Go Club Vannes', 'SRID=4326;POINT(-2.7601 47.6581)', 'https://go-vannes.example',
        '56260', 'v2');
select importer.apply_run(:'run15', array['56']) as counts15 \gset
select is((select website from associations where rna_id = 'W561000001'), 'https://go-vannes.example',
  'run 15: website taken from the matched OSM feature');
insert into import_runs (scope) values (array['56']) returning id as run16 \gset
insert into importer.staged_rna (run_id, rna_id, name, insee_code, location, geocode_precision,
                                 published_on, likely_not_public, embedding_hash)
values (:'run16', 'W561000001', 'Club de Go de Vannes', '56260', 'SRID=4326;POINT(-2.760 47.658)', 'address',
        current_date - 100, false, 'v1');
insert into importer.staged_osm (run_id, osm_id, name, location, insee_code, embedding_hash)
values (:'run16', 'node/5602', 'Salle de sport de Vannes', 'SRID=4326;POINT(-2.750 47.650)', '56260', 'v3');
select importer.apply_run(:'run16', array['56']) as counts16 \gset
select ok((select website is null and osm_id is null and confidence = 40 from associations where rna_id = 'W561000001'),
  'vanished OSM feature: its website is dropped in the same run');
-- Runs 17 and 18: relinked, then a run with no OSM staged at all keeps the link and its website.
insert into import_runs (scope) values (array['56']) returning id as run17 \gset
insert into importer.staged_rna (run_id, rna_id, name, insee_code, location, geocode_precision,
                                 published_on, likely_not_public, embedding_hash)
values (:'run17', 'W561000001', 'Club de Go de Vannes', '56260', 'SRID=4326;POINT(-2.760 47.658)', 'address',
        current_date - 100, false, 'v1');
insert into importer.staged_osm (run_id, osm_id, name, location, website, insee_code, embedding_hash)
values (:'run17', 'node/5601', 'Go Club Vannes', 'SRID=4326;POINT(-2.7601 47.6581)', 'https://go-vannes.example',
        '56260', 'v2');
select importer.apply_run(:'run17', array['56']) as counts17 \gset
insert into import_runs (scope) values (array['56']) returning id as run18 \gset
insert into importer.staged_rna (run_id, rna_id, name, insee_code, location, geocode_precision,
                                 published_on, likely_not_public, embedding_hash)
values (:'run18', 'W561000001', 'Club de Go de Vannes', '56260', 'SRID=4326;POINT(-2.760 47.658)', 'address',
        current_date - 100, false, 'v1');
select importer.apply_run(:'run18', array['56']) as counts18 \gset
select ok((select website = 'https://go-vannes.example' and osm_id = 'node/5601' and confidence = 85
           from associations where rna_id = 'W561000001'),
  'no OSM staged: the linked listing keeps its OSM website');
select * from finish();
rollback;
