-- The activity page carries person ids (organiser, attendees) so a person can be reported or blocked.
-- Both functions are the latest versions (get_activity: migration 25, session_card: migration 29) plus 'id'.
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
      'organiser', (select jsonb_build_object('id', p.id, 'first_name', p.first_name, 'photo_url', p.photo_url)
                      from public.profiles p where p.id = a.organiser_id),
      'organised_by', case
        when a.organised_by_association_id is not null then
          (select jsonb_build_object('kind', 'association', 'id', x.id, 'name', x.name)
             from public.associations x where x.id = a.organised_by_association_id)
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

create or replace function public.session_card(p_session uuid, p_with_attendees boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
      'id', s.id,
      'starts_at', s.starts_at,
      'place_label', coalesce(s.place_label, a.place_label),
      'is_discovery', s.is_discovery,
      'status', s.status,
      'confirmed_count', c.n,
      'is_full', a.max_size is not null and c.n >= a.max_size,
      'my_attendance', (select jsonb_build_object('status', t.status, 'guest_count', t.guest_count)
                          from public.attendances t
                         where t.session_id = s.id and t.user_id = auth.uid()))
    || case when p_with_attendees then jsonb_build_object('attendees', coalesce(
         (select jsonb_agg(jsonb_build_object('id', p.id, 'first_name', p.first_name, 'photo_url', p.photo_url)
                           order by t.updated_at, p.id)
            from public.attendances t join public.profiles p on p.id = t.user_id
           where t.session_id = s.id and t.status = 'confirmed'
             and not public.is_blocked_between(t.user_id) and not public.is_banned(t.user_id)), '[]'::jsonb))
       else '{}'::jsonb end
    from public.sessions s
    join public.activities a on a.id = s.activity_id
    cross join lateral (select coalesce(sum(1 + t.guest_count), 0)::int as n
                          from public.attendances t
                         where t.session_id = s.id and t.status = 'confirmed') c
   where s.id = p_session;
$$;
