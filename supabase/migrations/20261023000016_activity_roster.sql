-- Organiser tools: the people who asked to join and the members (to pick the welcome person).
-- profiles are readable by their owner only, so the organiser gets first names and photos here.
create function public.activity_roster(p_activity uuid)
returns table (user_id uuid, first_name text, photo_url text, status text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_activity_organiser(p_activity) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select m.user_id, p.first_name, p.photo_url, m.status
      from public.activity_members m
      join public.profiles p on p.id = m.user_id
     where m.activity_id = p_activity
       and m.status in ('member', 'pending')
       and not public.is_blocked_between(m.user_id)
     order by m.status desc, m.joined_at, m.user_id;
end $$;
revoke all on function public.activity_roster(uuid) from public, anon;
grant execute on function public.activity_roster(uuid) to authenticated;
