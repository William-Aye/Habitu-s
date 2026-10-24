-- Final fixes after the safety review.
-- 1. A banned person can no longer write (one shared BEFORE INSERT trigger); deletes stay allowed.
-- 2. Removed clubs and archived activities are no longer readable through the table API.
-- 3. Admin: club search for merging, banned list and lifting a ban.
-- 4. Orphaned collectifs are hidden from the collectif page (search is in migration 31).
-- 5. The public_profiles view is dropped.

-- ---------------------------------------------------------------------------------------------
-- 1. Banned writers
create function public.refuse_banned_writer() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('role', true) in ('anon', 'authenticated')
     and auth.uid() is not null and public.is_banned(auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.refuse_banned_writer() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['activities', 'collectifs', 'collectif_members', 'messages', 'associations',
    'activity_members', 'attendances', 'reports', 'feedback', 'association_claims', 'category_requests', 'blocks']
  loop
    execute format('create trigger refuse_banned_writer before insert on public.%I
                      for each row execute function public.refuse_banned_writer()', t);
  end loop;
end $$;

-- messages_notify: migration 28's, plus the banned-sender guard.
create or replace function public.messages_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- a banned sender's messages notify nobody (defence in depth: the insert trigger already refuses them)
  if public.is_banned(new.sender_id) then
    return null;
  end if;
  insert into public.notification_outbox (user_id, kind, title, body, data, dedupe_key, send_after)
  select r.user_id, 'chat_message', x.title, x.body,
         jsonb_build_object('activity_id', new.activity_id, 'kind', 'chat_message'), r.dedupe_key, now()
    from (
      select u.user_id, p.language,
             'chat:' || new.activity_id || ':' || u.user_id || ':' || floor(extract(epoch from now()) / 900) as dedupe_key
        from (select a.organiser_id as user_id from public.activities a where a.id = new.activity_id
              union
              select m.user_id from public.activity_members m
               where m.activity_id = new.activity_id and m.status = 'member') u
        join public.profiles p on p.id = u.user_id
        left join public.chat_states cs on cs.activity_id = new.activity_id and cs.user_id = u.user_id
       where u.user_id <> new.sender_id
         and coalesce(cs.muted, false) = false
         and (cs.last_read_at is null or cs.last_read_at <= now() - interval '2 minutes')
         and not exists (select 1 from public.blocks b
                          where (b.blocker_id = u.user_id and b.blocked_id = new.sender_id)
                             or (b.blocker_id = new.sender_id and b.blocked_id = u.user_id))
    ) r
    cross join lateral public.notif_text('chat_message', case when r.language = 'en' then 'en' else 'fr' end) x
   where not exists (select 1 from public.notification_outbox o where o.dedupe_key = r.dedupe_key)
  on conflict (dedupe_key) do nothing;
  return null;
end $$;
revoke all on function public.messages_notify() from public, anon, authenticated;

-- Moderation removal cannot be undone by the organiser, and a moderated activity takes nothing new.
create function public.activities_moderation_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('role', true) in ('anon', 'authenticated') and not public.is_admin()
     and (new.removed_by_moderation_at is distinct from old.removed_by_moderation_at
          or (old.removed_by_moderation_at is not null and new.archived_at is distinct from old.archived_at)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.activities_moderation_guard() from public, anon, authenticated;
create trigger activities_moderation_guard before update of archived_at, removed_by_moderation_at on public.activities
  for each row execute function public.activities_moderation_guard();

create function public.refuse_moderated_activity() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_activity uuid;
begin
  if current_setting('role', true) not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_table_name = 'attendances' then
    select s.activity_id into v_activity from public.sessions s where s.id = new.session_id;
  else
    v_activity := new.activity_id;
  end if;
  if exists (select 1 from public.activities a where a.id = v_activity and a.removed_by_moderation_at is not null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.refuse_moderated_activity() from public, anon, authenticated;
create trigger refuse_moderated_activity before insert on public.sessions
  for each row execute function public.refuse_moderated_activity();
create trigger refuse_moderated_activity before insert on public.activity_members
  for each row execute function public.refuse_moderated_activity();
create trigger refuse_moderated_activity before insert on public.attendances
  for each row execute function public.refuse_moderated_activity();

-- ---------------------------------------------------------------------------------------------
-- 2. Removed content stays out of the table API
drop policy associations_select on public.associations;
create policy associations_select on public.associations for select to anon, authenticated
  using (removed_at is null or public.is_admin());

drop policy activities_select on public.activities;
create policy activities_select on public.activities for select to anon, authenticated
  using (archived_at is null or organiser_id = auth.uid() or public.is_admin());

-- The organiser cannot delete the evidence of a moderated activity (migration 4's policy plus the mark).
drop policy activities_delete on public.activities;
create policy activities_delete on public.activities for delete to authenticated
  using (organiser_id = auth.uid() and removed_by_moderation_at is null);

-- Private files are reached only through the audited admin RPCs: no API role selects the path columns.
-- (Inserts need only insert privilege; the app never reads these columns back.)
revoke select on public.feedback from authenticated;
grant select (id, user_id, type, body, app_version, device_model, status, created_at, source)
  on public.feedback to authenticated;
revoke select (document_path) on public.association_claims from authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Admin: club search for the merge picker, banned list, lifting a ban
create function public.admin_search_associations(p_query text, p_limit int default 20) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'city', x.city) order by x.name, x.id)
      from (select a.id, a.name, a.city
              from public.associations a
             where a.removed_at is null
               and a.name ilike '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
             order by a.name, a.id
             limit greatest(1, least(coalesce(p_limit, 20), 50))) x), '[]'::jsonb);
end $$;
revoke all on function public.admin_search_associations(text, int) from public, anon;
grant execute on function public.admin_search_associations(text, int) to authenticated;

create function public.admin_banned_users(p_query text default null, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'first_name', x.first_name, 'banned_at', x.banned_at)
                     order by x.banned_at desc, x.id)
      from (select p.id, p.first_name, p.banned_at
              from public.profiles p
             where p.banned_at is not null
               and (v_q = '' or p.first_name ilike '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
             order by p.banned_at desc, p.id
             limit greatest(1, least(coalesce(p_limit, 50), 200))) x), '[]'::jsonb);
end $$;
revoke all on function public.admin_banned_users(text, int) from public, anon;
grant execute on function public.admin_banned_users(text, int) to authenticated;

-- Lifting a ban restores sign-in. Content archived by the ban stays archived.
create function public.admin_lift_ban(p_user uuid, p_statement text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_statement text := btrim(coalesce(p_statement, ''));
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if char_length(v_statement) not between 10 and 1000 then
    raise exception 'invalid_statement' using errcode = '23514';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and banned_at is not null) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update auth.users set banned_until = null where id = p_user;
  update public.profiles set banned_at = null where id = p_user;
  perform public.admin_log('ban_lifted', 'user', p_user, jsonb_build_object('statement', v_statement));
end $$;
revoke all on function public.admin_lift_ban(uuid, text) from public, anon;
grant execute on function public.admin_lift_ban(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. get_collectif: migration 13's, plus the orphan guard.
create or replace function public.get_collectif(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', c.description,
    'town_label', c.town_label,
    'lon', ST_X(c.town_point::geometry), 'lat', ST_Y(c.town_point::geometry),
    'organisers', coalesce((select jsonb_agg(jsonb_build_object(
                     'first_name', p.first_name, 'photo_url', p.photo_url, 'role', m.role)
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

-- ---------------------------------------------------------------------------------------------
-- 5. Nobody can list members through a view any more.
drop view public.public_profiles;
