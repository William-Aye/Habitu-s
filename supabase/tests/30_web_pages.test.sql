begin;
\ir helpers.inc
select plan(41);
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
update activities set organised_by_association_id = '00000000-0000-0000-0000-0000000000a1' where id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f4');

select tests.act_as_anon();

-- ---- sitemap ranges ----
select is((select jsonb_array_length(web_sitemap_range('activities', '00000000-0000-0000-0000-000000000000', null))), 2, 'activities: whole range, visible rows only (no archived, moderated or banned organiser)');
select is((select jsonb_agg(e->>'id' order by e->>'id') from jsonb_array_elements(web_sitemap_range('activities', '00000000-0000-0000-0000-000000000000', null)) e),
  '["00000000-0000-0000-0000-0000000000f1", "00000000-0000-0000-0000-0000000000f5"]'::jsonb, 'activities: the right two ids');
select is((web_sitemap_range('activities', '00000000-0000-0000-0000-000000000000', null)->0->>'title'), 'Go normal', 'activities: title');
select ok((web_sitemap_range('activities', '00000000-0000-0000-0000-000000000000', null)->0->>'updated_at') is not null, 'activities: updated_at present');
select is(jsonb_array_length(web_sitemap_range('activities', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f5')), 1, 'activities: lo is inclusive, hi is exclusive');
select is(web_sitemap_range('activities', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f5')->0->>'id', '00000000-0000-0000-0000-0000000000f1', 'activities: lo id is in range');
select is(jsonb_array_length(web_sitemap_range('activities', '00000000-0000-0000-0000-0000000000f2', null)), 1, 'activities: ids below lo are excluded');
select is(jsonb_array_length(web_sitemap_range('activities', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f5')), 0, 'activities: empty range gives []');
select is(jsonb_array_length(web_sitemap_range('activities', null, null)), 2, 'activities: null lo means from the start');
select is((select jsonb_agg(e->>'id' order by e->>'id') from jsonb_array_elements(web_sitemap_range('associations', '00000000-0000-0000-0000-000000000000', null)) e),
  '["00000000-0000-0000-0000-0000000000a1", "00000000-0000-0000-0000-0000000000a5"]'::jsonb, 'associations: visible rows only (no hidden, dormant or removed)');
select is(web_sitemap_range('associations', '00000000-0000-0000-0000-000000000000', null)->0->>'city', 'Lyon', 'associations: city');
select is(web_sitemap_range('associations', '00000000-0000-0000-0000-000000000000', null)->0->>'name', 'Club normal', 'associations: name');
select ok((web_sitemap_range('associations', '00000000-0000-0000-0000-000000000000', null)->0->>'updated_at') is not null, 'associations: updated_at present');
select is(jsonb_array_length(web_sitemap_range('associations', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a5')), 1, 'associations: hi is exclusive');
select is(jsonb_array_length(web_sitemap_range('associations', '00000000-0000-0000-0000-0000000000a2', null)), 1, 'associations: ids below lo are excluded');
select throws_ok($$ select web_sitemap_range('profiles', null, null) $$, '22023', 'invalid kind', 'a bad kind raises 22023');
select is(pg_get_functiondef('public.web_sitemap_range(text,uuid,uuid)'::regprocedure) like '%limit 50000%', true, 'the 50000 cap is in the function');
select is(to_regprocedure('public.web_sitemap_activities(uuid,int)') is null and to_regprocedure('public.web_sitemap_associations(uuid,int)') is null, true, 'the old paged functions are gone');

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

-- ---- page functions ----
select is(web_activity_page('00000000-0000-0000-0000-0000000000f1')->>'status', 'ok', 'activity page: ok');
select is(web_activity_page('00000000-0000-0000-0000-0000000000f1')->'activity'->>'id', '00000000-0000-0000-0000-0000000000f1', 'activity page: carries the activity');
select is(web_activity_page('00000000-0000-0000-0000-0000000000f2')->'activity', 'null'::jsonb, 'activity page: removed has null data');
select is(web_activity_page('00000000-0000-0000-0000-0000000000f2')->>'status', 'removed', 'activity page: removed status');
select is(web_activity_page(gen_random_uuid())->>'status', 'missing', 'activity page: missing status');
select is(web_association_page('00000000-0000-0000-0000-0000000000a1')->>'status', 'ok', 'association page: ok');
select is(web_association_page('00000000-0000-0000-0000-0000000000a1')->'association'->>'name', 'Club normal', 'association page: carries the association');
select is(web_association_page('00000000-0000-0000-0000-0000000000a2')->'association', 'null'::jsonb, 'association page: hidden has null data');
select is(web_association_page('00000000-0000-0000-0000-0000000000a4')->>'status', 'removed', 'association page: removed status');
select is(web_association_page(gen_random_uuid())->>'status', 'missing', 'association page: missing status');
select is((select jsonb_agg(e->>'id') from jsonb_array_elements(get_association('00000000-0000-0000-0000-0000000000a1')->'activities') e),
  '["00000000-0000-0000-0000-0000000000f1"]'::jsonb, 'get_association lists only visible activities (not archived, moderated or banned organiser)');

-- ---- access ----
select tests.act_as_superuser();
select ok(has_function_privilege('anon', 'public.web_sitemap_range(text,uuid,uuid)', 'execute')
  and has_function_privilege('anon', 'public.web_association_status(uuid)', 'execute')
  and has_function_privilege('anon', 'public.web_activity_status(uuid)', 'execute')
  and has_function_privilege('anon', 'public.web_activity_page(uuid)', 'execute')
  and has_function_privilege('anon', 'public.web_association_page(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.web_association_page(uuid)', 'execute'), 'anon and authenticated can execute all of them');
select * from finish();
rollback;
