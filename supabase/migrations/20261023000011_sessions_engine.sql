-- Sessions engine: generation from the recurrence (DST-correct, 8-week horizon, nightly extension),
-- re-generation when the rule changes, the capacity rule on attendances, and the activity page RPCs.

-- ---------------------------------------------------------------------------------------------
-- Recurrence

-- Does local date p_d belong to the rule? (ISO weekdays: 1 = Monday ... 7 = Sunday.)
create function public.activity_date_matches(
  p_kind text, p_interval_days int, p_weekdays smallint[], p_start date, p_d date
) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select p_d >= p_start and case p_kind
    when 'weekly' then extract(isodow from p_d) = extract(isodow from p_start)
    when 'every_n_days' then (p_d - p_start) % p_interval_days = 0
    when 'weekdays' then extract(isodow from p_d)::smallint = any (p_weekdays)
    else false
  end;
$$;

-- Does a session start exactly on the activity's current rule (date and local wall time)?
-- Task 3 uses it to find the confirmed sessions kept at their old time after a rule change.
create function public.session_matches_rule(a public.activities, p_starts_at timestamptz) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select public.activity_date_matches(a.recurrence_kind, a.recurrence_interval_days, a.recurrence_weekdays,
                                      a.start_date, (p_starts_at at time zone a.timezone)::date)
     and (p_starts_at at time zone a.timezone)::time = a.start_time;
$$;

-- How far each activity's sessions have been generated. Sessions the organiser moved or cancelled
-- inside the horizon are therefore never re-created by the nightly run. Platform-only.
create table public.session_horizons (
  activity_id uuid primary key references public.activities on delete cascade,
  until date not null
);
alter table public.session_horizons enable row level security;
revoke all on public.session_horizons from public, anon, authenticated;

-- Inserts the missing 'scheduled' sessions up to p_until, at start_time local in the activity's
-- timezone (the wall time stays the same across DST changes), and returns how many it inserted.
-- Without p_from (triggers, nightly job) it starts after the generated horizon, from start_date or
-- today, and only creates sessions in the future. With p_from (platform backfill and tests) it
-- starts at greatest(start_date, p_from) and may create past-dated sessions.
-- A local date that already has a session of the activity is skipped (e.g. a confirmed session kept
-- at its old time after a rule change), so an activity never gets two generated sessions in a day.
-- Idempotent; archived activities get nothing.
create function public.generate_sessions(p_activity uuid, p_until date, p_from date default null)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.activities;
  v_from date;
  v_count int;
begin
  select * into a from public.activities where id = p_activity;
  if not found or a.archived_at is not null then
    return 0;
  end if;
  if p_from is null then
    v_from := greatest(a.start_date, (now() at time zone a.timezone)::date,
                       (select h.until + 1 from public.session_horizons h where h.activity_id = p_activity));
  else
    v_from := greatest(a.start_date, p_from);
  end if;

  insert into public.sessions (activity_id, starts_at)
  select a.id, (d::date + a.start_time) at time zone a.timezone
    from generate_series(v_from::timestamp, p_until::timestamp, interval '1 day') d
   where public.activity_date_matches(a.recurrence_kind, a.recurrence_interval_days,
                                      a.recurrence_weekdays, a.start_date, d::date)
     and (p_from is not null or (d::date + a.start_time) at time zone a.timezone > now())
     and not exists (select 1 from public.sessions s
                      where s.activity_id = a.id
                        and (s.starts_at at time zone a.timezone)::date = d::date)
  on conflict (activity_id, starts_at) do nothing;
  get diagnostics v_count = row_count;

  insert into public.session_horizons (activity_id, until) values (p_activity, p_until)
  on conflict (activity_id) do update
    set until = greatest(public.session_horizons.until, excluded.until);
  return v_count;
end $$;
revoke all on function public.generate_sessions(uuid, date, date) from public, anon, authenticated;
revoke all on function public.activity_date_matches(text, int, smallint[], date, date) from public, anon, authenticated;
revoke all on function public.session_matches_rule(public.activities, timestamptz) from public, anon, authenticated;

-- New activity, or its recurrence / start date / time / timezone changed: future 'scheduled'
-- sessions without a confirmed attendance that no longer match the rule are deleted, then the
-- 8-week horizon is generated again from today.
-- Sessions with a confirmed attendance are kept unchanged even when their time no longer matches
-- (session_matches_rule is false for them); Task 3 notifies their confirmed attendees.
create function public.activities_regenerate_sessions() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE'
     and (new.recurrence_kind, new.recurrence_interval_days, new.recurrence_weekdays,
          new.start_date, new.start_time, new.timezone)
         is not distinct from
         (old.recurrence_kind, old.recurrence_interval_days, old.recurrence_weekdays,
          old.start_date, old.start_time, old.timezone) then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    delete from public.sessions s
     where s.activity_id = new.id and s.status = 'scheduled' and s.starts_at > now()
       and not exists (select 1 from public.attendances t
                        where t.session_id = s.id and t.status = 'confirmed')
       and not public.session_matches_rule(new, s.starts_at);
    delete from public.session_horizons where activity_id = new.id;
  end if;
  perform public.generate_sessions(new.id, current_date + 56);
  return null;
