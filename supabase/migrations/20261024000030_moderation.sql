-- Moderation: reports on every target, decisions with a statement of reasons, outcome notices,
-- insert-only write limits and the first word filter.

-- ---------------------------------------------------------------------------------------------
-- Limits: an insert-only log, so deleting a row never frees a slot.
create table public.limit_log (
  id bigserial primary key,
  user_id uuid not null references public.profiles on delete cascade,
  kind text not null,
  at timestamptz not null default now()
);
create index limit_log_lookup on public.limit_log (user_id, kind, at);
alter table public.limit_log enable row level security;
revoke all on public.limit_log from public, anon, authenticated;

-- Internal: locks per user, counts, refuses or logs. Admins and sessions without a user are exempt.
create function public.take_limit(p_kind text, p_max int, p_window interval) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or public.is_admin() then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('limits:' || v_uid::text));
  if (select count(*) from public.limit_log l
       where l.user_id = v_uid and l.kind = p_kind and l.at > now() - p_window) >= p_max then
    raise exception 'limit_reached' using errcode = '42501';
  end if;
  insert into public.limit_log (user_id, kind) values (v_uid, p_kind);
end $$;
revoke all on function public.take_limit(text, int, interval) from public, anon, authenticated;

create function public.feedback_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('role', true) in ('anon', 'authenticated') and auth.uid() is not null then
    perform public.take_limit('feedback', 3, interval '1 hour');
  end if;
  return new;
end $$;
revoke all on function public.feedback_limit() from public, anon, authenticated;
create trigger feedback_limit before insert on public.feedback
  for each row execute function public.feedback_limit();

create function public.category_requests_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('role', true) in ('anon', 'authenticated') then
    perform public.take_limit('category_request', 5, interval '1 day');
  end if;
  return new;
end $$;
revoke all on function public.category_requests_limit() from public, anon, authenticated;
create trigger category_requests_limit before insert on public.category_requests
  for each row execute function public.category_requests_limit();

create function public.activity_members_join_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('role', true) in ('anon', 'authenticated') and new.user_id = auth.uid() then
    perform public.take_limit('join', 20, interval '1 day');
  end if;
  return new;
end $$;
revoke all on function public.activity_members_join_limit() from public, anon, authenticated;
create trigger activity_members_join_limit before insert on public.activity_members
  for each row execute function public.activity_members_join_limit();

-- ---------------------------------------------------------------------------------------------
-- Reports: every target type, the harassment reason, source and owner.
alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('user', 'activity', 'message', 'association', 'collectif', 'session'));
alter table public.reports drop constraint reports_reason_check;
alter table public.reports add constraint reports_reason_check
  check (reason in ('unsafe_place', 'inappropriate_behaviour', 'harassment', 'fake_or_spam', 'did_not_happen', 'other'));
alter table public.reports add column source text not null default 'user' check (source in ('user', 'auto'));
alter table public.reports add column target_owner uuid references public.profiles on delete set null;

-- Reporters read their own reports without the decision details, the owner or the moderator: those come
-- only through my_moderation_notices and the admin RPCs.
revoke select on public.reports from authenticated;
grant select (id, reporter_id, target_type, target_id, reason, details, status, created_at, decided_at, source)
  on public.reports to authenticated;

-- The person responsible for a target: author, organiser, creator or the user themself.
create function public.report_target_owner(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select case p_type
    when 'user' then (select p.id from public.profiles p where p.id = p_id)
    when 'activity' then (select a.organiser_id from public.activities a where a.id = p_id)
    when 'session' then (select a.organiser_id from public.sessions s
                           join public.activities a on a.id = s.activity_id where s.id = p_id)
    when 'message' then (select m.sender_id from public.messages m where m.id = p_id)
    when 'association' then (select coalesce(x.claimed_by, x.created_by) from public.associations x where x.id = p_id)
    when 'collectif' then (select coalesce(
        (select m.user_id from public.collectif_members m
          where m.collectif_id = c.id and m.role = 'responsable' and m.status = 'active'), c.created_by)
        from public.collectifs c where c.id = p_id)
  end;
$$;
revoke all on function public.report_target_owner(text, uuid) from public, anon, authenticated;

-- Replaces reports_check_message: every target type must be visible to the reporter, with one refusal
-- for "invisible" and "missing". It also pins the reporter, source and status and applies the limit.
drop trigger reports_check_message on public.reports;
drop function public.reports_check_message();

create function public.reports_guard() returns trigger
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
                                          and public.get_activity(a.id) is not null))
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
create trigger reports_guard before insert on public.reports
  for each row execute function public.reports_guard();

