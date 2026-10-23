-- Create-an-activity flow: directory search for the "Une association" choice, and limits on
-- community-added clubs.

-- API roles cannot read claimed_by (migration 7), so the search runs as definer. Same rule as
-- activities_guard_association: an unverified association, or one claimed by the caller.
create function public.search_linkable_associations(p_query text, p_limit int default 20)
returns table (id uuid, name text, city text, postcode text)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.name, a.city, a.postcode
    from public.associations a
   where (a.verified = false or a.claimed_by = auth.uid())
     and char_length(btrim(coalesce(p_query, ''))) >= 2
     and ((search.normalise_name(p_query) <> '' and position(search.normalise_name(p_query) in a.name_norm) > 0)
          or position(search.unaccent(lower(btrim(p_query))) in search.unaccent(lower(a.name))) > 0)
   order by a.name, a.id
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;
revoke all on function public.search_linkable_associations(text, int) from public, anon;
grant execute on function public.search_linkable_associations(text, int) to authenticated;

-- created_by is not readable by API roles, so the limit counts through this definer helper.
create function public.my_recent_community_clubs() returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.associations a
   where a.created_by = auth.uid() and a.source = 'community'
     and a.created_at > now() - interval '24 hours'
$$;
revoke all on function public.my_recent_community_clubs() from public, anon;
grant execute on function public.my_recent_community_clubs() to authenticated;

-- Community clubs: organising rule, 5 per user per rolling 24 h, and a website that is a web link.
create function public.associations_community_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if tg_op = 'INSERT' and new.source = 'community' then
      perform pg_advisory_xact_lock(hashtext('limits:' || coalesce(auth.uid()::text, '')));
      if not public.can_organise() then
        raise exception 'not_allowed' using errcode = '42501';
      end if;
      if public.my_recent_community_clubs() >= 5 then
        raise exception 'limit_reached' using errcode = '42501';
      end if;
    end if;
    if new.website is not null
       and (tg_op = 'INSERT' or new.website is distinct from old.website)
       and new.website !~* '^https?://[^[:space:]]+$' then
      raise exception 'invalid_website' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.associations_community_guard() from public, anon, authenticated;
create trigger associations_community_guard before insert or update on public.associations
  for each row execute function public.associations_community_guard();

-- created_at drives the limit above: API roles cannot forge it.
create trigger associations_pin_dates before insert or update on public.associations
  for each row execute function public.pin_creation_dates();
