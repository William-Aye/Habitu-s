-- Discreet notifications: a push may show on a lock screen and transits through Expo, Firebase and
-- Apple. No title or body carries an activity title, a collectif name or a first name. The texts are
-- fixed per kind, in the recipient's language, composed here for every caller (the callers still pass
-- their detailed texts; they are ignored). The data payload keeps the ids so the app opens the right
-- page, where the details show after sign-in.
create function public.notif_text(p_kind text, p_lang text) returns table (title text, body text)
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
      ('session_cancelled', 'Séance modifiée', 'Une séance de votre activité a changé.',
                             'Session changed', 'A session of your activity has changed.'),
      ('session_moved', 'Séance modifiée', 'Une séance de votre activité a changé.',
                         'Session changed', 'A session of your activity has changed.'),
      ('session_rule_changed', 'Séance modifiée', 'Une séance de votre activité a changé.',
                                'Session changed', 'A session of your activity has changed.'),
      ('collectif_invitation', 'Invitation', 'Vous êtes invité à organiser un collectif.',
                                'Invitation', 'You are invited to organise a collective.')
    ) as t(kind, title_fr, body_fr, title_en, body_en)
   where t.kind = p_kind
  union all
  select case when p_lang = 'en' then 'Notification' else 'Notification' end,
         case when p_lang = 'en' then 'Open the app to see the details.' else 'Ouvrez l''application pour voir le détail.' end
   where p_kind not in ('session_reminder', 'new_member', 'join_request', 'request_accepted', 'late_cancellation',
                        'session_cancelled', 'session_moved', 'session_rule_changed', 'collectif_invitation');
$$;
revoke all on function public.notif_text(text, text) from public, anon, authenticated;

create or replace function public.notify_user(
  p_user uuid, p_kind text, p_title_fr text, p_body_fr text, p_title_en text, p_body_en text,
  p_data jsonb default '{}'::jsonb, p_dedupe text default null, p_send_after timestamptz default now(),
  p_actor uuid default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lang text;
begin
  select p.language into v_lang from public.profiles p where p.id = p_user;
  if not found then
    return;
  end if;
  -- Nothing is sent between two users when either has blocked the other.
  if p_actor is not null and exists (
       select 1 from public.blocks b
        where (b.blocker_id = p_user and b.blocked_id = p_actor)
           or (b.blocker_id = p_actor and b.blocked_id = p_user)) then
    return;
  end if;
  insert into public.notification_outbox (user_id, kind, title, body, data, dedupe_key, send_after)
  select p_user, p_kind, x.title, x.body, p_data, p_dedupe, p_send_after
    from public.notif_text(p_kind, case when v_lang = 'en' then 'en' else 'fr' end) x
  on conflict (dedupe_key) do nothing;
end $$;

-- Reminders: same selection as before, generic text.
create or replace function public.enqueue_reminders(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
begin
  with due as (
    select s.id as session_id, a.id as activity_id, m.user_id, coalesce(p.language, 'fr') as lang
      from public.sessions s
      join public.activities a on a.id = s.activity_id and a.archived_at is null
      join public.activity_members m on m.activity_id = a.id and m.status = 'member'
      join public.profiles p on p.id = m.user_id
     where s.status = 'scheduled'
       and (s.starts_at at time zone a.timezone)::date = (p_now at time zone a.timezone)::date + 1
       and (((s.starts_at at time zone a.timezone)::date - 1) + time '18:00') at time zone 'Europe/Paris' <= p_now
       and not exists (select 1 from public.attendances t
                        where t.session_id = s.id and t.user_id = m.user_id
                          and t.status in ('cancelled', 'cancelled_late'))
  ), ins as (
    insert into public.notification_outbox (user_id, kind, title, body, data, dedupe_key, send_after)
    select d.user_id, 'session_reminder', x.title, x.body,
           jsonb_build_object('session_id', d.session_id, 'activity_id', d.activity_id),
           'reminder:' || d.session_id || ':' || d.user_id, p_now
      from due d
      cross join lateral public.notif_text('session_reminder', case when d.lang = 'en' then 'en' else 'fr' end) x
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end $$;

-- Rows already queued or kept (30 days) carry names: make them generic too.
update public.notification_outbox o set title = x.title, body = x.body
  from (select o2.id, t.title, t.body
          from public.notification_outbox o2
          join public.profiles p on p.id = o2.user_id
          cross join lateral public.notif_text(o2.kind, case when p.language = 'en' then 'en' else 'fr' end) t) x
 where x.id = o.id;
