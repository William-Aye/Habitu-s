begin;
\ir helpers.inc
select plan(12);
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
select * from finish();
rollback;
