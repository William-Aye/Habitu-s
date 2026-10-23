-- Collectifs (informal groups with no legal status), the organising rule that replaces the phone
-- check, daily creation limits, and small activity / session / attendance extras.

-- Organising rule. Turning SMS verification on later only changes this function.
create function public.can_organise() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select p.first_name <> '' and p.age_confirmed
                          and p.created_at <= now() - interval '24 hours'
                     from public.profiles p where p.id = auth.uid()), false);
$$;
revoke all on function public.can_organise() from public, anon;
grant execute on function public.can_organise() to authenticated;

create table public.collectifs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 80),
  description text check (char_length(description) <= 500),
  town_label text not null,
  town_point geography(Point, 4326) not null,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

create table public.collectif_members (
  collectif_id uuid not null references public.collectifs on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  role text not null check (role in ('responsable', 'organiser')),
  status text not null default 'invited' check (status in ('invited', 'active')),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (collectif_id, user_id)
);
create index collectif_members_user on public.collectif_members (user_id);
create unique index collectif_members_one_responsable on public.collectif_members (collectif_id)
  where role = 'responsable' and status = 'active';

-- Membership helpers (security definer: no RLS recursion from the policies below).
create function public.is_collectif_member(p_collectif uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.collectif_members m
                  where m.collectif_id = p_collectif and m.user_id = auth.uid() and m.status = 'active');
$$;
create function public.is_collectif_responsable(p_collectif uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.collectif_members m
                  where m.collectif_id = p_collectif and m.user_id = auth.uid()
                    and m.status = 'active' and m.role = 'responsable');
$$;
revoke all on function public.is_collectif_member(uuid), public.is_collectif_responsable(uuid) from public;
grant execute on function public.is_collectif_member(uuid), public.is_collectif_responsable(uuid)
  to anon, authenticated;

-- The town is the commune centre, snapped to a 0.01 degree grid (~1 km) like home areas.
create function public.collectifs_snap_town() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  new.town_point := ST_SetSRID(ST_MakePoint(
    round(ST_X(new.town_point::geometry)::numeric, 2),
    round(ST_Y(new.town_point::geometry)::numeric, 2)), 4326)::geography;
  return new;
end $$;
revoke all on function public.collectifs_snap_town() from public, anon, authenticated;
create trigger collectifs_snap_town before insert or update of town_point on public.collectifs
  for each row execute function public.collectifs_snap_town();

-- Daily limit: 2 collectifs per user per rolling 24 h (admins and service role exempt).
create function public.collectifs_limit() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    perform pg_advisory_xact_lock(hashtext('limits:' || coalesce(auth.uid()::text, '')));
  end if;
  if current_user in ('anon', 'authenticated') and not public.is_admin()
     and (select count(*) from public.collectifs c
           where c.created_by = new.created_by and c.created_at > now() - interval '24 hours') >= 2 then
    raise exception 'limit_reached' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.collectifs_limit() from public, anon, authenticated;
create trigger collectifs_limit before insert on public.collectifs
  for each row execute function public.collectifs_limit();

-- The creator becomes the active responsable.
create function public.collectifs_add_creator() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.created_by is not null then
    insert into public.collectif_members (collectif_id, user_id, role, status, accepted_at)
    values (new.id, new.created_by, 'responsable', 'active', now());
  end if;
  return new;
end $$;
revoke all on function public.collectifs_add_creator() from public, anon, authenticated;
create trigger collectifs_add_creator after insert on public.collectifs
  for each row execute function public.collectifs_add_creator();

-- Invitations: API roles cannot forge dates; an update can only move invited -> active.
create function public.collectif_members_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.invited_at := now();
      new.accepted_at := null;
    else
      if (new.collectif_id, new.user_id, new.role, new.invited_at)
           is distinct from (old.collectif_id, old.user_id, old.role, old.invited_at) then
        raise exception 'membership not editable' using errcode = '42501';
      end if;
      new.accepted_at := case when new.status = 'active' and old.status = 'invited' then now()
                              else old.accepted_at end;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.collectif_members_guard() from public, anon, authenticated;
create trigger collectif_members_guard before insert or update on public.collectif_members
  for each row execute function public.collectif_members_guard();

-- When the active responsable leaves (own removal or account deletion cascading), promote the
-- longest-active organiser; with none left, the collectif is deleted (its activities keep existing).
create function public.collectif_members_responsable_left() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_next uuid;
begin
  if old.role <> 'responsable' or old.status <> 'active'
     or not exists (select 1 from public.collectifs c where c.id = old.collectif_id) then
    return old;
  end if;
  select m.user_id into v_next from public.collectif_members m
   where m.collectif_id = old.collectif_id and m.role = 'organiser' and m.status = 'active'
   order by m.accepted_at, m.user_id limit 1;
  if v_next is null then
    delete from public.collectifs where id = old.collectif_id;
  else
    update public.collectif_members set role = 'responsable'
     where collectif_id = old.collectif_id and user_id = v_next;
  end if;
  return old;
