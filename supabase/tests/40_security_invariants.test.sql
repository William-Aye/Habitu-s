begin;
\ir helpers.inc
select plan(21);

-- ---- the invariant queries, kept as views so the same text is checked and proven -------------------
create temp view inv_no_rls as
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
create temp view inv_no_search_path as
  select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'search', 'importer', 'private') and p.prosecdef and p.prokind = 'f'
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
-- Functions anon may run: the public search and page RPCs, the web_* status/page/sitemap RPCs, the
-- boolean membership/role helpers (security definer, they answer false without a session), and trigger
-- functions (PostgreSQL refuses to run those outside a trigger). Anything else is a leak.
create temp view inv_anon_functions as
  select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
     and p.proname <> all (array[
       'search_explore', 'get_activity', 'get_association', 'get_collectif',
       'web_sitemap_range', 'web_association_status', 'web_activity_status', 'web_activity_page', 'web_association_page',
       'is_admin', 'is_activity_member', 'is_activity_organiser', 'is_session_member', 'is_session_organiser',
       'is_collectif_member', 'is_collectif_responsable',
       'handle_new_user', 'associations_guard_update', 'activity_members_set_status', 'activity_members_guard_update',
       'activities_guard_association', 'activities_guard_delete', 'sessions_guard', 'attendances_guard',
       'attendances_touch', 'activity_members_joined_at_insert', 'activity_members_joined_at_update']);
create temp view inv_anon_writes as
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update')
          or has_table_privilege('anon', c.oid, 'delete'));
create temp view inv_public_buckets as
  select id from storage.buckets where public and id <> all (array['avatars']);

-- ---- the invariants hold ---------------------------------------------------------------------
select is_empty('select * from inv_no_rls', 'every public table has row-level security');
select is_empty('select * from inv_no_search_path', 'every security definer function (public, search, importer) pins its search_path');
select is_empty('select * from inv_anon_functions', 'anon runs only the listed public functions');
select is_empty('select * from inv_anon_writes', 'anon holds no insert, update or delete privilege on a public table');
select is_empty('select * from inv_public_buckets', 'only the avatars bucket is public');
select is(has_function_privilege('authenticated', 'public.is_banned(uuid)', 'execute'), false, 'authenticated cannot run public.is_banned');
select is(has_function_privilege('anon', 'public.is_banned(uuid)', 'execute'), false, 'anon cannot run public.is_banned');
select is(has_function_privilege('public', 'public.is_banned(uuid)', 'execute'), false, 'PUBLIC cannot run public.is_banned');
select is(has_function_privilege('anon', 'private.is_banned(uuid)', 'execute'), false, 'anon cannot run private.is_banned');
select is(has_function_privilege('public', 'private.is_banned(uuid)', 'execute'), false, 'PUBLIC cannot run private.is_banned');
select is(has_schema_privilege('anon', 'private', 'usage'), false, 'anon has no usage on the private schema');
-- FN-6: pg_net's grants to anon and authenticated belong to supabase_admin, so a migration (run as
-- postgres) cannot revoke them; they stay unreachable because net, vault and cron are never exposed
-- through the API (scripts/exposed-schemas.test.mjs checks config.toml). Vault and cron are closed:
select is(has_schema_privilege('anon', 'vault', 'usage') or has_schema_privilege('authenticated', 'vault', 'usage'), false, 'no API role has usage on the vault schema');
select is(has_schema_privilege('anon', 'cron', 'usage') or has_schema_privilege('authenticated', 'cron', 'usage'), false, 'no API role has usage on the cron schema');

-- ---- the checks catch real cases ---------------------------------------------------------------
create table public.zz_no_rls (id int);
create function public.zz_no_path() returns int language sql security definer as $$ select 1 $$;
create function private.zz_private_no_path() returns int language sql security definer as $$ select 1 $$;
create function public.zz_anon_open() returns int language sql as $$ select 1 $$;
create table public.zz_anon_write (id int);
grant insert on public.zz_anon_write to anon;
insert into storage.buckets (id, name, public) values ('zz-open', 'zz-open', true);
select isnt_empty($$ select * from inv_no_rls where relname = 'zz_no_rls' $$, 'the RLS check finds a table without it');
select isnt_empty($$ select * from inv_no_search_path where fn like 'zz_no_path%' $$, 'the search_path check finds a definer function without it');
select isnt_empty($$ select * from inv_no_search_path where fn like 'private.zz_private_no_path%' $$, 'the search_path check covers the private schema');
select isnt_empty($$ select * from inv_anon_functions where fn like 'zz_anon_open%' $$, 'the anon-function check finds an unlisted function');
select isnt_empty($$ select * from inv_anon_writes where relname = 'zz_anon_write' $$, 'the anon-write check finds a granted table');
select isnt_empty($$ select * from inv_public_buckets where id = 'zz-open' $$, 'the bucket check finds an unlisted public bucket');

-- ---- the reports queue pages through its cursor -------------------------------------------------
select tests.create_user('adm@sec.fr', 'Admin') as adm \gset
select tests.create_user('tgt@sec.fr', 'Cible') as tgt \gset
update profiles set role = 'admin' where id = :'adm';
-- six reports; the last three share one created_at, so the id breaks the tie
insert into reports (reporter_id, target_type, target_id, reason, source, created_at)
select null, 'user', :'tgt', 'other', 'auto', timestamptz '2026-10-01 10:00:00+00' - (least(g, 4) || ' minutes')::interval
  from generate_series(1, 6) g;
-- The rows of this test, in the queue's order (newest first, id breaking the tie). The first page is
-- anchored just after them, so reports from other files or the seed cannot shift the pages.
select array_agg(id order by created_at desc, id desc)::text as own from reports where target_id = :'tgt' \gset
select tests.act_as_admin(:'adm');
select set_config('sec.page1', public.admin_reports('open', timestamptz '2026-10-01 10:00:00+00', null, 2)::text, true);
select set_config('sec.page2', public.admin_reports('open',
  (current_setting('sec.page1')::jsonb #>> '{items,1,created_at}')::timestamptz,
  (current_setting('sec.page1')::jsonb #>> '{items,1,id}')::uuid, 2)::text, true);
select set_config('sec.page3', public.admin_reports('open',
  (current_setting('sec.page2')::jsonb #>> '{items,1,created_at}')::timestamptz,
  (current_setting('sec.page2')::jsonb #>> '{items,1,id}')::uuid, 2)::text, true);
select is((select array_agg(i ->> 'id' order by n, o) from generate_series(1, 3) n,
             jsonb_array_elements(current_setting('sec.page' || n)::jsonb -> 'items') with ordinality as e(i, o)),
  (:'own')::text[], 'three pages of two return the six reports in order, with no overlap');
select is((select array_agg(i ->> 'id' order by o) from jsonb_array_elements(current_setting('sec.page2')::jsonb -> 'items') with ordinality as e(i, o)),
  ((:'own')::text[])[3:4], 'the second page, fetched through the cursor, holds exactly the third and fourth rows');
select * from finish();
rollback;