-- ---------------------------------------------------------------------------------------------
-- Notification texts: migration 28's set, plus the two moderation kinds (generic, no name).
create or replace function public.notif_text(p_kind text, p_lang text) returns table (title text, body text)
language sql immutable set search_path = public, pg_temp as $$
  select case when p_lang = 'en' then t.title_en else t.title_fr end,
         case when p_lang = 'en' then t.body_en else t.body_fr end
    from (values
      ('session_reminder', 'Rappel', 'Vous avez une activité demain. Serez-vous là ?',
                           'Reminder', 'You have an activity tomorrow. Will you be there?'),
      ('new_member', 'Nouveau membre', 'Quelqu''un a rejoint votre activité.',
                     'New member', 'Someone joined your activity.'),
      ('join_request', 'Nouvelle demande', 'Une personne souhaite rejoindre votre activité.',
                       'New request', 'Someone would like to join your activity.'),
      ('request_accepted', 'Demande acceptée', 'Votre demande a été acceptée.',
                           'Request accepted', 'Your request was accepted.'),
      ('late_cancellation', 'Désistement tardif', 'Une personne ne viendra pas à une prochaine séance.',
                             'Late cancellation', 'Someone can no longer make an upcoming session.'),
      ('session_cancelled', 'Séance annulée', 'Une séance de votre activité est annulée.',
                             'Session cancelled', 'A session of your activity is cancelled.'),
      ('session_moved', 'Séance modifiée', 'Une séance de votre activité a changé.',
                         'Session changed', 'A session of your activity has changed.'),
      ('session_rule_changed', 'Séance modifiée', 'Une séance de votre activité a changé.',
                                'Session changed', 'A session of your activity has changed.'),
      ('collectif_invitation', 'Invitation', 'Vous êtes invité à organiser un collectif.',
                                'Invitation', 'You are invited to organise a collective.'),
      ('chat_message', 'Nouveau message', 'Nouveau message dans une de vos activités.',
                       'New message', 'New message in one of your activities.'),
      ('report_handled', 'Information de modération', 'Ouvrez l''application pour voir le détail.',
                         'Moderation information', 'Open the app to see the details.'),
      ('moderation_notice', 'Information de modération', 'Ouvrez l''application pour voir le détail.',
                            'Moderation information', 'Open the app to see the details.')
    ) as t(kind, title_fr, body_fr, title_en, body_en)
   where t.kind = p_kind
  union all
  select case when p_lang = 'en' then 'Notification' else 'Notification' end,
         case when p_lang = 'en' then 'Open the app to see the details.' else 'Ouvrez l''application pour voir le détail.' end
   where p_kind not in ('session_reminder', 'new_member', 'join_request', 'request_accepted', 'late_cancellation',
                        'session_cancelled', 'session_moved', 'session_rule_changed', 'collectif_invitation',
                        'chat_message', 'report_handled', 'moderation_notice');
$$;

