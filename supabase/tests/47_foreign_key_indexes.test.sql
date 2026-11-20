begin;
\ir helpers.inc
select plan(1);

-- Plan step 2.5: every single-column foreign key has an index starting with that column, except
-- these, on small tables or on rarely deleted rows. A new foreign key needs an index or a line here.
select is((
  select string_agg(c.conrelid::regclass::text || '.' || a.attname, ',' order by c.conrelid::regclass::text || '.' || a.attname)
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.contype = 'f' and n.nspname in ('public', 'search', 'importer') and cardinality(c.conkey) = 1
     and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])),
  'activities.category_id,activities.welcome_member_id,admin_audit_log.admin_id,banned_words.added_by,'
    || 'categories.parent_id,collectif_members.invited_by,reports.decided_by,user_interests.category_id',
  'only the listed foreign keys have no index');

select * from finish();
rollback;
