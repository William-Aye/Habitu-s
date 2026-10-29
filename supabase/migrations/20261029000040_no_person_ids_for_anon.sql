-- DB-2 (pre-launch security review): no person id reaches anonymous visitors.
-- Organisers' ids were listed to anon by four paths, and with the old fixed avatar path an id gave
-- the person's photo. Avatars now have unguessable names (migration 39), so an id alone shows no
-- face, but an id still links one person across every activity and collectif they run. Nothing
-- signed-out needs it: the app's signed-out activity page only says "organised by a member", and
-- the web pages never carry person data. So:
--   * get_activity returns an empty organiser object to anon (signed-in people keep id, first
--     name and photo). This replaces the sub-project 8 ruling "anon gets the organiser id only".
--   * anon loses activities.organiser_id (column grants, see migration 38), collectifs.created_by,
--     and collectif_members entirely (get_collectif gives anon the organisers' roles only).
--   * organiser_badges (a definer view over organiser_stats) lists every organiser with counts and
--     is not used by the app (no badges in Release 1): no client role may read it.
-- get_activity is migration 36's with the anon organiser changed, and search_path pinned to
-- public, pg_temp (PostGIS calls are schema-qualified).

revoke select (organiser_id) on public.activities from anon;

revoke select on public.collectifs from anon;
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'collectifs'
     and column_name not in ('created_by', 'embedding', 'embedding_hash');
  execute format('grant select (%s) on public.collectifs to anon', v_cols);
end $$;

revoke select on public.collectif_members from anon;
drop policy collectif_members_select_active on public.collectif_members;
create policy collectif_members_select_active on public.collectif_members for select to authenticated
  using (status = 'active');

revoke all on public.organiser_badges from anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_activity(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      -- anon: an empty object (an organiser exists, nothing identifies them); see DB-2.
      'organiser', (select case when v_uid is null then '{}'::jsonb
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
      'lon', extensions.ST_X(a.place::extensions.geometry),
      'lat', extensions.ST_Y(a.place::extensions.geometry),
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
end $function$;
