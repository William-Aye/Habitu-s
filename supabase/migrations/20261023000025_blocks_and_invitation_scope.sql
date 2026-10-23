-- Blocks hide and remove (get_activity, joining, memberships), and collectif invitations are limited
-- to people who share an activity with the collectif; the daily cap counts every invitation sent.
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

-- Joining is refused between a user and the organiser when either blocked the other.
create function public.activity_members_block_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() and exists (
       select 1 from public.activities a
        where a.id = new.activity_id and new.user_id = auth.uid() and public.is_blocked_between(a.organiser_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.activity_members_block_guard() from public, anon, authenticated;
create trigger activity_members_block_guard before insert on public.activity_members
  for each row execute function public.activity_members_block_guard();

-- A block removes every membership between the two people (any status) in each other's activities
-- (the leaving trigger then frees their future seats), and the pending collectif invitations.
create or replace function public.blocks_clear_pending() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.activity_members m
   using public.activities a
   where m.activity_id = a.id
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

-- Invitations: who sent them, an insert-only log for the daily cap, and the shared-activity rule.
alter table public.collectif_members
  add column invited_by uuid references public.profiles on delete set null;

create table public.collectif_invite_log (
  invited_by uuid not null references public.profiles on delete cascade,
  invited_at timestamptz not null default now()
);
create index collectif_invite_log_by on public.collectif_invite_log (invited_by, invited_at);
alter table public.collectif_invite_log enable row level security;
revoke all on public.collectif_invite_log from public, anon, authenticated;

-- The checks need profiles and the log, which API roles cannot read: a definer helper does them for
-- the caller (the responsable of the collectif) and the trigger below, which sees the real role, calls it.
create function public.collectif_invite_register(p_collectif uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_collectif_responsable(p_collectif) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- Only people who are members of a live activity organised by this collectif, and who could
  -- organise themselves, can be invited.
  if not exists (
       select 1
         from public.activity_members am
         join public.activities a on a.id = am.activity_id
         join public.profiles p on p.id = am.user_id
        where am.user_id = p_user and am.status = 'member'
          and a.organised_by_collectif_id = p_collectif and a.archived_at is null
          and p.first_name <> '' and p.age_confirmed and p.created_at <= now() - interval '24 hours'
          and not public.is_blocked_between(p.id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('limits:' || auth.uid()::text));
  if (select count(*) from public.collectif_invite_log l
       where l.invited_by = auth.uid() and l.invited_at > now() - interval '24 hours') >= 10 then
    raise exception 'limit_reached' using errcode = '42501';
  end if;
  insert into public.collectif_invite_log (invited_by) values (auth.uid());
  delete from public.collectif_invite_log where invited_at < now() - interval '2 days';
end $$;
revoke all on function public.collectif_invite_register(uuid, uuid) from public, anon;
grant execute on function public.collectif_invite_register(uuid, uuid) to authenticated;

create or replace function public.collectif_members_invite_limit() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() and new.status = 'invited' then
    new.invited_by := auth.uid();
    perform public.collectif_invite_register(new.collectif_id, new.user_id);
  end if;
  return new;
end $$;
