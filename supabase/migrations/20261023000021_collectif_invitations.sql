-- Collectif invitations: one notification per invitee and collectif, a cap on how many a
-- responsable can send per day, and collectifs become reportable.

-- Dedupe key: re-inviting (after a decline) never re-notifies. Block suppression and the actor
-- (the active responsable) are unchanged.
create or replace function public.notif_collectif_invited() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text;
begin
  select c.name into v_name from public.collectifs c where c.id = new.collectif_id;
  if found then
    perform public.notify_user(new.user_id, 'collectif_invitation',
      'Invitation à un collectif', 'Vous êtes invité(e) à organiser avec le collectif ' || v_name || '.',
      'Collective invitation', 'You are invited to organise with the collective ' || v_name || '.',
      jsonb_build_object('collectif_id', new.collectif_id),
      'collectif_invite:' || new.collectif_id || ':' || new.user_id, now(),
      (select r.user_id from public.collectif_members r
        where r.collectif_id = new.collectif_id and r.role = 'responsable' and r.status = 'active'));
  end if;
  return null;
end $$;

-- At most 10 invitations per responsable per rolling 24 h (API roles only; admins and the service
-- role are exempt). The invitation date is already pinned by collectif_members_guard, which fires
-- first (trigger names run alphabetically).
create function public.collectif_members_invite_limit() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() and new.status = 'invited' then
    perform pg_advisory_xact_lock(hashtext('limits:' || coalesce(auth.uid()::text, '')));
    if (select count(*)
          from public.collectif_members m
         where m.role = 'organiser' and m.invited_at > now() - interval '24 hours'
           and exists (select 1 from public.collectif_members r
                        where r.collectif_id = m.collectif_id and r.user_id = auth.uid()
                          and r.role = 'responsable' and r.status = 'active')) >= 10 then
      raise exception 'limit_reached' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.collectif_members_invite_limit() from public, anon, authenticated;
create trigger collectif_members_invite_limit before insert on public.collectif_members
  for each row execute function public.collectif_members_invite_limit();

-- Collectifs can be reported.
alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('user', 'activity', 'message', 'association', 'collectif'));
