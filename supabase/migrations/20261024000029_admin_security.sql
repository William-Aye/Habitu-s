-- Admin security: admin rights need a two-factor (aal2) session, every admin action is audited,
-- and accounts can be banned.

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false)
    and coalesce((auth.jwt() ->> 'aal') = 'aal2', false);
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

alter table public.profiles add column banned_at timestamptz;

-- Set when moderation removes an activity (or bans its organiser). While set, the organiser cannot bring it back
-- (guard in migration 35); only an admin can restore it.
alter table public.activities add column removed_by_moderation_at timestamptz;

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index admin_audit_log_created on public.admin_audit_log (created_at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;

create function public.admin_log(
  p_action text, p_target_type text, p_target_id uuid, p_details jsonb default '{}'
) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, details)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'));
$$;
revoke all on function public.admin_log(text, text, uuid, jsonb) from public, anon, authenticated;

create function public.admin_audit_page(
  p_before_at timestamptz default null, p_before_id uuid default null, p_limit int default 50
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc)
      from (select l.id, l.admin_id, l.action, l.target_type, l.target_id, l.details, l.created_at
              from public.admin_audit_log l
             where p_before_at is null
                or (l.created_at, l.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
             order by l.created_at desc, l.id desc
             limit greatest(1, least(coalesce(p_limit, 50), 200))) x), '[]'));
end $$;
revoke all on function public.admin_audit_page(timestamptz, uuid, int) from public, anon;
grant execute on function public.admin_audit_page(timestamptz, uuid, int) to authenticated;

create function public.is_banned(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = p_user and banned_at is not null);
$$;
revoke all on function public.is_banned(uuid) from public, anon;
grant execute on function public.is_banned(uuid) to authenticated;

