-- Public web pages: sitemap listings and page status, readable by anyone (anon and authenticated).
-- Read-only. Nothing here returns profile data: an organiser is only consulted to exclude banned ones.
-- activities has no updated_at column, so created_at is the last-modified date there.

create function public.web_sitemap_activities(p_after uuid default null, p_limit int default 5000)
returns table (id uuid, title text, updated_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select a.id, a.title, a.created_at
  from public.activities a
  where a.archived_at is null
    and a.removed_by_moderation_at is null
    and not exists (select 1 from public.profiles p where p.id = a.organiser_id and p.banned_at is not null)
    and (p_after is null or a.id > p_after)
  order by a.id
  limit greatest(1, least(coalesce(p_limit, 5000), 50000))
$$;

create function public.web_sitemap_associations(p_after uuid default null, p_limit int default 5000)
returns table (id uuid, name text, city text, updated_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select a.id, a.name, a.city, a.updated_at
  from public.associations a
  where a.removed_at is null
    and not search.is_hidden(a.confidence, a.source)
    and not search.is_dormant(a.website, a.osm_id, a.claimed_by, a.rna_published_on, a.source, current_date)
    and (p_after is null or a.id > p_after)
  order by a.id
  limit greatest(1, least(coalesce(p_limit, 5000), 50000))
$$;

create function public.web_association_status(p_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when a.removed_at is not null then 'removed'
      when search.is_hidden(a.confidence, a.source)
        or search.is_dormant(a.website, a.osm_id, a.claimed_by, a.rna_published_on, a.source, current_date)
        then 'hidden'
      else 'ok' end
    from public.associations a where a.id = p_id
  ), 'missing')
$$;

create function public.web_activity_status(p_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when a.archived_at is not null or a.removed_by_moderation_at is not null
        or exists (select 1 from public.profiles p where p.id = a.organiser_id and p.banned_at is not null)
        then 'removed'
      else 'ok' end
    from public.activities a where a.id = p_id
  ), 'missing')
$$;

revoke all on function public.web_sitemap_activities(uuid, int) from public;
revoke all on function public.web_sitemap_associations(uuid, int) from public;
revoke all on function public.web_association_status(uuid) from public;
revoke all on function public.web_activity_status(uuid) from public;
grant execute on function public.web_sitemap_activities(uuid, int) to anon, authenticated;
grant execute on function public.web_sitemap_associations(uuid, int) to anon, authenticated;
grant execute on function public.web_association_status(uuid) to anon, authenticated;
grant execute on function public.web_activity_status(uuid) to anon, authenticated;
