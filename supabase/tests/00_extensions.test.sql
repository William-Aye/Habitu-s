begin;
\ir helpers.inc
select plan(5);
select has_extension('postgis');
select has_extension('vector');
select has_extension('pg_trgm');
select has_extension('unaccent');
select has_function('tests', 'act_as', array['uuid']);
select * from finish();
rollback;
