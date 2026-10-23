-- Group chat: write rules, read state, page RPCs, retention.
-- The messages table, its select/insert/admin policies and indexes exist since 20261021000005.
-- Here: pinned sender and date, archive refusal, rate limit, own-message delete.

-- The 30-per-minute limit counts an insert-only log, never the messages: deleting messages frees nothing.
create table public.chat_send_log (
  user_id uuid not null references public.profiles on delete cascade,
  sent_at timestamptz not null default now()
);
create index chat_send_log_user_sent on public.chat_send_log (user_id, sent_at);
alter table public.chat_send_log enable row level security;
revoke all on public.chat_send_log from public, anon, authenticated;

-- Security definer so the guard can write the log; the caller's role is read from the `role` setting, which
-- a definer function does not change (current_user would be the owner). The service role and postgres
-- (role none or service_role) stay fully exempt.
create function public.messages_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('role', true) in ('anon', 'authenticated') then
    new.sender_id := auth.uid();
    new.created_at := now();
    if new.activity_id is not null then
      -- membership first, so a non-member gets the same refusal whether or not the activity is archived
      if not public.is_activity_member(new.activity_id)
         or exists (select 1 from public.activities a where a.id = new.activity_id and a.archived_at is not null) then
        raise exception 'not_allowed' using errcode = '42501';
      end if;
      -- Admins are exempt from the rate limit only.
      if not public.is_admin() then
        perform pg_advisory_xact_lock(hashtext('limits:' || coalesce(auth.uid()::text, '')));
        if (select count(*) from public.chat_send_log l
             where l.user_id = new.sender_id and l.sent_at > now() - interval '1 minute') >= 30 then
          raise exception 'limit_reached' using errcode = '42501';
        end if;
        insert into public.chat_send_log (user_id, sent_at) values (new.sender_id, now());
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.messages_guard() from public, anon, authenticated;
create trigger messages_guard before insert on public.messages
  for each row execute function public.messages_guard();

-- Keyset paging of a discussion.
drop index public.messages_activity_created;
create index messages_activity_created on public.messages (activity_id, created_at desc, id desc);

-- Messages are never edited: moderation only reads and deletes.
revoke update on public.messages from authenticated, anon;

create policy messages_delete_own on public.messages for delete to authenticated
  using (sender_id = auth.uid());

-- Per-user read state and mute, one row per discussion. Written only through the RPCs below.
create table public.chat_states (
  activity_id uuid not null references public.activities on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  primary key (activity_id, user_id)
);
create index chat_states_user on public.chat_states (user_id);
alter table public.chat_states enable row level security;
revoke all on public.chat_states from anon, authenticated;
grant select on public.chat_states to authenticated;
create policy chat_states_own on public.chat_states for select to authenticated
  using (user_id = auth.uid());

-- When a person joined a discussion: nothing before that counts as unread.
create function public.chat_joined_at(p_activity uuid, p_user uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select a.created_at from public.activities a where a.id = p_activity and a.organiser_id = p_user),
    (select m.joined_at from public.activity_members m
      where m.activity_id = p_activity and m.user_id = p_user and m.status = 'member'),
    now());
$$;
revoke all on function public.chat_joined_at(uuid, uuid) from public, anon, authenticated;