end $$;
revoke all on function public.activities_regenerate_sessions() from public, anon, authenticated;
create trigger activities_regenerate_sessions
  after insert or update of recurrence_kind, recurrence_interval_days, recurrence_weekdays,
                            start_date, start_time, timezone
  on public.activities
  for each row execute function public.activities_regenerate_sessions();

-- Nightly: extend every non-archived activity to 8 weeks ahead.
select cron.schedule('extend-sessions', '30 2 * * *',
  $$ select public.generate_sessions(a.id, current_date + 56)
       from public.activities a where a.archived_at is null $$);

-- Backfill activities created before this migration.
select public.generate_sessions(a.id, current_date + 56) from public.activities a where a.archived_at is null;

-- ---------------------------------------------------------------------------------------------
-- Capacity: a confirmation (or adding a guest) is refused with 'session_full' when confirmed people
-- plus their guests would exceed max_size. The session row is locked (for update) before counting,
-- so concurrent confirmations for the same session are serialised.
create function public.attendances_capacity() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_max int;
  v_taken int;
begin
  if new.status <> 'confirmed' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'confirmed' and new.session_id = old.session_id
     and new.guest_count <= old.guest_count then
    return new;
  end if;
  select a.max_size into v_max
    from public.sessions s join public.activities a on a.id = s.activity_id
   where s.id = new.session_id
     for update of s;
  if v_max is null then
    return new;
  end if;
  select coalesce(sum(1 + t.guest_count), 0) into v_taken
    from public.attendances t
   where t.session_id = new.session_id and t.status = 'confirmed' and t.user_id <> new.user_id;
  if v_taken + 1 + new.guest_count > v_max then
    raise exception 'session_full';
  end if;
  return new;
end $$;
revoke all on function public.attendances_capacity() from public, anon, authenticated;
create trigger attendances_capacity before insert or update of status, guest_count, session_id
  on public.attendances
  for each row execute function public.attendances_capacity();

-- ---------------------------------------------------------------------------------------------
-- Page RPCs. Only public profile fields (first_name, photo_url) of other people are returned, and
-- attendee names / photos only to members and the organiser (decision 4); everyone gets counts.

-- One session as shown on the activity page / "Mes activités". Internal helper.
create function public.session_card(p_session uuid, p_with_attendees boolean) returns jsonb
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
         (select jsonb_agg(jsonb_build_object('first_name', p.first_name, 'photo_url', p.photo_url)
                           order by t.updated_at, p.id)
            from public.attendances t join public.profiles p on p.id = t.user_id
           where t.session_id = s.id and t.status = 'confirmed'), '[]'::jsonb))
       else '{}'::jsonb end
    from public.sessions s
    join public.activities a on a.id = s.activity_id
    cross join lateral (select coalesce(sum(1 + t.guest_count), 0)::int as n
                          from public.attendances t
                         where t.session_id = s.id and t.status = 'confirmed') c
   where s.id = p_session;
$$;
revoke all on function public.session_card(uuid, boolean) from public, anon, authenticated;

-- Activity page. Null when the activity does not exist, or is archived and the caller is neither
-- its organiser nor an admin.
create function public.get_activity(p_id uuid) returns jsonb
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
         (select p.first_name from public.profiles p where p.id = a.welcome_member_id))
       else '{}'::jsonb end;
end $$;
revoke all on function public.get_activity(uuid) from public;
grant execute on function public.get_activity(uuid) to anon, authenticated;

-- "Mes activités": non-archived activities the caller organises or joined (member or pending),
-- each with its next scheduled session and the caller's attendance, soonest first.
create function public.my_activities() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x.obj order by x.next_at nulls last, x.title, x.id)
      from (select a.id, a.title, ns.starts_at as next_at,
                   jsonb_build_object(
                     'id', a.id,
                     'title', a.title,
                     'place_label', a.place_label,
                     'category_icon', c.icon,
                     'is_organiser', a.organiser_id = v_uid,
                     'my_status', case when m.status in ('member', 'pending') then m.status else 'none' end,
                     'next_session', case when ns.id is not null then
                       public.session_card(ns.id, a.organiser_id = v_uid or m.status = 'member') end) as obj
              from public.activities a
              join public.categories c on c.id = a.category_id
              left join public.activity_members m on m.activity_id = a.id and m.user_id = v_uid
              left join lateral (select s.id, s.starts_at from public.sessions s
                                  where s.activity_id = a.id and s.status = 'scheduled'
                                    and s.starts_at > now()
                                  order by s.starts_at limit 1) ns on true
             where a.archived_at is null
               and (a.organiser_id = v_uid or m.status in ('member', 'pending'))) x),
    '[]'::jsonb);
end $$;
revoke all on function public.my_activities() from public, anon;
grant execute on function public.my_activities() to authenticated;
