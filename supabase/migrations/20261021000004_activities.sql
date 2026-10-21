-- Recurring activities, tags, membership, interest, sessions, attendances.

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references public.profiles on delete cascade,
  organised_by_association_id uuid references public.associations on delete set null,
  category_id uuid not null references public.categories,
  title text not null check (char_length(title) between 3 and 100),
  description text check (char_length(description) <= 2000),
  place_label text not null,
  place geography(Point, 4326) not null,
  recurrence_kind text not null check (recurrence_kind in ('weekly', 'every_n_days', 'weekdays')),
  recurrence_interval_days int check (recurrence_interval_days between 2 and 60),
  recurrence_weekdays smallint[],  -- ISO: 1 = Monday ... 7 = Sunday
  start_date date not null,
  start_time time not null,
  duration_minutes int not null default 120,
  timezone text not null default 'Europe/Paris',
  max_size int check (max_size between 2 and 200),
  min_participants int check (min_participants between 2 and 50),
  newcomer_friendly boolean not null default false,
  approval_mode text not null default 'open' check (approval_mode in ('open', 'approval')),
  published_at timestamptz not null default now(),
  embedding vector(384),
  created_at timestamptz not null default now(),
  constraint activities_recurrence_valid check (
    case recurrence_kind
      when 'every_n_days' then recurrence_interval_days is not null and recurrence_weekdays is null
      when 'weekdays' then recurrence_interval_days is null and recurrence_weekdays is not null
        and cardinality(recurrence_weekdays) > 0
        and recurrence_weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]
      when 'weekly' then recurrence_interval_days is null and recurrence_weekdays is null
      else false
    end),
  constraint activities_min_le_max check (
    min_participants is null or max_size is null or min_participants <= max_size)
);

create index activities_place_gist on public.activities using gist (place);
create index activities_embedding_hnsw on public.activities using hnsw (embedding vector_cosine_ops);

create table public.activity_tags (
  activity_id uuid not null references public.activities on delete cascade,
  tag_id uuid not null references public.tags on delete cascade,
  primary key (activity_id, tag_id)
);

create table public.activity_members (
  activity_id uuid not null references public.activities on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  status text not null default 'member' check (status in ('member', 'pending', 'removed')),
  joined_at timestamptz not null default now(),
  primary key (activity_id, user_id)
);
create index activity_members_user on public.activity_members (user_id);

create table public.activity_interests (
  activity_id uuid not null references public.activities on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (activity_id, user_id)
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities on delete cascade,
  starts_at timestamptz not null,
  place_label text,
  place geography(Point, 4326),  -- override; null = the activity's place
  status text not null default 'scheduled'
    check (status in ('scheduled', 'held', 'cancelled_by_organiser', 'cancelled_min_not_reached')),
  unique (activity_id, starts_at)
);
create index sessions_activity_starts on public.sessions (activity_id, starts_at);

