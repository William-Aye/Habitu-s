-- Public web pages: sitemap listings and page status, readable by anyone (anon and authenticated).
-- Read-only. Nothing here returns profile data: an organiser is only consulted to exclude banned ones.
-- activities has no updated_at column, so created_at is the last-modified date there.
-- Visible activities follow explore's filter: not archived, published_at <= now().

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
              and a.published_at <= now()
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
      when a.published_at > now() then 'missing'
      else 'ok' end
    from public.activities a where a.id = p_id
  ), 'missing')
$$;

create function public.web_activity_page(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object('status', s.st, 'activity', case when s.st = 'ok' then public.get_activity(p_id) end)
  from (select public.web_activity_status(p_id) as st) s
$$;

create function public.web_association_page(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object('status', s.st, 'association', case when s.st = 'ok' then public.get_association(p_id) end)
  from (select public.web_association_status(p_id) as st) s
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

-- get_activity: migration 33's, plus: organised_by does not name a removed association, and a signed-out
-- reader gets the organiser's id only (no first name, no photo): members are never named to anonymous visitors.
create or replace function public.get_activity(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  a public.activities;
  v_uid uuid := auth.uid();
  v_is_organiser boolean;
  v_membership text;
  v_sees_people boolean;
begin
  select * into a from public.activities where id = p_id;
  if not found then
    return null;
  end if;
  v_is_organiser := v_uid is not null and a.organiser_id = v_uid;
  if a.archived_at is not null and not v_is_organiser and not public.is_admin() then
    return null;
  end if;
  -- Blocked with the organiser, in either direction: the page does not exist for this user.
  if v_uid is not null and not v_is_organiser and public.is_blocked_between(a.organiser_id) then
    return null;
  end if;
  select m.status into v_membership from public.activity_members m
   where m.activity_id = p_id and m.user_id = v_uid;
  v_sees_people := v_is_organiser or coalesce(v_membership = 'member', false);

  return jsonb_build_object(
      'id', a.id,
      'title', a.title,
      'description', a.description,
      'category', (select jsonb_build_object('id', c.id, 'slug', c.slug, 'name_fr', c.name_fr,
                                             'name_en', c.name_en, 'icon', c.icon)
                     from public.categories c where c.id = a.category_id),
      'tags', coalesce((select jsonb_agg(jsonb_build_object('slug', t.slug, 'label_fr', t.label_fr,
                                                            'label_en', t.label_en) order by t.slug)
                          from public.activity_tags x join public.tags t on t.id = x.tag_id
                         where x.activity_id = a.id), '[]'::jsonb),
      'organiser', (select case when v_uid is null then jsonb_build_object('id', p.id)
                           else jsonb_build_object('id', p.id, 'first_name', p.first_name, 'photo_url', p.photo_url) end
                      from public.profiles p where p.id = a.organiser_id),
      'organised_by', case
        when a.organised_by_association_id is not null then
          (select jsonb_build_object('kind', 'association', 'id', x.id, 'name', x.name)
             from public.associations x
            where x.id = a.organised_by_association_id and x.removed_at is null)
        when a.organised_by_collectif_id is not null then
          (select jsonb_build_object('kind', 'collectif', 'id', x.id, 'name', x.name)
             from public.collectifs x where x.id = a.organised_by_collectif_id)
        end,
      'place_label', a.place_label,
      'lon', ST_X(a.place::geometry),
      'lat', ST_Y(a.place::geometry),
      'recurrence_kind', a.recurrence_kind,
      'recurrence_interval_days', a.recurrence_interval_days,
      'recurrence_weekdays', a.recurrence_weekdays,
      'start_date', a.start_date,
      'start_time', a.start_time,
      'duration_minutes', a.duration_minutes,
      'timezone', a.timezone,
      'max_size', a.max_size,
      'newcomer_friendly', a.newcomer_friendly,
      'approval_mode', a.approval_mode,
      'published_at', a.published_at,
      'archived_at', a.archived_at,
      'is_organiser', v_is_organiser,
      'my_status', case when v_membership in ('member', 'pending') then v_membership else 'none' end,
      'next_sessions', coalesce((select jsonb_agg(public.session_card(s.id, v_sees_people) order by s.starts_at)
                                   from (select s.id, s.starts_at from public.sessions s
                                          where s.activity_id = a.id and s.starts_at > now()
                                          order by s.starts_at limit 8) s), '[]'::jsonb))
    || case when v_sees_people then jsonb_build_object('welcome_first_name',
         (select p.first_name from public.profiles p
           where p.id = a.welcome_member_id and not public.is_blocked_between(p.id)
             and (p.id = a.organiser_id or exists (select 1 from public.activity_members wm
                   where wm.activity_id = a.id and wm.user_id = p.id and wm.status = 'member'))))
       else '{}'::jsonb end
    || case when coalesce(v_membership = 'member', false) then jsonb_build_object('my_past_attendance_count',
         (select count(*)::int from public.attendances t join public.sessions s on s.id = t.session_id
           where s.activity_id = a.id and t.user_id = v_uid and t.status = 'confirmed' and s.starts_at < now()))
       else '{}'::jsonb end;
end $$;
revoke all on function public.get_activity(uuid) from public;
grant execute on function public.get_activity(uuid) to anon, authenticated;

-- get_collectif: migration 35's, plus: a signed-out reader gets the organisers' roles only (no first name, no photo).
create or replace function public.get_collectif(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', c.description,
    'town_label', c.town_label,
    'lon', ST_X(c.town_point::geometry), 'lat', ST_Y(c.town_point::geometry),
    'organisers', coalesce((select jsonb_agg(case when auth.uid() is null then jsonb_build_object('role', m.role)
                     else jsonb_build_object('first_name', p.first_name, 'photo_url', p.photo_url, 'role', m.role) end
                     order by (m.role = 'responsable') desc, m.accepted_at, m.user_id)
                   from public.collectif_members m join public.profiles p on p.id = m.user_id
                  where m.collectif_id = c.id and m.status = 'active'), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(jsonb_build_object(
                     'id', x.id, 'title', x.title,
                     'next_starts_at', (select min(s.starts_at) from public.sessions s
                                         where s.activity_id = x.id and s.status = 'scheduled'
                                           and s.starts_at > now()))
                     order by x.start_date, x.id)
                   from public.activities x
                  where x.organised_by_collectif_id = c.id and x.archived_at is null
                    and x.published_at <= now()
                    and (auth.uid() is null or not public.is_blocked_between(x.organiser_id))),
                   '[]'::jsonb),
    'my_role', (select m.role from public.collectif_members m
                 where m.collectif_id = c.id and m.user_id = auth.uid() and m.status = 'active'))
  from public.collectifs c
  where c.id = p_id and not public.collectif_blocked_for_me(c.id)
    -- a collectif with no active responsable or organiser left (banned, say) is hidden
    and exists (select 1 from public.collectif_members m where m.collectif_id = c.id and m.status = 'active')
$$;
revoke all on function public.get_collectif(uuid) from public;
grant execute on function public.get_collectif(uuid) to anon, authenticated;

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