-- A page of the discussion, newest first. Null for anyone who is not a participant.
-- Keyset cursors on (created_at, id): the before cursor pages older messages; the after cursor returns
-- the oldest messages newer than it (so none is skipped), still displayed newest first.
create function public.chat_messages(
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
         where m.activity_id = p_activity
           and (m.created_at, m.id) > (p_after_at, coalesce(p_after_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
           and not public.is_blocked_between(m.sender_id)
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
         where m.activity_id = p_activity
           and (p_before_at is null
                or (m.created_at, m.id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
           and (p_after_at is null
                or (m.created_at, m.id) > (p_after_at, coalesce(p_after_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
           and not public.is_blocked_between(m.sender_id)
         order by m.created_at desc, m.id desc
         limit v_limit
      ) t;
  end if;
  return jsonb_build_object('archived', coalesce(v_archived, false), 'title', v_title,
    'organiser_id', v_organiser, 'muted', coalesce(v_muted, false), 'messages', v_rows);
end $$;
revoke all on function public.chat_messages(uuid, timestamptz, uuid, timestamptz, uuid, int) from public, anon;
grant execute on function public.chat_messages(uuid, timestamptz, uuid, timestamptz, uuid, int) to authenticated;

-- The discussions list: every activity I organise or belong to (archived ones only if they have messages).
create function public.my_chats() returns jsonb
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
                 where m.activity_id = a.id and m.sender_id <> v_uid
                   and m.created_at > greatest(coalesce(cs.last_read_at, j.joined), j.joined)
                   and not public.is_blocked_between(m.sender_id)
                 limit 99) u) as unread
        from (select o.id from public.activities o where o.organiser_id = v_uid
              union
              select am.activity_id from public.activity_members am
               where am.user_id = v_uid and am.status = 'member') mine
        join public.activities a on a.id = mine.id
        cross join lateral (select public.chat_joined_at(a.id, v_uid) as joined) j
        left join public.chat_states cs on cs.activity_id = a.id and cs.user_id = v_uid
        left join lateral (
          select m.body, m.created_at, m.sender_id, p.first_name
            from public.messages m join public.profiles p on p.id = m.sender_id
           where m.activity_id = a.id and not public.is_blocked_between(m.sender_id)
           order by m.created_at desc, m.id desc limit 1) lm on true
       where a.archived_at is null or exists (select 1 from public.messages m where m.activity_id = a.id)
    ) c), '[]'::jsonb);
end $$;
revoke all on function public.my_chats() from public, anon;
grant execute on function public.my_chats() to authenticated;

-- Total unread across my discussions for the tab badge, capped at 999.
create function public.my_unread_total() returns int
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
      cross join lateral (select public.chat_joined_at(mine.id, v_uid) as joined) j
      left join public.chat_states cs on cs.activity_id = mine.id and cs.user_id = v_uid
      join public.messages m on m.activity_id = mine.id and m.sender_id <> v_uid
       and m.created_at > greatest(coalesce(cs.last_read_at, j.joined), j.joined)
     where not public.is_blocked_between(m.sender_id)
     limit 999) u);
end $$;
revoke all on function public.my_unread_total() from public, anon;
grant execute on function public.my_unread_total() to authenticated;

