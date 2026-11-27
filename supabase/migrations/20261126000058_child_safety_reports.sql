-- Activities with children: a child_safety report reason, priority reports first in the admin queue,
-- and the bio and account date of a person asking to join (docs/superpowers/specs/2026-11-26-child-safety-design.md).

alter table public.reports drop constraint reports_reason_check;
alter table public.reports add constraint reports_reason_check check (reason = any (array[
  'unsafe_place', 'inappropriate_behaviour', 'harassment', 'fake_or_spam', 'did_not_happen', 'other', 'child_safety']));

-- A priority report: the child_safety reason anywhere, or any report on an activity with children,
-- one of its sessions or a message in its chat.
create function public.report_is_priority(p_reason text, p_target_type text, p_target_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_reason = 'child_safety'
      or case p_target_type
           when 'activity' then exists (select 1 from public.activities a
                                         where a.id = p_target_id and a.with_children)
           when 'session' then exists (select 1 from public.sessions s join public.activities a on a.id = s.activity_id
                                        where s.id = p_target_id and a.with_children)
           when 'message' then exists (select 1 from public.messages m join public.activities a on a.id = m.activity_id
                                        where m.id = p_target_id and a.with_children)
           else false end;
$$;
revoke all on function public.report_is_priority(text, text, uuid) from public, anon, authenticated;

-- New parameter and new output columns: drop and recreate, with the same grants as before.
drop function public.admin_reports(text, timestamptz, uuid, integer);
drop function public.activity_roster(uuid);

CREATE OR REPLACE FUNCTION public.admin_reports(p_status text DEFAULT 'open'::text, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 30, p_priority boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'open_count', (select count(*)::int from public.reports where status = 'open'),
    'priority_open_count', (select count(*)::int from public.reports r
                             where r.status = 'open' and public.report_is_priority(r.reason, r.target_type, r.target_id)),
    'items', coalesce((
      select jsonb_agg(x.j order by x.created_at desc, x.id desc)
        from (
          select r.id, r.created_at, jsonb_build_object(
              'id', r.id, 'created_at', r.created_at, 'source', r.source,
              'target_type', r.target_type, 'target_id', r.target_id,
              'reason', r.reason, 'details', r.details, 'status', r.status,
              'priority', public.report_is_priority(r.reason, r.target_type, r.target_id),
              'reporter_first_name', (select p.first_name from public.profiles p where p.id = r.reporter_id),
              'target_owner', case when r.target_owner is null then null
                else jsonb_build_object('id', r.target_owner,
                       'first_name', (select p.first_name from public.profiles p where p.id = r.target_owner)) end,
              'preview', case r.target_type
                when 'activity' then (select concat_ws(' - ', a.title, a.place_label) from public.activities a where a.id = r.target_id)
                when 'session' then (select to_char(s.starts_at at time zone a.timezone, 'YYYY-MM-DD HH24:MI')
                                       from public.sessions s join public.activities a on a.id = s.activity_id
                                      where s.id = r.target_id)
                when 'message' then (select sn.snapshot ->> 'body' from public.report_snapshots sn where sn.report_id = r.id)
                when 'association' then (select x.name from public.associations x where x.id = r.target_id)
                when 'collectif' then (select c.name from public.collectifs c where c.id = r.target_id)
                when 'user' then (select p.first_name from public.profiles p where p.id = r.target_id)
                end) as j
            from public.reports r
           where (p_status = 'all' or r.status = p_status)
             and (not coalesce(p_priority, false) or public.report_is_priority(r.reason, r.target_type, r.target_id))
             and (p_before_at is null or (r.created_at, r.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
           order by r.created_at desc, r.id desc
           limit greatest(1, least(coalesce(p_limit, 30), 100))) x), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.activity_roster(p_activity uuid)
 RETURNS TABLE(user_id uuid, first_name text, photo_url text, status text, bio text, member_since timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null or not public.is_activity_organiser(p_activity) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    -- A request also shows the neutral facts the organiser decides on: the bio and "Membre depuis".
    select m.user_id, p.first_name, p.photo_url, m.status,
           case when m.status = 'pending' then p.bio end,
           case when m.status = 'pending' then p.created_at end
      from public.activity_members m
      join public.profiles p on p.id = m.user_id
     where m.activity_id = p_activity
       and m.status in ('member', 'pending')
       and not public.is_blocked_between(m.user_id) and not public.is_banned(m.user_id)
     order by m.status desc, m.joined_at, m.user_id;
end $function$;

revoke all on function public.admin_reports(text, timestamptz, uuid, integer, boolean) from public, anon;
grant execute on function public.admin_reports(text, timestamptz, uuid, integer, boolean) to authenticated;
revoke all on function public.activity_roster(uuid) from public, anon;
grant execute on function public.activity_roster(uuid) to authenticated;

-- The organiser decides on a request from a bio and a profile: a worrying one must reach the admins,
-- so the organiser may also report a person who asked to join, or whose request was declined.
-- Same body as migration 30, with one more case for 'user'.
create or replace function public.reports_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_ok boolean;
begin
  if new.target_type not in ('user', 'activity', 'message', 'association', 'collectif', 'session') then
    return new;  -- the check constraint refuses it
  end if;
  -- Automatic reports come from the spam triggers below (nested), never from a client.
  if new.source = 'auto' and pg_trigger_depth() > 1 then
    new.reporter_id := null;
    new.target_owner := public.report_target_owner(new.target_type, new.target_id);
    return new;
  end if;
  if current_setting('role', true) in ('anon', 'authenticated') then
    if v_uid is null then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    v_ok := case new.target_type
      when 'activity' then public.get_activity(new.target_id) is not null
      when 'session' then exists (select 1 from public.sessions s
                                   where s.id = new.target_id and public.get_activity(s.activity_id) is not null)
      when 'message' then exists (select 1 from public.messages m
                                   where m.id = new.target_id and m.activity_id is not null
                                     and public.is_activity_member(m.activity_id)
                                     and m.created_at >= public.chat_visible_since(m.activity_id)
                                     and not exists (select 1 from public.blocks b where b.blocker_id = m.sender_id and b.blocked_id = v_uid)
                                     and not public.is_banned(m.sender_id))
      when 'user' then new.target_id <> v_uid
                       and exists (select 1 from public.profiles p where p.id = new.target_id)
                       and not exists (select 1 from public.blocks b where b.blocker_id = new.target_id and b.blocked_id = v_uid)
                       and (exists (
                              select 1
                                from (select a.id as aid, a.organiser_id as uid from public.activities a
                                      union all
                                      select m.activity_id, m.user_id from public.activity_members m
                                       where m.status = 'member') mine
                                join (select a.id as aid, a.organiser_id as uid from public.activities a
                                      union all
                                      select m.activity_id, m.user_id from public.activity_members m
                                       where m.status = 'member') theirs on theirs.aid = mine.aid
                               where mine.uid = v_uid and theirs.uid = new.target_id)
                            or exists (select 1 from public.activities a
                                        where a.organiser_id = new.target_id and a.archived_at is null
                                          and public.get_activity(a.id) is not null)
                            -- the organiser, about a person who asked to join or whose request was declined
                            or exists (select 1 from public.activities a
                                         join public.activity_members m on m.activity_id = a.id
                                        where a.organiser_id = v_uid and m.user_id = new.target_id
                                          and m.status in ('pending', 'removed')))
      when 'association' then exists (select 1 from public.associations x
                                       where x.id = new.target_id and (to_jsonb(x) ->> 'removed_at') is null)
      when 'collectif' then public.get_collectif(new.target_id) is not null
    end;
    if not coalesce(v_ok, false) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    -- a client cannot choose who reports, how, or the state
    if new.reporter_id is null then
      new.reporter_id := v_uid;
    end if;
    new.source := 'user';
    new.status := 'open';
    perform public.take_limit('report', 5, interval '1 hour');
  end if;
  new.target_owner := public.report_target_owner(new.target_type, new.target_id);
  return new;
end $$;
revoke all on function public.reports_guard() from public, anon, authenticated;
