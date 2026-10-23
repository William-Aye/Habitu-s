-- People who leave keep no seats; a block clears pending requests between the two; the welcome
-- person must still be the organiser or an active member.
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
      'organiser', (select jsonb_build_object('first_name', p.first_name, 'photo_url', p.photo_url)
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

-- ---------------------------------------------------------------------------------------------
-- Leaving (or being removed from) an activity frees the person's future seats and, if they were the
-- welcome person, clears that role. Past attendances stay: they are history.
create function public.activity_members_released() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.attendances t
   using public.sessions s
   where t.session_id = s.id and s.activity_id = old.activity_id
     and t.user_id = old.user_id and s.starts_at > now();
  update public.activities set welcome_member_id = null
   where id = old.activity_id and welcome_member_id = old.user_id
     and welcome_member_id is distinct from organiser_id;
  return null;
end $$;
revoke all on function public.activity_members_released() from public, anon, authenticated;
create trigger activity_members_left after delete on public.activity_members
  for each row execute function public.activity_members_released();
create trigger activity_members_removed after update of status on public.activity_members
  for each row when (new.status = 'removed' and old.status is distinct from 'removed')
  execute function public.activity_members_released();

-- ---------------------------------------------------------------------------------------------
-- A block clears the pending requests and invitations between the two people, both directions.
create function public.blocks_clear_pending() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.activity_members m
   using public.activities a
   where m.activity_id = a.id and m.status = 'pending'
     and ((a.organiser_id = new.blocker_id and m.user_id = new.blocked_id)
       or (a.organiser_id = new.blocked_id and m.user_id = new.blocker_id));
  delete from public.collectif_members m
   where m.status = 'invited'
     and ((m.user_id = new.blocked_id and exists (
             select 1 from public.collectif_members r
              where r.collectif_id = m.collectif_id and r.user_id = new.blocker_id
                and r.role = 'responsable' and r.status = 'active'))
       or (m.user_id = new.blocker_id and exists (
             select 1 from public.collectif_members r
              where r.collectif_id = m.collectif_id and r.user_id = new.blocked_id
                and r.role = 'responsable' and r.status = 'active')));
  return null;
end $$;
revoke all on function public.blocks_clear_pending() from public, anon, authenticated;
create trigger blocks_clear_pending after insert on public.blocks
  for each row execute function public.blocks_clear_pending();