-- ---------------------------------------------------------------------------------------------
-- Admin queue
create function public.admin_reports(
  p_status text default 'open', p_before_at timestamptz default null, p_before_id uuid default null, p_limit int default 30
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'open_count', (select count(*)::int from public.reports where status = 'open'),
    'items', coalesce((
      select jsonb_agg(x.j order by x.created_at desc, x.id desc)
        from (
          select r.id, r.created_at, jsonb_build_object(
              'id', r.id, 'created_at', r.created_at, 'source', r.source,
              'target_type', r.target_type, 'target_id', r.target_id,
              'reason', r.reason, 'details', r.details, 'status', r.status,
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
             and (p_before_at is null or (r.created_at, r.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
           order by r.created_at desc, r.id desc
           limit greatest(1, least(coalesce(p_limit, 30), 100))) x), '[]'::jsonb));
end $$;
revoke all on function public.admin_reports(text, timestamptz, uuid, int) from public, anon;
grant execute on function public.admin_reports(text, timestamptz, uuid, int) to authenticated;

create function public.admin_decide_report(p_report uuid, p_decision text, p_statement text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.reports;
  v_statement text := btrim(coalesce(p_statement, ''));
  v_status text;
  v_owner uuid;
  v_closed int := 0;
  o record;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('dismiss', 'warn', 'remove', 'ban') then
    raise exception 'invalid_decision' using errcode = '23514';
  end if;
  if char_length(v_statement) not between 10 and 1000 then
    raise exception 'invalid_statement' using errcode = '23514';
  end if;
  select * into r from public.reports where id = p_report for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if r.status <> 'open' then
    raise exception 'already_decided' using errcode = '42501';
  end if;
  v_status := case when p_decision = 'dismiss' then 'dismissed' else 'actioned' end;
  v_owner := coalesce(r.target_owner, public.report_target_owner(r.target_type, r.target_id));
  -- Nobody bans or removes an admin (or themself) through a report.
  if v_owner is not null
     and (p_decision = 'ban' or (p_decision = 'remove' and r.target_type = 'user'))
     and (v_owner = auth.uid()
          or exists (select 1 from public.profiles p where p.id = v_owner and p.role = 'admin')) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  -- Effects. A target that is already gone is not an error.
  if p_decision = 'remove' then
    case r.target_type
      when 'message' then
        delete from public.messages where id = r.target_id;
      when 'activity' then
        update public.activities set archived_at = coalesce(archived_at, now()),
               removed_by_moderation_at = coalesce(removed_by_moderation_at, now())
         where id = r.target_id;
      when 'session' then
        update public.sessions set status = 'cancelled_by_organiser'
         where id = r.target_id and status = 'scheduled';
        -- the activity is marked as moderated only when the organiser had already archived it
        update public.activities set removed_by_moderation_at = coalesce(removed_by_moderation_at, now())
         where id = (select s.activity_id from public.sessions s where s.id = r.target_id)
           and archived_at is not null;
      when 'association' then
        -- associations.removed_at arrives with the claims migration
        if exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'associations' and column_name = 'removed_at') then
          execute 'update public.associations set removed_at = coalesce(removed_at, now()) where id = $1'
            using r.target_id;
        end if;
      when 'collectif' then
        delete from public.collectifs where id = r.target_id;
      when 'user' then
        update public.activities set archived_at = coalesce(archived_at, now()),
               removed_by_moderation_at = coalesce(removed_by_moderation_at, now())
         where organiser_id = r.target_id;
        delete from public.messages where sender_id = r.target_id;
    end case;
  elsif p_decision = 'ban' and v_owner is not null then
    perform public.ban_user(v_owner, v_statement);
  end if;

  -- Every open report on the same target gets the same decision.
  for o in
    update public.reports set status = v_status, decision = p_decision, statement_of_reasons = v_statement,
           decided_by = auth.uid(), decided_at = now()
     where target_type = r.target_type and target_id = r.target_id and status = 'open'
    returning id, reporter_id, source
  loop
    v_closed := v_closed + 1;
    if o.reporter_id is not null and o.source = 'user' then
      perform public.notify_user(o.reporter_id, 'report_handled', 'Information de modération',
        'Ouvrez l''application pour voir le détail.', 'Moderation information',
        'Open the app to see the details.',
        jsonb_build_object('kind', 'report_handled', 'report_id', o.id), 'report_handled:' || o.id);
    end if;
  end loop;

  if p_decision <> 'dismiss' and v_owner is not null then
    perform public.notify_user(v_owner, 'moderation_notice', 'Information de modération',
      'Ouvrez l''application pour voir le détail.', 'Moderation information',
      'Open the app to see the details.',
      jsonb_build_object('kind', 'moderation_notice', 'report_id', p_report), 'moderation_notice:' || p_report);
  end if;

  perform public.admin_log('report_decision', 'report', p_report,
    jsonb_build_object('decision', p_decision, 'target_type', r.target_type, 'target_id', r.target_id,
                       'closed', v_closed)
      || case when v_owner is null and (p_decision = 'ban' or (p_decision = 'remove' and r.target_type = 'user'))
              then jsonb_build_object('owner_missing', true) else '{}'::jsonb end);
end $$;
revoke all on function public.admin_decide_report(uuid, text, text) from public, anon;
grant execute on function public.admin_decide_report(uuid, text, text) to authenticated;

-- What the caller may know about decisions: the owner sees the statement; a reporter only that their report
-- was handled. No other person's identity is included.
create function public.my_moderation_notices() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'decisions', coalesce((
      select jsonb_agg(jsonb_build_object('report_id', x.id, 'decision', x.decision,
               'statement_of_reasons', x.statement_of_reasons, 'decided_at', x.decided_at,
               'target_type', x.target_type, 'target_id', x.target_id) order by x.decided_at desc, x.id)
        from (select distinct on (r.target_type, r.target_id, r.decided_at) r.*
                from public.reports r
               where r.target_owner = v_uid and r.status = 'actioned'
               order by r.target_type, r.target_id, r.decided_at, r.id) x), '[]'::jsonb),
    'handled_reports', coalesce((
      select jsonb_agg(jsonb_build_object('report_id', r.id, 'status', r.status, 'decided_at', r.decided_at)
                       order by r.decided_at desc, r.id)
        from public.reports r where r.reporter_id = v_uid and r.status <> 'open'), '[]'::jsonb));
end $$;
revoke all on function public.my_moderation_notices() from public, anon;
grant execute on function public.my_moderation_notices() to authenticated;

create function public.my_blocked() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', p.id, 'first_name', p.first_name)
                                    order by p.first_name, p.id)
                     from public.blocks b join public.profiles p on p.id = b.blocked_id
                    where b.blocker_id = auth.uid()), '[]'::jsonb);
