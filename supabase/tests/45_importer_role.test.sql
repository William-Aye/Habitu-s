begin;
\ir helpers.inc
select plan(12);

-- TM-7: the import and vocabulary jobs run as habituer_importer, which reaches only their tables.
select ok(exists (select 1 from pg_roles where rolname = 'habituer_importer'
                  and not rolsuper and not rolcreaterole and not rolcreatedb and not rolcanlogin),
  'habituer_importer exists, is not a superuser, cannot create roles or databases, and has no login until the owner sets one');

select ok(not has_table_privilege('habituer_importer', 'public.profiles', 'select'), 'no read on profiles');
select ok(not has_table_privilege('habituer_importer', 'public.messages', 'select'), 'no read on messages');
select ok(not has_table_privilege('habituer_importer', 'auth.users', 'select'), 'no read on auth.users');
select ok(not has_schema_privilege('habituer_importer', 'vault', 'usage'), 'no access to Vault');
select ok(not has_schema_privilege('habituer_importer', 'public', 'create'), 'cannot create objects in public');

select ok(not has_table_privilege('habituer_importer', 'public.activities', 'update'), 'no update on activities');
select ok(not has_table_privilege('habituer_importer', 'public.collectifs', 'update'), 'no update on collectifs');
select ok(not has_table_privilege('habituer_importer', 'public.associations', 'update'),
  'associations change only through importer.apply_run');

select ok(has_function_privilege('habituer_importer', 'importer.apply_run(uuid, text[])', 'execute'), 'runs apply_run');
select ok(has_function_privilege('habituer_importer',
  'importer.set_embedding(text, uuid, extensions.vector, text)', 'execute'), 'runs set_embedding');
select ok(not has_function_privilege('authenticated',
  'importer.set_embedding(text, uuid, extensions.vector, text)', 'execute'), 'signed-in users cannot run set_embedding');

select * from finish();
rollback;