create function public.ban_user(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- a finite far date: Auth's Go scanner returns 500 on 'infinity'
  update auth.users set banned_until = now() + interval '100 years' where id = p_user;
  update public.profiles set banned_at = coalesce(banned_at, now()) where id = p_user;
  update public.activities set archived_at = coalesce(archived_at, now()), removed_by_moderation_at = coalesce(removed_by_moderation_at, now())
   where organiser_id = p_user and (archived_at is null or removed_by_moderation_at is null);
  -- the after-delete trigger frees future attendances and the welcome role
  delete from public.activity_members where user_id = p_user;
  delete from public.collectif_members where user_id = p_user;
  -- sessions and refresh tokens are kept: Auth refuses a banned user's refresh with user_banned itself
end $$;
revoke all on function public.ban_user(uuid, text) from public, anon, authenticated;

-- A banned person's messages stay stored but are hidden from everyone.
drop policy messages_select_group on public.messages;
create policy messages_select_group on public.messages for select to authenticated
  using (activity_id is not null and public.is_activity_member(activity_id)
    and created_at >= public.chat_visible_since(activity_id)
    and not public.is_blocked_between(sender_id)
    and not public.is_banned(sender_id));

create or replace function public.chat_messages(
  p_activity uuid,
  p_before_at timestamptz default null, p_before_id uuid default null,
  p_after_at timestamptz default null, p_after_id uuid default null,
  p_limit int default 50
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_archived boolean;
  v_title text;
  v_organiser uuid;
  v_muted boolean;
  v_since timestamptz := public.chat_visible_since(p_activity);
  v_rows jsonb;
begin
  if auth.uid() is null or not public.is_activity_member(p_activity) then
    return null;
  end if;
  select a.archived_at is not null, a.title, a.organiser_id into v_archived, v_title, v_organiser
    from public.activities a where a.id = p_activity;
  select cs.muted into v_muted from public.chat_states cs where cs.activity_id = p_activity and cs.user_id = auth.uid();
  if p_after_at is not null and p_before_at is null then
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'body', t.body, 'created_at', t.created_at,
        'sender', jsonb_build_object('id', t.sender_id, 'first_name', t.first_name, 'photo_url', t.photo_url),
        'is_mine', t.sender_id = auth.uid()) order by t.created_at desc, t.id desc), '[]'::jsonb)
      into v_rows
      from (
        select m.id, m.body, m.created_at, m.sender_id, p.first_name, p.photo_url
          from public.messages m
          join public.profiles p on p.id = m.sender_id
         where m.activity_id = p_activity and m.created_at >= v_since
           and (m.created_at, m.id) > (p_after_at, coalesce(p_after_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
           and not public.is_blocked_between(m.sender_id)
           and not public.is_banned(m.sender_id)
         order by m.created_at asc, m.id asc
         limit v_limit
      ) t;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'body', t.body, 'created_at', t.created_at,
        'sender', jsonb_build_object('id', t.sender_id, 'first_name', t.first_name, 'photo_url', t.photo_url),
        'is_mine', t.sender_id = auth.uid()) order by t.created_at desc, t.id desc), '[]'::jsonb)
      into v_rows
      from (
        select m.id, m.body, m.created_at, m.sender_id, p.first_name, p.photo_url
          from public.messages m
          join public.profiles p on p.id = m.sender_id
         where m.activity_id = p_activity and m.created_at >= v_since
           and (p_before_at is null
                or (m.created_at, m.id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
           and (p_after_at is null
                or (m.created_at, m.id) > (p_after_at, coalesce(p_after_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
           and not public.is_blocked_between(m.sender_id)
           and not public.is_banned(m.sender_id)
         order by m.created_at desc, m.id desc
         limit v_limit
      ) t;
  end if;
  return jsonb_build_object('archived', coalesce(v_archived, false), 'title', v_title,
    'organiser_id', v_organiser, 'muted', coalesce(v_muted, false), 'messages', v_rows);
end $$;

create or replace function public.my_chats() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'activity_id', c.id, 'title', c.title,
      'last_message', case when c.lm_at is null then null else jsonb_build_object(
          'body', c.lm_body, 'created_at', c.lm_at, 'sender_first_name', c.lm_first_name,
          'is_mine', c.lm_sender = v_uid) end,
      'unread_count', c.unread, 'muted', c.muted) order by c.lm_at desc nulls last, c.title, c.id)
    from (
      select a.id, a.title, coalesce(cs.muted, false) as muted, lm.body as lm_body, lm.created_at as lm_at,
             lm.first_name as lm_first_name, lm.sender_id as lm_sender,
             (select count(*)::int from (
                select 1 from public.messages m
                 where m.activity_id = a.id and m.sender_id <> v_uid and m.created_at >= j.since
                   and m.created_at > greatest(coalesce(cs.last_read_at, j.joined), j.joined)
                   and not public.is_blocked_between(m.sender_id)
                   and not public.is_banned(m.sender_id)
                 limit 99) u) as unread
        from (select o.id from public.activities o where o.organiser_id = v_uid
              union
              select am.activity_id from public.activity_members am
               where am.user_id = v_uid and am.status = 'member') mine
        join public.activities a on a.id = mine.id
        cross join lateral (select public.chat_joined_at(a.id, v_uid) as joined,
                                   public.chat_visible_since(a.id) as since) j
        left join public.chat_states cs on cs.activity_id = a.id and cs.user_id = v_uid
        left join lateral (
          select m.body, m.created_at, m.sender_id, p.first_name
            from public.messages m join public.profiles p on p.id = m.sender_id
           where m.activity_id = a.id and m.created_at >= j.since and not public.is_blocked_between(m.sender_id)
             and not public.is_banned(m.sender_id)
           order by m.created_at desc, m.id desc limit 1) lm on true
       where a.archived_at is null or exists (select 1 from public.messages m where m.activity_id = a.id and m.created_at >= j.since)
    ) c), '[]'::jsonb);
end $$;

create or replace function public.my_unread_total() returns int
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return (select count(*)::int from (
    select 1
      from (select o.id from public.activities o where o.organiser_id = v_uid
            union
            select am.activity_id from public.activity_members am
             where am.user_id = v_uid and am.status = 'member') mine
      join public.activities a on a.id = mine.id
      cross join lateral (select public.chat_joined_at(mine.id, v_uid) as joined,
                                 public.chat_visible_since(mine.id) as since) j
      left join public.chat_states cs on cs.activity_id = mine.id and cs.user_id = v_uid
      join public.messages m on m.activity_id = mine.id and m.sender_id <> v_uid
       and m.created_at > greatest(coalesce(cs.last_read_at, j.joined), j.joined) and m.created_at >= j.since
     where not public.is_blocked_between(m.sender_id) and not public.is_banned(m.sender_id)
     limit 999) u);
end $$;

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
         (select jsonb_agg(jsonb_build_object('first_name', p.first_name, 'photo_url', p.photo_url)
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

create or replace function public.activity_roster(p_activity uuid)
returns table (user_id uuid, first_name text, photo_url text, status text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_activity_organiser(p_activity) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select m.user_id, p.first_name, p.photo_url, m.status
      from public.activity_members m
      join public.profiles p on p.id = m.user_id
     where m.activity_id = p_activity
       and m.status in ('member', 'pending')
       and not public.is_blocked_between(m.user_id) and not public.is_banned(m.user_id)
     order by m.status desc, m.joined_at, m.user_id;
end $$;

create or replace function public.collectif_candidates(p_collectif uuid)
returns table (user_id uuid, first_name text, photo_url text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_collectif_responsable(p_collectif) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select p.id, p.first_name, p.photo_url
      from public.profiles p
     where p.id in (select am.user_id
                      from public.activity_members am
                      join public.activities a on a.id = am.activity_id
                     where a.organised_by_collectif_id = p_collectif and am.status = 'member'
                       and a.archived_at is null)
       and p.first_name <> '' and p.age_confirmed
       and p.created_at <= now() - interval '24 hours'
       and not public.is_blocked_between(p.id) and not public.is_banned(p.id)
       and not exists (select 1 from public.collectif_members m
                        where m.collectif_id = p_collectif and m.user_id = p.id)
     order by p.first_name, p.id;
end $$;
