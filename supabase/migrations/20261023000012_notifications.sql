-- Notifications: push tokens, the outbox, enqueue triggers (French or English per recipient),
-- the day-before reminder job, and the job that wakes the `send-push` Edge Function.
--
-- Operations (documented here, the README is written in Task 10):
--   * Vault secret `send_push_key`: the project's service-role key. `send-push` is deployed with JWT
--     verification on and receives `Authorization: Bearer <that key>`.
--   * Vault secret `send_push_url`: the function URL, e.g. https://<ref>.supabase.co/functions/v1/send-push
--     (local Supabase: http://host.docker.internal:55321/functions/v1/send-push).
--     Set both with: select vault.create_secret('<value>', 'send_push_key');
--   * While either secret is missing, `drain-outbox` does nothing, so local runs never fail.
--   * The reminder action buttons use the category id `session_reminder` (set by `send-push`).

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------------------------
-- Push tokens

create table public.push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);
create index push_tokens_user on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from public, anon, authenticated;
grant select, delete on public.push_tokens to authenticated;
grant all on public.push_tokens to service_role;
create policy push_tokens_select on public.push_tokens for select to authenticated using (user_id = auth.uid());
create policy push_tokens_delete on public.push_tokens for delete to authenticated using (user_id = auth.uid());

-- Registers (or re-assigns, on a shared device) a token for the caller.
create function public.register_push_token(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_token is null or char_length(p_token) not between 10 and 300 then
    raise exception 'invalid token' using errcode = '22023';
  end if;
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;
revoke all on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Outbox (platform only: no API access)

create table public.notification_outbox (
  id bigserial primary key,
  user_id uuid not null references public.profiles on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  attempts int not null default 0,
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz
);
create index notification_outbox_due on public.notification_outbox (send_after)
  where sent_at is null and failed_at is null;
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from public, anon, authenticated;
grant all on public.notification_outbox to service_role;
grant usage, select on sequence public.notification_outbox_id_seq to service_role;

-- Local date / time of a session for a message, in the recipient's language.
create function public.notif_when(p_ts timestamptz, p_tz text, p_lang text, p_time_only boolean default false)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when p_lang = 'en'
           then case when p_time_only then to_char(p_ts at time zone p_tz, 'FMHH12:MI AM')
                     else to_char(p_ts at time zone p_tz, 'MM/DD "at" FMHH12:MI AM') end
           else case when p_time_only then to_char(p_ts at time zone p_tz, 'HH24"h"MI')
                     else to_char(p_ts at time zone p_tz, 'DD/MM "à" HH24"h"MI') end
         end;
$$;

-- Enqueues one notification in the recipient's language. A repeated dedupe_key is ignored.
create function public.notify_user(
  p_user uuid, p_kind text, p_title_fr text, p_body_fr text, p_title_en text, p_body_en text,
  p_data jsonb default '{}'::jsonb, p_dedupe text default null, p_send_after timestamptz default now()
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lang text;
begin
  select p.language into v_lang from public.profiles p where p.id = p_user;
  if not found then
    return;
  end if;
  insert into public.notification_outbox (user_id, kind, title, body, data, dedupe_key, send_after)
  values (p_user, p_kind,
          case when v_lang = 'en' then p_title_en else p_title_fr end,
          case when v_lang = 'en' then p_body_en else p_body_fr end,
          p_data, p_dedupe, p_send_after)
  on conflict (dedupe_key) do nothing;
end $$;
revoke all on function public.notify_user(uuid, text, text, text, text, text, jsonb, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.notif_when(timestamptz, text, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Enqueue triggers (none of the texts carries a last name, e-mail or phone)

-- New member (open activity) or join request (approval mode), to the organiser.
create function public.notif_activity_member_added() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.activities;
  v_name text;
begin
  select * into a from public.activities where id = new.activity_id;
  if not found or a.organiser_id = new.user_id or new.status not in ('member', 'pending') then
    return null;
  end if;
  select p.first_name into v_name from public.profiles p where p.id = new.user_id;
  if new.status = 'member' then
    perform public.notify_user(a.organiser_id, 'new_member',
      'Nouveau membre dans ' || a.title, v_name || ' a rejoint l''activité.',
      'New member in ' || a.title, v_name || ' joined the activity.',
      jsonb_build_object('activity_id', a.id));
  else
    perform public.notify_user(a.organiser_id, 'join_request',
      'Demande pour rejoindre ' || a.title, v_name || ' souhaite rejoindre l''activité.',
      'Request to join ' || a.title, v_name || ' would like to join the activity.',
      jsonb_build_object('activity_id', a.id));
  end if;
  return null;
end $$;
revoke all on function public.notif_activity_member_added() from public, anon, authenticated;
create trigger notif_activity_member_added after insert on public.activity_members
  for each row execute function public.notif_activity_member_added();

-- Request accepted, to the requester.
create function public.notif_activity_member_accepted() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.activities;
begin
  select * into a from public.activities where id = new.activity_id;
  if found then
    perform public.notify_user(new.user_id, 'request_accepted',
      'Demande acceptée', 'Vous faites partie de ' || a.title || '.',
      'Request accepted', 'You are now part of ' || a.title || '.',
      jsonb_build_object('activity_id', a.id));
  end if;
  return null;
end $$;
revoke all on function public.notif_activity_member_accepted() from public, anon, authenticated;
create trigger notif_activity_member_accepted after update of status on public.activity_members
  for each row when (old.status = 'pending' and new.status = 'member')
  execute function public.notif_activity_member_accepted();

-- Late cancellation, to the organiser.
create function public.notif_late_cancellation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.activities;
  s public.sessions;
  v_name text;
begin
  select * into s from public.sessions where id = new.session_id;
  select * into a from public.activities where id = s.activity_id;
  if not found or a.organiser_id = new.user_id then
    return null;
  end if;
  select p.first_name into v_name from public.profiles p where p.id = new.user_id;
  perform public.notify_user(a.organiser_id, 'late_cancellation',
    'Désistement tardif : ' || a.title,
    v_name || ' ne viendra pas à la séance du ' || public.notif_when(s.starts_at, a.timezone, 'fr') || '.',
    'Late cancellation: ' || a.title,
    v_name || ' can no longer make the session on ' || public.notif_when(s.starts_at, a.timezone, 'en') || '.',
    jsonb_build_object('activity_id', a.id, 'session_id', s.id));
  return null;
end $$;
revoke all on function public.notif_late_cancellation() from public, anon, authenticated;
create trigger notif_late_cancellation_ins after insert on public.attendances
  for each row when (new.status = 'cancelled_late') execute function public.notif_late_cancellation();
create trigger notif_late_cancellation_upd after update of status on public.attendances
  for each row when (new.status = 'cancelled_late' and old.status is distinct from 'cancelled_late')
  execute function public.notif_late_cancellation();

-- Session time or place changed, or session cancelled, to the confirmed attendees
-- (the organiser who made the change is not notified).
create function public.notif_session_changed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.activities;
  r record;
  v_cancelled boolean := new.status in ('cancelled_by_organiser', 'cancelled_min_not_reached')
                         and old.status is distinct from new.status;
  v_time boolean := new.starts_at is distinct from old.starts_at;
  v_place boolean := (new.place_label, new.place::text) is distinct from (old.place_label, old.place::text);
  v_label text;
begin
  select * into a from public.activities where id = new.activity_id;
  if not found or (not v_cancelled and (new.status <> 'scheduled' or not (v_time or v_place))) then
    return null;
  end if;
  v_label := coalesce(new.place_label, a.place_label);
  for r in
    select t.user_id
      from public.attendances t
     where t.session_id = new.id and t.status = 'confirmed' and t.user_id <> a.organiser_id
  loop
    if v_cancelled then
      perform public.notify_user(r.user_id, 'session_cancelled',
        'Séance annulée : ' || a.title,
        'La séance du ' || public.notif_when(old.starts_at, a.timezone, 'fr') || ' est annulée.',
        'Session cancelled: ' || a.title,
        'The session on ' || public.notif_when(old.starts_at, a.timezone, 'en') || ' is cancelled.',
        jsonb_build_object('activity_id', a.id, 'session_id', new.id));
    else
      perform public.notify_user(r.user_id, 'session_moved',
        'Séance modifiée : ' || a.title,
        concat_ws(' ',
          case when v_time then 'Nouvelle date : ' || public.notif_when(new.starts_at, a.timezone, 'fr') || '.' end,
          case when v_place then 'Nouveau lieu : ' || v_label || '.' end),
        'Session changed: ' || a.title,
        concat_ws(' ',
          case when v_time then 'New date: ' || public.notif_when(new.starts_at, a.timezone, 'en') || '.' end,
          case when v_place then 'New place: ' || v_label || '.' end),
        jsonb_build_object('activity_id', a.id, 'session_id', new.id));
    end if;
  end loop;
  return null;
end $$;
revoke all on function public.notif_session_changed() from public, anon, authenticated;
create trigger notif_session_changed after update of starts_at, place_label, place, status on public.sessions
  for each row execute function public.notif_session_changed();

-- Recurrence edited: confirmed sessions kept at their old time (they matched the old rule but no
-- longer match the new one) tell their confirmed attendees.
create function public.notif_rule_changed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
begin
  for r in
    select s.id as session_id, s.starts_at, t.user_id
      from public.sessions s
      join public.attendances t on t.session_id = s.id and t.status = 'confirmed'
     where s.activity_id = new.id and s.status = 'scheduled' and s.starts_at > now()
       and t.user_id <> new.organiser_id
       and public.session_matches_rule(old, s.starts_at)
       and not public.session_matches_rule(new, s.starts_at)
  loop
    perform public.notify_user(r.user_id, 'session_rule_changed',
      'Horaire modifié : ' || new.title,
      'Le planning a changé ; votre séance du ' || public.notif_when(r.starts_at, new.timezone, 'fr')
        || ' est maintenue à cette date.',
      'Schedule changed: ' || new.title,
      'The schedule has changed; your session on ' || public.notif_when(r.starts_at, new.timezone, 'en')
        || ' stays as planned.',
      jsonb_build_object('activity_id', new.id, 'session_id', r.session_id));
  end loop;
  return null;
end $$;
revoke all on function public.notif_rule_changed() from public, anon, authenticated;
create trigger notif_rule_changed
  after update of recurrence_kind, recurrence_interval_days, recurrence_weekdays, start_date, start_time, timezone
  on public.activities
  for each row when ((new.recurrence_kind, new.recurrence_interval_days, new.recurrence_weekdays,
                      new.start_date, new.start_time, new.timezone)
                     is distinct from
                     (old.recurrence_kind, old.recurrence_interval_days, old.recurrence_weekdays,
                      old.start_date, old.start_time, old.timezone))
  execute function public.notif_rule_changed();

-- Collectif organiser invitation, to the invitee.
create function public.notif_collectif_invited() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text;
begin
  select c.name into v_name from public.collectifs c where c.id = new.collectif_id;
  if found then
    perform public.notify_user(new.user_id, 'collectif_invitation',
      'Invitation à un collectif', 'Vous êtes invité(e) à organiser avec le collectif ' || v_name || '.',
      'Collective invitation', 'You are invited to organise with the collective ' || v_name || '.',
      jsonb_build_object('collectif_id', new.collectif_id));
  end if;
  return null;
end $$;
revoke all on function public.notif_collectif_invited() from public, anon, authenticated;
create trigger notif_collectif_invited after insert on public.collectif_members
  for each row when (new.status = 'invited') execute function public.notif_collectif_invited();

-- ---------------------------------------------------------------------------------------------
-- Day-before reminders

-- For every scheduled session that starts tomorrow (local date in the activity's timezone), one
-- reminder per member who has not cancelled, sent at 18:00 Paris today (or now when that has passed).
-- The dedupe key makes the 15-minute job idempotent. Returns the number of reminders enqueued.
create function public.enqueue_reminders() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
begin
  with due as (
    select s.id as session_id, s.starts_at, a.id as activity_id, a.title, a.timezone, m.user_id,
           coalesce(p.language, 'fr') as lang,
           greatest(now(), (((s.starts_at at time zone a.timezone)::date - 1) + time '18:00')
                           at time zone 'Europe/Paris') as send_after
      from public.sessions s
      join public.activities a on a.id = s.activity_id and a.archived_at is null
      join public.activity_members m on m.activity_id = a.id and m.status = 'member'
      join public.profiles p on p.id = m.user_id
     where s.status = 'scheduled'
       and (s.starts_at at time zone a.timezone)::date = (now() at time zone a.timezone)::date + 1
       and not exists (select 1 from public.attendances t
                        where t.session_id = s.id and t.user_id = m.user_id
                          and t.status in ('cancelled', 'cancelled_late'))
  ), ins as (
    insert into public.notification_outbox (user_id, kind, title, body, data, dedupe_key, send_after)
    select d.user_id, 'session_reminder', d.title,
           case when d.lang = 'en'
                then 'Tomorrow at ' || public.notif_when(d.starts_at, d.timezone, 'en', true) || ', ' || d.title
                     || ' — will you be there?'
                else 'Demain ' || public.notif_when(d.starts_at, d.timezone, 'fr', true) || ', ' || d.title
                     || ' — vous serez là ?' end,
           jsonb_build_object('session_id', d.session_id, 'activity_id', d.activity_id),
           'reminder:' || d.session_id || ':' || d.user_id, d.send_after
      from due d
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end $$;
revoke all on function public.enqueue_reminders() from public, anon, authenticated;
select cron.schedule('enqueue-reminders', '*/15 * * * *', 'select public.enqueue_reminders()');

-- ---------------------------------------------------------------------------------------------
-- Draining: the job wakes the Edge Function when something is due.

-- Called by the Edge Function (service role): takes up to p_limit due rows and pushes their
-- send_after 2 minutes ahead so overlapping runs never send the same row twice, with each
-- recipient's tokens.
create function public.claim_outbox(p_limit int default 100) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  with due as (
    select o.id from public.notification_outbox o
     where o.sent_at is null and o.failed_at is null and o.send_after <= now()
     order by o.id limit p_limit for update skip locked
  ), upd as (
    update public.notification_outbox o set send_after = now() + interval '2 minutes'
      from due where o.id = due.id returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', u.id, 'user_id', u.user_id, 'kind', u.kind, 'title', u.title, 'body', u.body,
           'data', u.data, 'attempts', u.attempts,
           'tokens', coalesce((select jsonb_agg(t.token order by t.token) from public.push_tokens t
                                where t.user_id = u.user_id), '[]'::jsonb)) order by u.id), '[]'::jsonb)
    from upd u;
$$;
revoke all on function public.claim_outbox(int) from public, anon, authenticated;
grant execute on function public.claim_outbox(int) to service_role;

create function public.drain_outbox() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key text;
  v_url text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'send_push_key';
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'send_push_url';
  if v_key is null or v_url is null then
    return;
  end if;
  if not exists (select 1 from public.notification_outbox o
                  where o.sent_at is null and o.failed_at is null and o.send_after <= now()) then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb);
end $$;
revoke all on function public.drain_outbox() from public, anon, authenticated;
select cron.schedule('drain-outbox', '* * * * *', 'select public.drain_outbox()');

-- Housekeeping: sent or failed rows are kept 30 days.
create function public.prune_outbox() returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.notification_outbox
   where coalesce(sent_at, failed_at) < now() - interval '30 days';
$$;
revoke all on function public.prune_outbox() from public, anon, authenticated;
select cron.schedule('prune-outbox', '45 3 * * *', 'select public.prune_outbox()');
