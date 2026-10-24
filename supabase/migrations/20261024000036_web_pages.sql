-- Public web pages: sitemap listings and page status, readable by anyone (anon and authenticated).
-- Read-only. Nothing here returns profile data: an organiser is only consulted to exclude banned ones.
-- activities has no updated_at column, so created_at is the last-modified date there.

-- One sitemap chunk: every visible row whose id is in [p_lo, p_hi). Ids are random uuids, so the
-- caller splits the id space into ranges. A single jsonb value, so PostgREST max_rows does not apply.
create function public.web_sitemap_range(p_kind text, p_lo uuid, p_hi uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if p_kind = 'activities' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'updated_at', r.created_at)
                                      order by r.id)
      from (select a.id, a.title, a.created_at from public.activities a
            where a.archived_at is null and a.removed_by_moderation_at is null
              and not exists (select 1 from public.profiles p where p.id = a.organiser_id and p.banned_at is not null)
              and a.id >= coalesce(p_lo, '00000000-0000-0000-0000-000000000000'::uuid)
              and (p_hi is null or a.id < p_hi)
            order by a.id limit 50000) r), '[]'::jsonb);
  elsif p_kind = 'associations' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'city', r.city,
                                                         'updated_at', r.updated_at) order by r.id)
      from (select a.id, a.name, a.city, a.updated_at from public.associations a
            where a.removed_at is null
              and not search.is_hidden(a.confidence, a.source)
              and not search.is_dormant(a.website, a.osm_id, a.claimed_by, a.rna_published_on, a.source, current_date)
              and a.id >= coalesce(p_lo, '00000000-0000-0000-0000-000000000000'::uuid)
              and (p_hi is null or a.id < p_hi)
            order by a.id limit 50000) r), '[]'::jsonb);
  end if;
  raise exception 'invalid kind' using errcode = '22023';
end $$;

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

create function public.web_activity_page(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object('status', public.web_activity_status(p_id),
    'activity', case when public.web_activity_status(p_id) = 'ok' then public.get_activity(p_id) end)
$$;

create function public.web_association_page(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object('status', public.web_association_status(p_id),
    'association', case when public.web_association_status(p_id) = 'ok' then public.get_association(p_id) end)
$$;

-- get_association: migration 31's, plus moderation-removed activities and banned organisers hidden.
create or replace function public.get_association(p_id uuid) returns jsonb
language sql stable security definer
set search_path = public, search, extensions, pg_temp
as $$
  select jsonb_build_object(
    'id', a.id, 'name', a.name, 'purpose', a.purpose, 'city', a.city, 'postcode', a.postcode,
    'lon', ST_X(a.town_point::geometry), 'lat', ST_Y(a.town_point::geometry),
    'website', a.website, 'phone', a.phone, 'email', a.email, 'opening_hours', a.opening_hours,
    'source', a.source, 'verified', a.verified, 'claimed', a.claimed_by is not null,
    'source_label', search.source_label(a.source, a.verified, a.confidence),
    'attribution_keys', coalesce((select jsonb_agg(k order by k) from jsonb_object_keys(a.attribution) k), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('slug', t.slug, 'label_fr', t.label_fr,
                                                          'label_en', t.label_en) order by t.slug)
                      from association_tags at join tags t on t.id = at.tag_id
                      where at.association_id = a.id), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title)
                                             order by x.start_date, x.id)
                            from activities x
                            where x.organised_by_association_id = a.id and x.archived_at is null
                              and x.removed_by_moderation_at is null
                              and not exists (select 1 from profiles pr where pr.id = x.organiser_id and pr.banned_at is not null)
                              and x.published_at <= now()
                              and (auth.uid() is null or not public.is_blocked_between(x.organiser_id))),
                           '[]'::jsonb),
    'can_wait', a.claimed_by is null and a.website is null and a.phone is null and a.email is null,
    'is_waiting', exists (select 1 from association_waiters w
                          where w.association_id = a.id and w.user_id = auth.uid())
  )
  from associations a
  where a.id = p_id and not search.is_hidden(a.confidence, a.source) and a.removed_at is null
$$;
revoke all on function public.get_association(uuid) from public;
grant execute on function public.get_association(uuid) to anon, authenticated;

revoke all on function public.web_sitemap_range(text, uuid, uuid) from public;
revoke all on function public.web_association_status(uuid) from public;
revoke all on function public.web_activity_status(uuid) from public;
revoke all on function public.web_activity_page(uuid) from public;
revoke all on function public.web_association_page(uuid) from public;
grant execute on function public.web_sitemap_range(text, uuid, uuid) to anon, authenticated;
grant execute on function public.web_association_status(uuid) to anon, authenticated;
grant execute on function public.web_activity_status(uuid) to anon, authenticated;
grant execute on function public.web_activity_page(uuid) to anon, authenticated;
grant execute on function public.web_association_page(uuid) to anon, authenticated;
