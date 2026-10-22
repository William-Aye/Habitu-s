begin;
\ir helpers.inc
select plan(8);
select has_extension('postgis');
select has_extension('vector');
select has_extension('pg_trgm');
select has_extension('unaccent');
select has_function('tests', 'act_as', array['uuid']);
select tests.act_as(tests.create_user('role-check@example.test'));
select is(current_user::text, 'authenticated', 'act_as switches to authenticated');
select tests.act_as_anon();
select is(current_user::text, 'anon', 'act_as_anon switches to anon');
select tests.act_as_superuser();
select is(current_user::text, 'postgres', 'act_as_superuser restores postgres');
select * from finish();
rollback;