create table public.attendances (
  session_id uuid not null references public.sessions on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  status text not null check (status in ('confirmed', 'cancelled', 'cancelled_late', 'no_show')),
  updated_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index attendances_user on public.attendances (user_id);

-- Membership helper: organiser or approved member. Security definer so policies on
-- activity_members / attendances can call it without RLS recursion.
create function public.is_activity_member(p_activity uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.activities a
                  where a.id = p_activity and a.organiser_id = auth.uid())
      or exists (select 1 from public.activity_members m
                  where m.activity_id = p_activity and m.user_id = auth.uid() and m.status = 'member');
$$;

create function public.is_activity_organiser(p_activity uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.activities a
                  where a.id = p_activity and a.organiser_id = auth.uid());
$$;

create function public.is_session_member(p_session uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.sessions s
                  where s.id = p_session and public.is_activity_member(s.activity_id));
$$;

create function public.is_session_organiser(p_session uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.sessions s
                  where s.id = p_session and public.is_activity_organiser(s.activity_id));
$$;

create function public.session_has_member(p_session uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.sessions s
                   join public.activity_members m on m.activity_id = s.activity_id
                  where s.id = p_session and m.user_id = p_user and m.status = 'member');
$$;

revoke all on function public.session_has_member(uuid, uuid) from public;
grant execute on function public.session_has_member(uuid, uuid) to anon, authenticated;

revoke all on function public.is_activity_member(uuid), public.is_activity_organiser(uuid),
  public.is_session_member(uuid), public.is_session_organiser(uuid) from public;
grant execute on function public.is_activity_member(uuid), public.is_activity_organiser(uuid),
  public.is_session_member(uuid), public.is_session_organiser(uuid) to anon, authenticated;

-- Joining: status is decided by the activity's approval_mode, never by the client.
create function public.activity_members_set_status() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    select case a.approval_mode when 'open' then 'member' else 'pending' end
      into new.status from public.activities a where a.id = new.activity_id;
  end if;
  return new;
end $$;
create trigger activity_members_set_status before insert on public.activity_members
  for each row execute function public.activity_members_set_status();

-- Organiser may change a membership's status only, never re-point the row.
create function public.activity_members_guard_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin()
     and (new.activity_id, new.user_id) is distinct from (old.activity_id, old.user_id) then
    raise exception 'membership key not editable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger activity_members_guard_update before update on public.activity_members
  for each row execute function public.activity_members_guard_update();

-- A non-admin may link an activity to an unverified association, or to one they claimed.
create function public.activities_guard_association() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin()
     and new.organised_by_association_id is not null
     and (tg_op = 'INSERT'
          or new.organised_by_association_id is distinct from old.organised_by_association_id)
     and exists (select 1 from public.associations a
                  where a.id = new.organised_by_association_id and a.verified
                    and a.claimed_by is distinct from auth.uid()) then
    raise exception 'association not linkable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger activities_guard_association before insert or update on public.activities
  for each row execute function public.activities_guard_association();

create function public.attendances_touch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger attendances_touch before insert or update on public.attendances
  for each row execute function public.attendances_touch();

alter table public.activities enable row level security;
alter table public.activity_tags enable row level security;
alter table public.activity_members enable row level security;
alter table public.activity_interests enable row level security;
alter table public.sessions enable row level security;
alter table public.attendances enable row level security;

revoke all on public.activities, public.activity_tags, public.activity_members,
  public.activity_interests, public.sessions, public.attendances from anon;
grant select on public.activities, public.activity_tags, public.sessions to anon;
revoke truncate, references, trigger on
  public.activities, public.activity_tags, public.activity_members,
  public.activity_interests, public.sessions, public.attendances
  from anon, authenticated;
grant select, insert, update, delete on
  public.activities, public.activity_tags, public.activity_members,
  public.activity_interests, public.sessions, public.attendances to authenticated;

-- activities
create policy activities_select on public.activities for select to anon, authenticated using (true);
create policy activities_insert on public.activities for insert to authenticated
  with check (organiser_id = auth.uid()
    and coalesce((select p.phone_verified from public.profiles p where p.id = auth.uid()), false));
create policy activities_update on public.activities for update to authenticated
  using (organiser_id = auth.uid()) with check (organiser_id = auth.uid());
create policy activities_delete on public.activities for delete to authenticated
  using (organiser_id = auth.uid());
create policy activities_admin on public.activities for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- activity_tags
create policy activity_tags_select on public.activity_tags for select to anon, authenticated using (true);
create policy activity_tags_organiser on public.activity_tags for all to authenticated
  using (public.is_activity_organiser(activity_id)) with check (public.is_activity_organiser(activity_id));
create policy activity_tags_admin on public.activity_tags for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- activity_members (users also see their own row so a pending applicant sees their status)
create policy members_select on public.activity_members for select to authenticated
  using (user_id = auth.uid() or public.is_activity_organiser(activity_id)
         or (status = 'member' and public.is_activity_member(activity_id)));
create policy members_insert on public.activity_members for insert to authenticated
  with check (user_id = auth.uid()
    and status = (select case a.approval_mode when 'open' then 'member' else 'pending' end
                    from public.activities a where a.id = activity_id));
create policy members_update_organiser on public.activity_members for update to authenticated
  using (public.is_activity_organiser(activity_id)) with check (public.is_activity_organiser(activity_id));
create policy members_leave on public.activity_members for delete to authenticated
  using (user_id = auth.uid() and status in ('member', 'pending'));
create policy members_admin on public.activity_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- activity_interests
create policy interests_own on public.activity_interests for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy interests_organiser_select on public.activity_interests for select to authenticated
  using (public.is_activity_organiser(activity_id));
create policy interests_admin on public.activity_interests for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- sessions
create policy sessions_select on public.sessions for select to anon, authenticated using (true);
create policy sessions_insert on public.sessions for insert to authenticated
  with check (public.is_activity_organiser(activity_id));
create policy sessions_update on public.sessions for update to authenticated
  using (public.is_activity_organiser(activity_id)) with check (public.is_activity_organiser(activity_id));
create policy sessions_admin on public.sessions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- attendances: participants set confirmed/cancelled/cancelled_late on their own row (members only);
-- no_show is organiser-only and a participant cannot overwrite it.
create policy attendances_select on public.attendances for select to authenticated
  using (public.is_session_member(session_id));
create policy attendances_insert_own on public.attendances for insert to authenticated
  with check (user_id = auth.uid() and status in ('confirmed', 'cancelled', 'cancelled_late')
    and public.is_session_member(session_id));
create policy attendances_update_own on public.attendances for update to authenticated
  using (user_id = auth.uid() and status <> 'no_show' and public.is_session_member(session_id))
  with check (user_id = auth.uid() and status in ('confirmed', 'cancelled', 'cancelled_late')
    and public.is_session_member(session_id));
create policy attendances_organiser_no_show on public.attendances for update to authenticated
  using (public.is_session_organiser(session_id))
  with check (public.is_session_organiser(session_id) and status = 'no_show'
    and public.session_has_member(session_id, user_id));
create policy attendances_admin on public.attendances for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
