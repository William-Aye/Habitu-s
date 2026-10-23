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

create function public.messages_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
begin
  for r in
    select u.user_id
      from (select a.organiser_id as user_id from public.activities a where a.id = new.activity_id
            union
            select m.user_id from public.activity_members m
             where m.activity_id = new.activity_id and m.status = 'member') u
      left join public.chat_states cs on cs.activity_id = new.activity_id and cs.user_id = u.user_id
     where u.user_id <> new.sender_id
       and coalesce(cs.muted, false) = false
       and (cs.last_read_at is null or cs.last_read_at <= now() - interval '2 minutes')
  loop
    perform public.notify_user(r.user_id, 'chat_message', null, null, null, null,
      jsonb_build_object('activity_id', new.activity_id, 'kind', 'chat_message'),
      'chat:' || new.activity_id || ':' || r.user_id || ':' || floor(extract(epoch from now()) / 900),
      now(), new.sender_id);
  end loop;
  return null;
end $$;
revoke all on function public.messages_notify() from public, anon, authenticated;
create trigger messages_notify after insert on public.messages
  for each row when (new.activity_id is not null) execute function public.messages_notify();