create function public.mark_chat_read(p_activity uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_activity_member(p_activity) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into public.chat_states (activity_id, user_id, last_read_at)
    values (p_activity, auth.uid(), now())
    on conflict (activity_id, user_id) do update set last_read_at = excluded.last_read_at;
end $$;
revoke all on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.mark_chat_read(uuid) to authenticated;

-- A first mute leaves the unread count as it was: the row starts at the join time.
create function public.set_chat_muted(p_activity uuid, p_muted boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_activity_member(p_activity) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into public.chat_states (activity_id, user_id, last_read_at, muted)
    values (p_activity, auth.uid(), public.chat_joined_at(p_activity, auth.uid()), coalesce(p_muted, false))
    on conflict (activity_id, user_id) do update set muted = excluded.muted;
end $$;
revoke all on function public.set_chat_muted(uuid, boolean) from public, anon;
grant execute on function public.set_chat_muted(uuid, boolean) to authenticated;

-- Realtime: a signal only. Subscribers receive rows through the select policies.
alter publication supabase_realtime add table public.messages;

-- Retention: 12 months. The send log, only needed for the one-minute window, is kept an hour.
create function public.prune_messages() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
begin
  delete from public.chat_send_log where sent_at < now() - interval '1 hour';
  delete from public.messages where created_at < now() - interval '12 months';
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.prune_messages() from public, anon, authenticated;
-- pg_cron runs in UTC: 04:10 UTC is 05:10 or 06:10 in Paris, still a quiet hour.
select cron.schedule('prune-messages', '10 4 * * *', 'select public.prune_messages()');

-- Data export: migration 23's definition, plus chat_states.
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return jsonb_build_object(
    'account', (select jsonb_build_object(
        'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
        'providers', coalesce((select jsonb_agg(i.provider order by i.provider)
                                 from auth.identities i where i.user_id = u.id), '[]'::jsonb))
      from auth.users u where u.id = v_uid),
    'profile', (select to_jsonb(p) - 'home_area' || jsonb_build_object('home_area', ST_AsText(p.home_area::geometry))
                  from public.profiles p where p.id = v_uid),
    'interests', coalesce((select jsonb_agg(to_jsonb(i)) from public.user_interests i where i.user_id = v_uid), '[]'),
    'category_requests', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'requested_name', r.requested_name, 'status', r.status, 'created_at', r.created_at))
      from public.category_requests r where r.user_id = v_uid), '[]'),
    'activities_organised', coalesce((select jsonb_agg(to_jsonb(a) - 'embedding' - 'place'
        || jsonb_build_object('place', ST_AsText(a.place::geometry)))
      from public.activities a where a.organiser_id = v_uid), '[]'),
    'memberships', coalesce((select jsonb_agg(to_jsonb(m)) from public.activity_members m where m.user_id = v_uid), '[]'),
    'interests_in_activities', coalesce((select jsonb_agg(to_jsonb(ai)) from public.activity_interests ai where ai.user_id = v_uid), '[]'),
    'attendances', coalesce((select jsonb_agg(to_jsonb(t)) from public.attendances t where t.user_id = v_uid), '[]'),
    'messages_sent', coalesce((select jsonb_agg(to_jsonb(ms)) from public.messages ms where ms.sender_id = v_uid), '[]'),
    'reports_filed', coalesce((select jsonb_agg(jsonb_build_object(
        'id', rp.id, 'target_type', rp.target_type, 'target_id', rp.target_id, 'reason', rp.reason,
        'details', rp.details, 'status', rp.status, 'created_at', rp.created_at))
      from public.reports rp where rp.reporter_id = v_uid), '[]'),
    'blocks', coalesce((select jsonb_agg(to_jsonb(b)) from public.blocks b where b.blocker_id = v_uid), '[]'),
    'saved_searches', coalesce((select jsonb_agg(to_jsonb(s) - 'center'
        || jsonb_build_object('center', ST_AsText(s.center::geometry)))
      from public.saved_searches s where s.user_id = v_uid), '[]'),
    'association_waiters', coalesce((select jsonb_agg(to_jsonb(w)) from public.association_waiters w where w.user_id = v_uid), '[]'),
    'association_claims', coalesce((select jsonb_agg(to_jsonb(c)) from public.association_claims c where c.claimant_id = v_uid), '[]'),
    'feedback_sent', coalesce((select jsonb_agg(to_jsonb(f)) from public.feedback f where f.user_id = v_uid), '[]'),
    'session_feedback_sent', coalesce((select jsonb_agg(to_jsonb(sf)) from public.session_feedback sf where sf.user_id = v_uid), '[]'),
    'safety_tips_seen', coalesce((select jsonb_agg(to_jsonb(st)) from public.safety_tips_seen st where st.user_id = v_uid), '[]'),
    'notification_log', coalesce((select jsonb_agg(to_jsonb(nl)) from public.notification_log nl where nl.user_id = v_uid), '[]'),
    'push_tokens', coalesce((select jsonb_agg(jsonb_build_object('token', pt.token, 'platform', pt.platform, 'updated_at', pt.updated_at)) from public.push_tokens pt where pt.user_id = v_uid), '[]'),
    'collectif_memberships', coalesce((select jsonb_agg(to_jsonb(cm)) from public.collectif_members cm where cm.user_id = v_uid), '[]'),
    'collectifs_created', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'description', c.description, 'town_label', c.town_label,
        'town_point', ST_AsText(c.town_point::geometry), 'created_at', c.created_at))
      from public.collectifs c where c.created_by = v_uid), '[]'),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', n.kind, 'title', n.title, 'body', n.body, 'data', n.data, 'send_after', n.send_after,
        'sent_at', n.sent_at, 'failed_at', n.failed_at) order by n.id)
      from public.notification_outbox n where n.user_id = v_uid), '[]'),
    'chat_states', coalesce((select jsonb_agg(to_jsonb(cs)) from public.chat_states cs where cs.user_id = v_uid), '[]'),
    'organiser_stats', (select to_jsonb(o) from public.organiser_stats o where o.user_id = v_uid)
  );
end $$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
