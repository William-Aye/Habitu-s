begin;
\ir helpers.inc
select plan(35);
select tests.create_user('resp@sc.fr', 'Rose') as resp \gset
select tests.create_user('org1@sc.fr', 'Oscar') as org1 \gset
select tests.create_user('inv@sc.fr', 'Ines') as inv \gset
select tests.create_user('plain@sc.fr', 'Paul') as plain \gset
select tests.create_user('blk@sc.fr', 'Bob') as blk \gset
select tests.create_user('blkd@sc.fr', 'Bea') as blkd \gset
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
update profiles set photo_url = 'https://example.org/rose.jpg' where id = :'resp';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');

-- Superuser inserts: the guards only apply to API roles.
insert into collectifs (id, name, description, town_label, town_point, created_by) values
  ('00000000-0000-0000-0000-00000000c0a1', 'Les Joueurs de Go du Parc', 'Parties de jeu de go chaque semaine', 'Lyon',
   'POINT(4.8512 45.7689)', :'resp'),
  ('00000000-0000-0000-0000-00000000c0a2', 'Les Lecteurs du Dimanche', 'Lectures partagees', 'Lyon',
   'POINT(4.8512 45.7689)', :'resp');
insert into collectif_members (collectif_id, user_id, role, status) values
  ('00000000-0000-0000-0000-00000000c0a1', :'org1', 'organiser', 'active'),
  ('00000000-0000-0000-0000-00000000c0a1', :'inv', 'organiser', 'invited');
insert into associations (id, name, purpose, source, confidence, location) values
  ('00000000-0000-0000-0000-0000000000a1', 'Club de go de Lyon', 'Jeu de go', 'rna', 60, 'SRID=4326;POINT(4.84 45.76)');
-- Activities start far ahead, so only the sessions inserted below exist within two weeks.
insert into activities (id, organiser_id, category_id, title, description, place_label, place, recurrence_kind, start_date,
  start_time, organised_by_collectif_id) values
  ('00000000-0000-0000-0000-0000000000f1', :'resp', '00000000-0000-0000-0000-0000000000c1', 'Initiation au go', 'Pour debutants', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 100, '19:00', '00000000-0000-0000-0000-00000000c0a1'),
  ('00000000-0000-0000-0000-0000000000f2', :'resp', '00000000-0000-0000-0000-0000000000c1', 'Go du jeudi', 'Entre habitues', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 100, '19:00', '00000000-0000-0000-0000-00000000c0a1'),
  ('00000000-0000-0000-0000-0000000000f3', :'resp', '00000000-0000-0000-0000-0000000000c1', 'Go du lundi', 'Plus tard', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 100, '19:00', null),
  ('00000000-0000-0000-0000-0000000000f4', :'resp', '00000000-0000-0000-0000-0000000000c1', 'Go archive', 'Ancien', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 100, '19:00', '00000000-0000-0000-0000-00000000c0a1');
update activities set archived_at = now() where id = '00000000-0000-0000-0000-0000000000f4';
insert into sessions (activity_id, starts_at, is_discovery) values
  ('00000000-0000-0000-0000-0000000000f1', now() + interval '3 days', true),
  ('00000000-0000-0000-0000-0000000000f2', now() + interval '3 days', false),
  ('00000000-0000-0000-0000-0000000000f2', now() + interval '20 days', true),
  ('00000000-0000-0000-0000-0000000000f3', now() - interval '1 day', true),
  ('00000000-0000-0000-0000-0000000000f4', now() + interval '2 days', true);
insert into sessions (activity_id, starts_at, is_discovery, status) values
  ('00000000-0000-0000-0000-0000000000f3', now() + interval '4 days', true, 'cancelled_by_organiser');

-- structure
select has_column('public', 'collectifs', 'embedding', 'collectifs.embedding');
select has_column('public', 'collectifs', 'embedding_hash', 'collectifs.embedding_hash');
select has_column('public', 'collectifs', 'search_tsv', 'collectifs.search_tsv');
select has_column('public', 'activities', 'embedding_hash', 'activities.embedding_hash');
select is(has_function_privilege('anon', 'public.get_collectif(uuid)', 'execute'), true, 'anon may read a collectif page');

