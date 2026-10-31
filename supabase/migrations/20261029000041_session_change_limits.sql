-- DB-3 (pre-launch security review): an organiser could send unlimited pushes to confirmed
-- attendees by editing a session (or the activity's place) over and over, and could insert sessions
-- without any limit (one request of 5,000 rows worked).
--   * "Session changed" pushes get a dedupe key per session, person and 15-minute window: at most one
--     such push per session and attendee every 15 minutes. Later edits in the same window are not
--     pushed (the session page always shows the current time and place). Cancellations are a single
--     status change and keep no key.
--   * Session inserts and updates made directly by a signed-in user (not the definer jobs) count
--     against take_limit('session_write', 60, '1 hour'), and an activity holds at most 100 future
--     sessions (the generator itself creates at most one per day over 56 days).
-- Both notification functions are migration 12's with only the dedupe argument changed.

create function public.session_moved_dedupe(p_session uuid, p_user uuid) returns text
language sql stable set search_path = public, pg_temp as $$
  select 'session_moved:' || p_session::text || ':' || p_user::text || ':'
         || floor(extract(epoch from now()) / 900)::bigint::text;
$$;
revoke all on function public.session_moved_dedupe(uuid, uuid) from public, anon, authenticated;

-- take_limit is not executable by clients; this wrapper is (private schema, not exposed by the API)
-- and only ever counts against the caller's own uid.
create function private.take_session_write_limit() returns void
language sql security definer set search_path = public, pg_temp as $$
  select public.take_limit('session_write', 60, '1 hour');
$$;
revoke all on function private.take_session_write_limit() from public, anon;
grant execute on function private.take_session_write_limit() to authenticated;

-- Invoker rights on purpose: current_user is the client role only for direct writes, so the session
-- generator and other definer code (which runs as the owner) are not counted.
create function public.sessions_write_limit() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  perform private.take_session_write_limit();
  if tg_op = 'INSERT' and not public.is_admin()
     and (select count(*) from public.sessions s
           where s.activity_id = new.activity_id and s.starts_at > now()) >= 100 then
    raise exception 'limit_reached' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.sessions_write_limit() from public, anon, authenticated;
create trigger sessions_write_limit before insert or update on public.sessions
  for each row execute function public.sessions_write_limit();

CREATE OR REPLACE FUNCTION public.notif_session_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      join public.activity_members m on m.activity_id = a.id and m.user_id = t.user_id and m.status = 'member'
     where t.session_id = new.id and t.status = 'confirmed' and t.user_id <> a.organiser_id
  loop
    if v_cancelled then
      perform public.notify_user(r.user_id, 'session_cancelled',
        'Séance annulée : ' || a.title,
        'La séance du ' || public.notif_when(old.starts_at, a.timezone, 'fr') || ' est annulée.',
        'Session cancelled: ' || a.title,
        'The session on ' || public.notif_when(old.starts_at, a.timezone, 'en') || ' is cancelled.',
        jsonb_build_object('activity_id', a.id, 'session_id', new.id), null, now(), null);
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
        jsonb_build_object('activity_id', a.id, 'session_id', new.id),
        public.session_moved_dedupe(new.id, r.user_id), now(), null);
    end if;
  end loop;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.notif_activity_place_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
begin
  for r in
    select s.id as session_id, t.user_id
      from public.sessions s
      join public.attendances t on t.session_id = s.id and t.status = 'confirmed'
      join public.activity_members m on m.activity_id = new.id and m.user_id = t.user_id and m.status = 'member'
     where s.activity_id = new.id and s.status = 'scheduled' and s.starts_at > now()
       and s.place is null and s.place_label is null and t.user_id <> new.organiser_id
  loop
    perform public.notify_user(r.user_id, 'session_moved',
      'Séance modifiée : ' || new.title, 'Nouveau lieu : ' || new.place_label || '.',
      'Session changed: ' || new.title, 'New place: ' || new.place_label || '.',
      jsonb_build_object('activity_id', new.id, 'session_id', r.session_id),
      public.session_moved_dedupe(r.session_id, r.user_id), now(), null);
  end loop;
  return null;
end $function$;
