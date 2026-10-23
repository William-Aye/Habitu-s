-- People an active collectif organiser may invite as organiser: members of the collectif's
-- activities who could organise themselves (same rule as can_organise(), applied to them).
-- Profiles are owner-only, so first names and photos come through this definer function.
create function public.collectif_candidates(p_collectif uuid)
returns table (user_id uuid, first_name text, photo_url text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_collectif_member(p_collectif) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select p.id, p.first_name, p.photo_url
      from public.profiles p
     where p.id in (select am.user_id
                      from public.activity_members am
                      join public.activities a on a.id = am.activity_id
                     where a.organised_by_collectif_id = p_collectif and am.status = 'member')
       and p.first_name <> '' and p.age_confirmed
       and p.created_at <= now() - interval '24 hours'
       and not public.is_blocked_between(p.id)
       and not exists (select 1 from public.collectif_members m
                        where m.collectif_id = p_collectif and m.user_id = p.id)
     order by p.first_name, p.id;
end $$;
revoke all on function public.collectif_candidates(uuid) from public, anon;
grant execute on function public.collectif_candidates(uuid) to authenticated;