-- keyword search finds the collectif, at town level
select tests.act_as_anon();
select is((select r->>'kind' from jsonb_array_elements(public.search_explore(4.85, 45.77, 10, 'jeu de go')->'results') r
            where r->>'id' = '00000000-0000-0000-0000-00000000c0a1'), 'collectif', 'collectif returned for "jeu de go"');
select is((select r->>'title' from jsonb_array_elements(public.search_explore(4.85, 45.77, 10, 'jeu de go')->'results') r
            where r->>'kind' = 'collectif'), 'Les Joueurs de Go du Parc', 'with its name');
select is((select (r->>'lon')::float8 from jsonb_array_elements(public.search_explore(4.85, 45.77, 10, 'jeu de go')->'results') r
            where r->>'kind' = 'collectif'), 4.85::float8, 'position is the snapped town centre');
select is((select count(*)::int from jsonb_array_elements(public.search_explore(4.85, 45.77, 10, 'jeu de go')->'results') r
            where r->>'id' = '00000000-0000-0000-0000-00000000c0a2'), 0, 'an unrelated collectif is not returned');
select is((select count(*)::int from jsonb_array_elements(public.search_explore(4.85, 45.77, 10, 'jeu de go', null, '{activity}')->'results') r
            where r->>'kind' = 'collectif'), 0, 'not returned when only activities are requested');
select is((select count(*)::int from jsonb_array_elements(public.search_explore(4.85, 45.77, 10, 'jeu de go', null, '{association}')->'results') r
            where r->>'kind' = 'collectif'), 1, 'returned when associations are requested');
select is((select count(*)::int from jsonb_array_elements(public.search_explore(4.85, 45.77, 5, null)->'results') r
            where r->>'kind' = 'collectif'), 2, 'browse lists both collectifs');
select is((select count(*)::int from jsonb_array_elements(public.search_explore(2.35, 48.85, 10, 'jeu de go')->'results') r
            where r->>'kind' = 'collectif'), 0, 'far away: not returned');
select is((select r->>'source_label' from jsonb_array_elements(public.search_explore(4.85, 45.77, 10, 'jeu de go')->'results') r
            where r->>'kind' = 'collectif'), 'collectif', 'label collectif');

-- discovery sessions
select is((select array_agg(r->>'id' order by r->>'id')
             from jsonb_array_elements(public.search_explore(4.85, 45.77, 10, null, null, '{activity,association}', null, false,
                                                              '{}', 'best', 20, 0, true)->'results') r),
          array['00000000-0000-0000-0000-0000000000f1'], 'discovery only: just the activity with a discovery session in 14 days');
select is((select count(*)::int from jsonb_array_elements(public.search_explore(4.85, 45.77, 10, null)->'results') r
            where r->>'kind' = 'activity'), 3, 'without the filter: the 3 live activities');
select is((select count(*)::int from jsonb_array_elements(public.search_explore(4.85, 45.77, 10, 'go', null, '{activity,association}', null, false,
                                                              '{}', 'best', 20, 0, true)->'results') r
            where r->>'kind' <> 'activity'), 0, 'discovery only with a query: no associations or collectifs');

-- the collectif page
select is(public.get_collectif('00000000-0000-0000-0000-0000000000ff'), null, 'unknown collectif: null');
select is((select jsonb_array_length(public.get_collectif('00000000-0000-0000-0000-00000000c0a1')->'organisers')), 2,
          'active organisers only (the invited one is left out)');
select is((select array_agg(o->>'first_name' order by o->>'first_name') from jsonb_array_elements(public.get_collectif('00000000-0000-0000-0000-00000000c0a1')->'organisers') o),
          array['Oscar', 'Rose'], 'first names');
select is((select o from jsonb_array_elements(public.get_collectif('00000000-0000-0000-0000-00000000c0a1')->'organisers') o where o->>'first_name' = 'Rose'),
          '{"first_name":"Rose","photo_url":"https://example.org/rose.jpg","role":"responsable"}'::jsonb, 'only first name, photo and role');
