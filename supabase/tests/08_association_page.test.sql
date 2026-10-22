begin;
\ir helpers.inc
select plan(30);

select tests.create_user('u@page.fr') as u \gset
select tests.create_user('v@page.fr') as v \gset
select tests.create_user('root@page.fr') as root \gset
update profiles set role = 'admin' where id = :'root';

insert into associations (id, name, purpose, source, confidence, city, postcode, address, location, attribution)
values ('00000000-0000-0000-0000-00000000c001', 'Club de Go de Lyon', 'Jeu de go', 'rna', 60, 'Lyon', '69003',
        '12 rue Secrète', 'SRID=4326;POINT(4.83456 45.76789)', '{"rna": "x", "osm": "y"}');
insert into associations (id, name, source, confidence, location)
values ('00000000-0000-0000-0000-00000000c002', 'Cachée', 'rna', 0, 'SRID=4326;POINT(4.8 45.7)');
insert into associations (id, name, source, confidence, location)
values ('00000000-0000-0000-0000-00000000c003', 'Ajoutée', 'community', 0, 'SRID=4326;POINT(4.8 45.7)');
insert into associations (id, name, source, confidence, location)
values ('00000000-0000-0000-0000-00000000c004', 'Douteuse', 'rna', 45, 'SRID=4326;POINT(4.8 45.7)');
insert into associations (id, name, source, confidence, phone, location)
values ('00000000-0000-0000-0000-00000000c005', 'Joignable', 'rna', 60, '0472000000', 'SRID=4326;POINT(4.8 45.7)');
insert into associations (id, name, source, confidence, claimed_by, location)
values ('00000000-0000-0000-0000-00000000c006', 'Revendiquée', 'rna', 60, :'u', 'SRID=4326;POINT(4.8 45.7)');
insert into associations (id, name, source, confidence, location)
values ('00000000-0000-0000-0000-00000000c007', 'Fiable', 'rna', 80, 'SRID=4326;POINT(4.8 45.7)');

insert into tags (id, slug, label_fr, label_en)
values ('00000000-0000-0000-0000-00000000a701', 'page-test-tag', 'Jeu', 'Game');
insert into association_tags (association_id, tag_id)
values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000a701');

insert into activities (id, organiser_id, organised_by_association_id, category_id, title, place_label, place,
  recurrence_kind, start_date, start_time, archived_at)
select v.id::uuid, :'u', '00000000-0000-0000-0000-00000000c001', (select id from categories limit 1), v.title,
       'Lyon', 'SRID=4326;POINT(4.83 45.77)', 'weekly', '2026-11-01', '19:00', v.arch::timestamptz
from (values ('00000000-0000-0000-0000-00000000ac01', 'Initiation au go', null),
             ('00000000-0000-0000-0000-00000000ac02', 'Ancien atelier', '2026-01-01')) v(id, title, arch);

-- anon
select tests.act_as_anon();
select is(public.get_association('00000000-0000-0000-0000-00000000c001') ->> 'name', 'Club de Go de Lyon', 'anon gets name');
select is(public.get_association('00000000-0000-0000-0000-00000000c001') ->> 'city', 'Lyon', 'anon gets city');
select is((public.get_association('00000000-0000-0000-0000-00000000c001') ->> 'lon')::float8, 4.83::float8, 'lon from town_point');
select is((public.get_association('00000000-0000-0000-0000-00000000c001') ->> 'lat')::float8, 45.77::float8, 'lat from town_point');
select ok(not (public.get_association('00000000-0000-0000-0000-00000000c001') ? 'address'), 'no address key');
select ok(not (public.get_association('00000000-0000-0000-0000-00000000c001') ? 'location'), 'no location key');
select ok(public.get_association('00000000-0000-0000-0000-00000000c001')::text !~ 'Secr', 'address text never leaks');
select is(public.get_association('00000000-0000-0000-0000-00000000c001') ->> 'postcode', '69003', 'postcode');
select is(public.get_association('00000000-0000-0000-0000-00000000c001') -> 'attribution_keys', '["osm","rna"]'::jsonb,
          'attribution keys sorted');
select is(jsonb_array_length(public.get_association('00000000-0000-0000-0000-00000000c001') -> 'tags'), 1, 'one tag');
select ok((public.get_association('00000000-0000-0000-0000-00000000c001') -> 'tags' -> 0) ?& array['slug', 'label_fr', 'label_en'],
          'tag shape');
select ok(public.get_association('00000000-0000-0000-0000-00000000c002') is null, 'confidence 0 RNA row is null');
select ok(public.get_association(gen_random_uuid()) is null, 'unknown id is null');
select is(public.get_association('00000000-0000-0000-0000-00000000c003') ->> 'source_label', 'community', 'community label');
select is(public.get_association('00000000-0000-0000-0000-00000000c004') ->> 'source_label', 'unverified', 'confidence 45 unverified');
select ok(public.get_association('00000000-0000-0000-0000-00000000c007') -> 'source_label' = 'null'::jsonb, 'no label when fine');
select is((public.get_association('00000000-0000-0000-0000-00000000c005') ->> 'can_wait')::boolean, false, 'phone: cannot wait');
select is((public.get_association('00000000-0000-0000-0000-00000000c006') ->> 'can_wait')::boolean, false, 'claimed: cannot wait');
select is((public.get_association('00000000-0000-0000-0000-00000000c001') ->> 'can_wait')::boolean, true, 'contactless: can wait');
select is((public.get_association('00000000-0000-0000-0000-00000000c001') ->> 'is_waiting')::boolean, false, 'anon is not waiting');
select is(public.get_association('00000000-0000-0000-0000-00000000c001') -> 'activities',
          '[{"id": "00000000-0000-0000-0000-00000000ac01", "title": "Initiation au go"}]'::jsonb,
          'only non-archived activities');

-- waiters
select tests.act_as(:'u');
select lives_ok($$ insert into association_waiters (association_id, user_id)
  values ('00000000-0000-0000-0000-00000000c001', auth.uid()) $$, 'U waits');
select is((public.get_association('00000000-0000-0000-0000-00000000c001') ->> 'is_waiting')::boolean, true, 'is_waiting for U');
select throws_ok($$ insert into association_waiters (association_id, user_id)
  values ('00000000-0000-0000-0000-00000000c001', '$$ || :'v' || $$') $$, '42501', null, 'cannot wait for someone else');
select tests.act_as(:'v');
select is((public.get_association('00000000-0000-0000-0000-00000000c001') ->> 'is_waiting')::boolean, false, 'not waiting for V');
select is((select count(*)::int from association_waiters), 0, 'V cannot read U row');
delete from association_waiters;
select tests.act_as(:'root');
select is((select count(*)::int from association_waiters), 1, 'V delete removed nothing; admin reads all');
select tests.act_as(:'u');
delete from association_waiters;
select is((select count(*)::int from association_waiters), 0, 'U deleted own row');
select tests.act_as_superuser();
select is((select count(*)::int from association_waiters), 0, 'row is gone');
select ok(not has_function_privilege('public', 'public.get_association(uuid)', 'execute')
          and has_function_privilege('anon', 'public.get_association(uuid)', 'execute'), 'execute grants');

select * from finish();
rollback;
