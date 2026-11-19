begin;
\ir helpers.inc
select plan(6);

-- DB-9: the search logs keep at most 2000 new rows per day.
insert into public.search_misses (query, area_label)
select 'q' || g, 'Lyon' from generate_series(1, 2005) g;
select is((select count(*) from public.search_misses where day = current_date)::int, 2000,
  'search_misses stops at 2000 new rows a day');

insert into search.vocab_requests (phrase)
select 'phrase ' || g from generate_series(1, 2005) g;
select is((select count(*) from search.vocab_requests where first_seen = current_date)::int, 2000,
  'vocab_requests stops at 2000 new phrases a day');

-- A signed-out search past the cap still answers and logs nothing.
set local role anon;
select lives_ok($$ select public.search_explore(4.835, 45.764, 5, 'zzqx vwkj', null,
  '{activity,association}', null, null, null, 'best', 20, 0, null) $$,
  'search still works once the cap is reached');
reset role;
select is((select count(*) from public.search_misses where day = current_date)::int, 2000,
  'no miss logged past the cap');

-- Older days are not counted against today, and old misses are pruned.
insert into public.search_misses (query, area_label, day, created_at)
values ('old', 'Lyon', current_date - 181, current_date - 181);
select is((select count(*) from public.search_misses where query = 'old')::int, 1,
  'a row from another day is not capped by today''s count');
select ok(exists (select 1 from cron.job where jobname = 'prune-search-misses'
                  and command ~ 'current_date - 180'), 'search misses are pruned after 180 days');

select * from finish();
rollback;
