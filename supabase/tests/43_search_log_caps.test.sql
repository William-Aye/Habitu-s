begin;
\ir helpers.inc
select plan(8);

-- DB-9: a search by an API caller adds at most 2000 new rows a day to each search log.
create temp table q as select 'zzqx vwkj'::text as a, 'qqzv wkkj'::text as b;
grant select on q to anon;

-- Below the cap, a signed-out search with no result is logged once in each table.
set local role anon;
select public.search_explore(4.835, 45.764, 5, (select a from q), null,
  '{activity,association}', null, null, null, 'best', 20, 0, null);
reset role;
select is((select count(*) from public.search_misses where day = current_date)::int, 1,
  'a signed-out search with no result is logged');
select is((select count(*) from search.vocab_requests where first_seen = current_date)::int, 1,
  'and its phrase is recorded as a vocabulary request');

-- Fill both logs to the cap. Direct writes (jobs, admins in SQL, tests) are not capped.
insert into public.search_misses (query, area_label)
select 'q' || g, 'Lyon' from generate_series(1, 2004) g;
insert into search.vocab_requests (phrase)
select 'phrase ' || g from generate_series(1, 2004) g;
select is((select count(*) from public.search_misses where day = current_date)::int, 2005,
  'direct writes are not capped');

-- Past the cap, a signed-out search still answers and logs nothing new.
set local role anon;
select lives_ok($$ select public.search_explore(4.835, 45.764, 5, (select b from q), null,
  '{activity,association}', null, null, null, 'best', 20, 0, null) $$,
  'search still works once the cap is reached');
reset role;
select is((select count(*) from public.search_misses where day = current_date)::int, 2005,
  'no miss logged past the cap');
select is((select count(*) from search.vocab_requests where first_seen = current_date)::int, 2005,
  'no vocabulary request logged past the cap');

-- Older days are not counted against today, and old misses are pruned.
insert into public.search_misses (query, area_label, day, created_at)
values ('old', 'Lyon', current_date - 181, current_date - 181);
select is((select count(*) from public.search_misses where query = 'old')::int, 1,
  'a row from another day is stored');
select ok(exists (select 1 from cron.job where jobname = 'prune-search-misses'
                  and command ~ 'current_date - 180'), 'search misses are pruned after 180 days');

select * from finish();
rollback;
