-- DB-9 (security follow-up 1.3): search_explore runs as its owner and writes a row to
-- public.search_misses and search.vocab_requests for every new query string, including for
-- signed-out callers who reach PostgREST directly (not through Cloudflare). Neither table had a
-- daily cap, and search_misses had no retention, so a script could grow them without limit.
--
-- Fix: at most 2000 new rows per day in each table (far above real use), then new rows are
-- dropped silently (a search never fails because of logging); search misses are deleted after
-- 180 days by a nightly job.

create index if not exists search_misses_day on public.search_misses (day);
create index if not exists vocab_requests_first_seen on search.vocab_requests (first_seen);

create or replace function private.cap_search_misses() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.search_misses m where m.day = new.day) >= 2000 then
    return null;
  end if;
  return new;
end $$;

create or replace function private.cap_vocab_requests() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from search.vocab_requests r where r.first_seen = new.first_seen) >= 2000 then
    return null;
  end if;
  return new;
end $$;

revoke all on function private.cap_search_misses() from public, anon, authenticated;
revoke all on function private.cap_vocab_requests() from public, anon, authenticated;

drop trigger if exists search_misses_daily_cap on public.search_misses;
create trigger search_misses_daily_cap before insert on public.search_misses
  for each row execute function private.cap_search_misses();

drop trigger if exists vocab_requests_daily_cap on search.vocab_requests;
create trigger vocab_requests_daily_cap before insert on search.vocab_requests
  for each row execute function private.cap_vocab_requests();

select cron.schedule('prune-search-misses', '25 4 * * *',
  $$ delete from public.search_misses where day < current_date - 180 $$);
