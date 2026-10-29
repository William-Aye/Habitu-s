-- DB-5 (pre-launch security review): the daily creation limits for activities (3) and collectifs (2)
-- counted rows that still exist, so creating and deleting gave the creation back, without end.
-- They now count against limit_log through take_limit, which keeps a line per creation for the day
-- whether or not the row survives. Same limits, same error, admins still exempt.
-- The trigger functions stay invoker rights (current_user is the client role only for direct writes);
-- take_limit is not executable by clients, so each limit goes through a fixed wrapper in the private
-- schema (not exposed by the API) that only counts against the caller's own uid.

create function private.take_activity_limit() returns void
language sql security definer set search_path = public, pg_temp as $$
  select public.take_limit('activity', 3, '1 day');
$$;
revoke all on function private.take_activity_limit() from public, anon;
grant execute on function private.take_activity_limit() to authenticated;

create function private.take_collectif_limit() returns void
language sql security definer set search_path = public, pg_temp as $$
  select public.take_limit('collectif', 2, '1 day');
$$;
revoke all on function private.take_collectif_limit() from public, anon;
grant execute on function private.take_collectif_limit() to authenticated;

create or replace function public.activities_limit() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    perform private.take_activity_limit();
  end if;
  return new;
end $$;
revoke all on function public.activities_limit() from public, anon, authenticated;

create or replace function public.collectifs_limit() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    perform private.take_collectif_limit();
  end if;
  return new;
end $$;
revoke all on function public.collectifs_limit() from public, anon, authenticated;
