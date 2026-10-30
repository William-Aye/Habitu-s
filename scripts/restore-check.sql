-- Restore check: one line per fact, sorted, so two databases can be compared with diff.
-- Run with: psql -X -A -t -f scripts/restore-check.sql (see scripts/restore-check.sh).

-- Exact row count per public table.
select 'rows public.' || c.relname || ' ' ||
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by c.relname;

-- Number of public tables with row level security on.
select 'rls_tables ' || count(*)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity;

-- Installed extensions.
select 'ext ' || extname from pg_extension order by extname;

-- Scheduled jobs (only where pg_cron exists; informational in the compare, see restore-check.sh).
select to_regclass('cron.job') is not null as has_cron \gset
\if :has_cron
select 'cron ' || jobname from cron.job order by jobname;
\endif

-- The vocabulary every other table hangs off.
select 'categories_count ' || count(*) from public.categories;