end $$;
revoke all on function public.my_blocked() from public, anon;
grant execute on function public.my_blocked() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Word filter
create table public.banned_words (
  word text primary key check (word = lower(word) and char_length(word) between 3 and 50 and word ~ '[[:alnum:]]'),
  added_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);
alter table public.banned_words enable row level security;
revoke all on public.banned_words from public, anon, authenticated;
grant select on public.banned_words to authenticated;
create policy banned_words_admin_select on public.banned_words for select to authenticated
  using (public.is_admin());

create function public.admin_set_banned_word(p_word text, p_add boolean) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_word text := lower(extensions.unaccent('extensions.unaccent'::regdictionary, btrim(coalesce(p_word, ''))));
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if char_length(v_word) not between 3 and 50 or v_word !~ '[[:alnum:]]' then
    raise exception 'invalid_word' using errcode = '23514';
  end if;
  if p_add then
    if (select count(*) from public.banned_words) >= 500
       and not exists (select 1 from public.banned_words where word = v_word) then
      raise exception 'limit_reached' using errcode = '42501';
    end if;
    insert into public.banned_words (word, added_by) values (v_word, auth.uid()) on conflict do nothing;
  else
    delete from public.banned_words where word = v_word;
  end if;
  perform public.admin_log(case when p_add then 'banned_word_add' else 'banned_word_remove' end,
                           'banned_word', null, jsonb_build_object('word', v_word));
end $$;
revoke all on function public.admin_set_banned_word(text, boolean) from public, anon;
grant execute on function public.admin_set_banned_word(text, boolean) to authenticated;

-- Whole-word match, ignoring accents and case.
create function public.text_has_banned_word(p_text text) returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with t as (select lower(extensions.unaccent('extensions.unaccent'::regdictionary, p_text)) as txt)
  select p_text is not null and exists (
    select 1 from public.banned_words w, t
     where t.txt
           ~ ('(^|[^[:alnum:]])' || regexp_replace(w.word, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '($|[^[:alnum:]])'));
$$;
revoke all on function public.text_has_banned_word(text) from public, anon, authenticated;

create function public.word_filter() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c text;
begin
  if current_setting('role', true) in ('anon', 'authenticated') then
    if tg_table_name = 'associations' and (to_jsonb(new) ->> 'source') <> 'community' then
      return new;
    end if;
    foreach c in array tg_argv loop
      if public.text_has_banned_word(to_jsonb(new) ->> c) then
        raise exception 'content_refused' using errcode = '23514';
      end if;
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.word_filter() from public, anon, authenticated;
create trigger messages_word_filter before insert or update of body on public.messages
  for each row execute function public.word_filter('body');
create trigger activities_word_filter before insert or update of title, description on public.activities
  for each row execute function public.word_filter('title', 'description');
create trigger collectifs_word_filter before insert or update of name, description on public.collectifs
  for each row execute function public.word_filter('name', 'description');
create trigger associations_word_filter before insert or update of name, purpose on public.associations
  for each row execute function public.word_filter('name', 'purpose');

-- Spam: more than 3 links, or the same text 3 times within 10 minutes, goes to the queue as an automatic report.
create function public.messages_spam_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (char_length(new.body) - char_length(replace(lower(new.body), 'http', ''))) / 4 > 3
     or (select count(*) from public.messages m
          where m.sender_id = new.sender_id and m.body = new.body
            and m.created_at > new.created_at - interval '10 minutes'
            and (m.created_at, m.id) <= (new.created_at, new.id)) = 3 then
    insert into public.reports (reporter_id, target_type, target_id, reason, source)
    values (null, 'message', new.id, 'fake_or_spam', 'auto');
  end if;
  return null;
end $$;
revoke all on function public.messages_spam_check() from public, anon, authenticated;
create trigger messages_spam_check after insert on public.messages
  for each row execute function public.messages_spam_check();

create function public.activities_spam_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_text text := new.title || ' ' || coalesce(new.description, '');
begin
  if (char_length(v_text) - char_length(replace(lower(v_text), 'http', ''))) / 4 > 3 then
    insert into public.reports (reporter_id, target_type, target_id, reason, source)
    values (null, 'activity', new.id, 'fake_or_spam', 'auto');
  end if;
  return null;
end $$;
revoke all on function public.activities_spam_check() from public, anon, authenticated;
create trigger activities_spam_check after insert on public.activities
  for each row execute function public.activities_spam_check();
