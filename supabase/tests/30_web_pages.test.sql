begin;
\ir helpers.inc
select plan(29);
select tests.create_user('org@wp.fr', 'Orga') as org \gset
select tests.create_user('ban@wp.fr', 'Banni') as ban \gset
update profiles set age_confirmed = true;
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
insert into associations (id, name, purpose, source, confidence, location, city, website) values
  ('00000000-0000-0000-0000-0000000000a1', 'Club normal', 'Go', 'rna', 60, 'SRID=4326;POINT(4.84 45.76)', 'Lyon', 'https://club.example'),
  ('00000000-0000-0000-0000-0000000000a2', 'Club cache', 'Go', 'rna', 10, 'SRID=4326;POINT(4.84 45.76)', 'Lyon', 'https://club.example'),
  ('00000000-0000-0000-0000-0000000000a3', 'Club dormant', 'Go', 'rna', 60, 'SRID=4326;POINT(4.84 45.76)', 'Lyon', null),
  ('00000000-0000-0000-0000-0000000000a4', 'Club retire', 'Go', 'rna', 60, 'SRID=4326;POINT(4.84 45.76)', 'Lyon', 'https://club.example'),
  ('00000000-0000-0000-0000-0000000000a5', 'Club second', 'Go', 'rna', 60, 'SRID=4326;POINT(4.84 45.76)', 'Paris', 'https://club.example');
update associations set removed_at = now() where id = '00000000-0000-0000-0000-0000000000a4';
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000f1', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go normal', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 10, '19:00'),
  ('00000000-0000-0000-0000-0000000000f2', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go archive', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 10, '19:00'),
  ('00000000-0000-0000-0000-0000000000f3', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go modere', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 10, '19:00'),
  ('00000000-0000-0000-0000-0000000000f4', :'ban', '00000000-0000-0000-0000-0000000000c1', 'Go du banni', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 10, '19:00'),
  ('00000000-0000-0000-0000-0000000000f5', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go second', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 10, '19:00');
update activities set archived_at = now() where id = '00000000-0000-0000-0000-0000000000f2';
update activities set removed_by_moderation_at = now() where id = '00000000-0000-0000-0000-0000000000f3';
update profiles set banned_at = now() where id = :'ban';

select tests.act_as_anon();

-- ---- activity sitemap ----
select is((select array_agg(id order by id) from web_sitemap_activities()),
  array['00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f5']::uuid[],
  'activity sitemap: normal rows only (no archived, moderated or banned organiser)');
select is((select title from web_sitemap_activities() where id = '00000000-0000-0000-0000-0000000000f1'), 'Go normal', 'activity sitemap: title');
select ok((select updated_at is not null from web_sitemap_activities() limit 1), 'activity sitemap: lastmod present');
select is((select array_agg(id) from web_sitemap_activities(p_limit => 1)), array['00000000-0000-0000-0000-0000000000f1']::uuid[], 'activity paging: first page');
select is((select array_agg(id) from web_sitemap_activities('00000000-0000-0000-0000-0000000000f1', 1)), array['00000000-0000-0000-0000-0000000000f5']::uuid[], 'activity paging: next page, no overlap');
select is((select count(*) from web_sitemap_activities('00000000-0000-0000-0000-0000000000f5', 10))::int, 0, 'activity paging: past the end is empty');
select is((select count(*) from web_sitemap_activities(null, 0))::int, 1, 'activity limit 0 is clamped to 1');
select is((select count(*) from web_sitemap_activities(null, -5))::int, 1, 'activity negative limit is clamped to 1');
select is((select count(*) from web_sitemap_activities(null, 100000))::int, 2, 'activity limit 100000 is clamped (and works)');

-- ---- association sitemap ----
select is((select array_agg(id order by id) from web_sitemap_associations()),
  array['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a5']::uuid[],
  'association sitemap: normal rows only (no hidden, dormant or removed)');
select is((select city from web_sitemap_associations() where id = '00000000-0000-0000-0000-0000000000a1'), 'Lyon', 'association sitemap: city');
select is((select name from web_sitemap_associations() where id = '00000000-0000-0000-0000-0000000000a1'), 'Club normal', 'association sitemap: name');
select ok((select updated_at is not null from web_sitemap_associations() limit 1), 'association sitemap: lastmod present');
select is((select array_agg(id) from web_sitemap_associations(null, 1)), array['00000000-0000-0000-0000-0000000000a1']::uuid[], 'association paging: first page');
select is((select array_agg(id) from web_sitemap_associations('00000000-0000-0000-0000-0000000000a1', 1)), array['00000000-0000-0000-0000-0000000000a5']::uuid[], 'association paging: next page, no overlap');
select is((select count(*) from web_sitemap_associations(null, 0))::int, 1, 'association limit 0 is clamped to 1');
select is((select count(*) from web_sitemap_associations(null, 100000))::int, 2, 'association limit 100000 is clamped (and works)');

-- ---- statuses ----
select is(web_association_status('00000000-0000-0000-0000-0000000000a1'), 'ok', 'association status: ok');
select is(web_association_status('00000000-0000-0000-0000-0000000000a2'), 'hidden', 'association status: hidden (low confidence)');
select is(web_association_status('00000000-0000-0000-0000-0000000000a3'), 'hidden', 'association status: hidden (dormant)');
select is(web_association_status('00000000-0000-0000-0000-0000000000a4'), 'removed', 'association status: removed');
select is(web_association_status(gen_random_uuid()), 'missing', 'association status: missing');
select is(web_association_status(null), 'missing', 'association status: null is missing');
select is(web_activity_status('00000000-0000-0000-0000-0000000000f1'), 'ok', 'activity status: ok');
select is(web_activity_status('00000000-0000-0000-0000-0000000000f2'), 'removed', 'activity status: archived');
select is(web_activity_status('00000000-0000-0000-0000-0000000000f3'), 'removed', 'activity status: moderation-removed');
select is(web_activity_status('00000000-0000-0000-0000-0000000000f4'), 'removed', 'activity status: banned organiser');
select is(web_activity_status(gen_random_uuid()), 'missing', 'activity status: missing');

-- ---- access ----
select tests.act_as_superuser();
select ok(has_function_privilege('anon', 'public.web_sitemap_activities(uuid,int)', 'execute')
  and has_function_privilege('anon', 'public.web_sitemap_associations(uuid,int)', 'execute')
  and has_function_privilege('anon', 'public.web_association_status(uuid)', 'execute')
  and has_function_privilege('anon', 'public.web_activity_status(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.web_activity_status(uuid)', 'execute'), 'anon and authenticated can execute all four');
select * from finish();
rollback;
