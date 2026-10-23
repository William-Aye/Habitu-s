-- Discreet chat notifications: one per person per discussion every 15 minutes, none when the discussion was
-- read in the last 2 minutes or is muted. Texts and data carry no name and no message text.
-- Generic text for a cancelled session: it says cancelled, still without any name.
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
                       'New message', 'New message in one of your activities.')
    ) as t(kind, title_fr, body_fr, title_en, body_en)
   where t.kind = p_kind
  union all
  select case when p_lang = 'en' then 'Notification' else 'Notification' end,
         case when p_lang = 'en' then 'Open the app to see the details.' else 'Ouvrez l''application pour voir le détail.' end
   where p_kind not in ('session_reminder', 'new_member', 'join_request', 'request_accepted', 'late_cancellation',
                        'session_cancelled', 'session_moved', 'session_rule_changed', 'collectif_invitation',
                        'chat_message');
$$;

-- KEEP IN SYNC with notify_user (migration 24): this set-based statement mirrors it. A pgTAP test compares
-- both outputs for the same recipient and language.
-- One set-based statement for the whole discussion. It replicates notify_user: a recipient needs a profile
-- (their language, fr unless en), nothing goes between two people when either blocked the other, and the
-- dedupe key makes it idempotent.
create function public.messages_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
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
create trigger messages_notify after insert on public.messages
  for each row when (new.activity_id is not null) execute function public.messages_notify();
