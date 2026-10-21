-- Profiles, categories, tags, interests, category requests.

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  first_name text not null default '',
  photo_url text,
  bio text check (char_length(bio) <= 500),
  home_area geography(Point, 4326),
  home_area_label text,
  language text not null default 'fr' check (language in ('fr', 'en')),
  age_confirmed boolean not null default false,
  phone_verified boolean not null default false,
  role text not null default 'user' check (role in ('user', 'admin')),
  supporter boolean not null default false,
  created_at timestamptz not null default now()
);

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false);
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, first_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'first_name', ''));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories on delete restrict,
  slug text unique not null,
  name_fr text not null,
  name_en text not null,
  icon text not null,
  sort_order int not null default 0
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  label_fr text not null,
  label_en text not null
);

create table public.user_interests (
  user_id uuid not null references public.profiles on delete cascade,
  category_id uuid not null references public.categories on delete cascade,
  level text not null check (level in ('like', 'love', 'curious')),
  primary key (user_id, category_id)
);

create table public.category_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  requested_name text not null check (char_length(requested_name) between 2 and 80),
  status text not null default 'pending' check (status in ('pending', 'approved', 'merged', 'rejected')),
  admin_note text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.tags enable row level security;
alter table public.user_interests enable row level security;
alter table public.category_requests enable row level security;

-- Table privileges (RLS filters rows on top of these).
revoke all on public.profiles, public.user_interests, public.category_requests from anon;
revoke all on public.categories, public.tags from anon;
grant select on public.categories, public.tags to anon;
-- anon may query profiles (no anon policy, so RLS returns zero rows instead of an error)
grant select on public.profiles to anon;

revoke update on public.profiles from authenticated;
revoke insert, delete on public.profiles from authenticated;
grant update (first_name, photo_url, bio, home_area, home_area_label, language, age_confirmed)
  on public.profiles to authenticated;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- public view: owner-privileged, bypasses base-table RLS, limited columns
create view public.public_profiles with (security_invoker = false) as
  select id, first_name, photo_url, bio, created_at from public.profiles;
alter view public.public_profiles owner to postgres;
revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated;

-- categories, tags: public read, admin write
create policy categories_select on public.categories for select to anon, authenticated using (true);
create policy categories_admin on public.categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy tags_select on public.tags for select to anon, authenticated using (true);
create policy tags_admin on public.tags for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- user_interests
create policy interests_own on public.user_interests for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy interests_admin_select on public.user_interests for select to authenticated
  using (public.is_admin());

-- category_requests
create policy requests_insert on public.category_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and admin_note is null);
create policy requests_select_own on public.category_requests for select to authenticated
  using (user_id = auth.uid());
create policy requests_admin on public.category_requests for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