select is((select jsonb_array_length(public.get_collectif('00000000-0000-0000-0000-00000000c0a1')->'activities')), 2,
          'non-archived activities only');
select tests.act_as(:'org1');
select is((public.get_collectif('00000000-0000-0000-0000-00000000c0a1')->>'my_role'), 'organiser', 'my_role for an organiser');

-- my_role is null for anon, non-members and invited-only users
select tests.act_as_anon();
select is((public.get_collectif('00000000-0000-0000-0000-00000000c0a1')->>'my_role'), null, 'anon has no role');
select tests.act_as(:'plain');
select is((public.get_collectif('00000000-0000-0000-0000-00000000c0a1')->>'my_role'), null, 'non-member has no role');
select tests.act_as(:'inv');
select is((public.get_collectif('00000000-0000-0000-0000-00000000c0a1')->>'my_role'), null, 'invited-only has no role');

-- blocks: any active member blocked with the caller hides the collectif (both directions)
select tests.act_as_superuser();
insert into blocks (blocker_id, blocked_id) values (:'blk', :'org1'), (:'org1', :'blkd');
select tests.act_as(:'blk');
select is((select count(*)::int from jsonb_array_elements(public.search_explore(4.85, 45.77, 10, 'jeu de go')->'results') r
            where r->>'kind' = 'collectif'), 0, 'search: hidden from someone who blocked an organiser');
select is(public.get_collectif('00000000-0000-0000-0000-00000000c0a1'), null, 'page: null for someone who blocked an organiser');
select tests.act_as(:'blkd');
select is((select count(*)::int from jsonb_array_elements(public.search_explore(4.85, 45.77, 10, 'jeu de go')->'results') r
            where r->>'kind' = 'collectif'), 0, 'search: hidden from someone an organiser blocked');
select is(public.get_collectif('00000000-0000-0000-0000-00000000c0a1'), null, 'page: null for someone an organiser blocked');
select tests.act_as(:'plain');
select is((select count(*)::int from jsonb_array_elements(public.search_explore(4.85, 45.77, 10, 'jeu de go')->'results') r
            where r->>'kind' = 'collectif'), 1, 'search: still visible to everyone else');

-- ranking forgery: embedding and hash cannot be written through the API
select tests.act_as_superuser();
update activities set embedding_hash = 'real' where id = '00000000-0000-0000-0000-0000000000f1';
select tests.act_as(:'resp');
update activities set embedding = array_fill(0.1::float8, array[384])::extensions.vector, embedding_hash = 'forged'
 where id = '00000000-0000-0000-0000-0000000000f1';
select tests.act_as_superuser();
select is((select (embedding is null, embedding_hash) from activities where id = '00000000-0000-0000-0000-0000000000f1'),
          (true, 'real'::text), 'activity update: embedding and hash unchanged');
select tests.act_as(:'org1');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time,
  embedding, embedding_hash) values
  ('00000000-0000-0000-0000-0000000000f9', :'org1', '00000000-0000-0000-0000-0000000000c1', 'Go forge', 'Cafe',
   'POINT(4.85 45.77)', 'weekly', current_date + 100, '19:00', array_fill(0.1::float8, array[384])::extensions.vector, 'forged');
insert into collectifs (id, name, town_label, town_point, created_by, embedding, embedding_hash) values
  ('00000000-0000-0000-0000-00000000c0f9', 'Collectif forge', 'Lyon', 'POINT(4.85 45.77)', :'org1',
   array_fill(0.1::float8, array[384])::extensions.vector, 'forged');
select tests.act_as_superuser();
select is((select (embedding is null, embedding_hash is null) from activities where id = '00000000-0000-0000-0000-0000000000f9'),
          (true, true), 'activity insert: embedding and hash dropped');
select is((select (embedding is null, embedding_hash is null) from collectifs where id = '00000000-0000-0000-0000-00000000c0f9'),
          (true, true), 'collectif insert: embedding and hash dropped');
select tests.act_as(:'resp');
select throws_ok($$ update collectifs set embedding_hash = 'forged' where id = '00000000-0000-0000-0000-00000000c0a1' $$,
  '42501', null, 'collectif update of the hash is refused');

select * from finish();
rollback;