end $$;
revoke all on function public.collectif_members_responsable_left() from public, anon, authenticated;
create trigger collectif_members_responsable_left after delete on public.collectif_members
  for each row execute function public.collectif_members_responsable_left();

-- Activity extras
alter table public.activities
  add column organised_by_collectif_id uuid references public.collectifs on delete set null,
  add column welcome_member_id uuid references public.profiles on delete set null,
  add constraint activities_one_organising_body check (
    num_nonnulls(organised_by_association_id, organised_by_collectif_id) <= 1);

create function public.activities_guard_collectif() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin()
     and new.organised_by_collectif_id is not null
     and (tg_op = 'INSERT' or new.organised_by_collectif_id is distinct from old.organised_by_collectif_id)
     and not public.is_collectif_member(new.organised_by_collectif_id) then
    raise exception 'collectif not linkable' using errcode = '42501';
  end if;
  if new.welcome_member_id is not null
     and (tg_op = 'INSERT' or new.welcome_member_id is distinct from old.welcome_member_id)
     and new.welcome_member_id is distinct from new.organiser_id
     and not exists (select 1 from public.activity_members m
                      where m.activity_id = new.id and m.user_id = new.welcome_member_id
                        and m.status = 'member') then
    raise exception 'welcome member must be the organiser or a member' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.activities_guard_collectif() from public, anon, authenticated;
create trigger activities_guard_collectif before insert or update on public.activities
  for each row execute function public.activities_guard_collectif();

-- Daily limit: 3 activities per organiser per rolling 24 h (admins and service role exempt).
create function public.activities_limit() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    perform pg_advisory_xact_lock(hashtext('limits:' || coalesce(auth.uid()::text, '')));
  end if;
  if current_user in ('anon', 'authenticated') and not public.is_admin()
     and (select count(*) from public.activities a
           where a.organiser_id = new.organiser_id and a.created_at > now() - interval '24 hours') >= 3 then
    raise exception 'limit_reached' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.activities_limit() from public, anon, authenticated;
create trigger activities_limit before insert on public.activities
  for each row execute function public.activities_limit();

-- Timestamps cannot be forged by API roles: they drive the daily limits and the "Nouvelle" ranking.
create function public.pin_creation_dates() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.created_at := now();
      if tg_table_name = 'activities' then new.published_at := now(); end if;
    else
      new.created_at := old.created_at;
      if tg_table_name = 'activities' then new.published_at := old.published_at; end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.pin_creation_dates() from public, anon, authenticated;
create trigger activities_pin_dates before insert or update on public.activities
  for each row execute function public.pin_creation_dates();
create trigger collectifs_pin_dates before insert or update on public.collectifs
  for each row execute function public.pin_creation_dates();

alter table public.sessions add column is_discovery boolean not null default false;
alter table public.attendances
  add column guest_count smallint not null default 0 check (guest_count in (0, 1));

-- The phone rule becomes the organising rule.
drop policy activities_insert on public.activities;
create policy activities_insert on public.activities for insert to authenticated
  with check (organiser_id = auth.uid() and public.can_organise());

-- RLS
alter table public.collectifs enable row level security;
alter table public.collectif_members enable row level security;
revoke all on public.collectifs, public.collectif_members from anon, authenticated;
grant select on public.collectifs, public.collectif_members to anon;
grant select, insert, delete on public.collectifs, public.collectif_members to authenticated;
grant update (name, description, town_label, town_point) on public.collectifs to authenticated;
grant update (status) on public.collectif_members to authenticated;

create policy collectifs_select on public.collectifs for select to anon, authenticated using (true);
create policy collectifs_insert on public.collectifs for insert to authenticated
  with check (created_by = auth.uid() and public.can_organise());
create policy collectifs_update on public.collectifs for update to authenticated
  using (public.is_collectif_member(id)) with check (public.is_collectif_member(id));
create policy collectifs_delete on public.collectifs for delete to authenticated
  using (public.is_collectif_responsable(id));
create policy collectifs_admin on public.collectifs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy collectif_members_select_active on public.collectif_members for select to anon, authenticated
  using (status = 'active');
create policy collectif_members_select_related on public.collectif_members for select to authenticated
  using (user_id = auth.uid() or public.is_collectif_responsable(collectif_id));
create policy collectif_members_invite on public.collectif_members for insert to authenticated
  with check (public.is_collectif_responsable(collectif_id) and role = 'organiser'
    and status = 'invited' and user_id <> auth.uid() and public.can_organise());
create policy collectif_members_accept on public.collectif_members for update to authenticated
  using (user_id = auth.uid() and status = 'invited')
  with check (user_id = auth.uid() and status = 'active' and public.can_organise());
create policy collectif_members_remove on public.collectif_members for delete to authenticated
  using (user_id = auth.uid() or public.is_collectif_responsable(collectif_id));
create policy collectif_members_admin on public.collectif_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
