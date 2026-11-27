-- Activities with children (docs/superpowers/specs/2026-11-26-child-safety-design.md).
-- An activity of the Parents category, or one its organiser marks "Des enfants seront présents", always
-- needs approval, and only established accounts (a profile photo, an account at least 7 days old) may
-- organise one or ask to join one. Admins are exempt.

-- ---------------------------------------------------------------------------------------------
-- Helpers.

create function public.is_family_category(p_category uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.categories c
                   left join public.categories p on p.id = c.parent_id
                  where c.id = p_category and (c.slug = 'family' or p.slug = 'family'));
$$;
revoke all on function public.is_family_category(uuid) from public, anon;
grant execute on function public.is_family_category(uuid) to authenticated;

-- What the caller still lacks to take part in an activity with children: 'photo', 'account_age'.
create function public.children_requirements_missing() returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.is_admin() then '{}'::text[]
              else coalesce((select array_remove(array[
                       case when p.photo_url is null then 'photo' end,
                       case when p.created_at > now() - interval '7 days' then 'account_age' end], null)
                     from public.profiles p where p.id = auth.uid()), '{photo,account_age}'::text[]) end;
$$;
revoke all on function public.children_requirements_missing() from public, anon;
grant execute on function public.children_requirements_missing() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The flag.

alter table public.activities add column with_children boolean not null default false;

update public.activities
   set with_children = true, approval_mode = 'approval'
 where public.is_family_category(category_id);

alter table public.activities add constraint activities_children_need_approval
  check (not with_children or approval_mode = 'approval');

grant select (with_children) on public.activities to anon, authenticated;

create function public.activities_with_children() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if public.is_family_category(new.category_id) then
    new.with_children := true;
  end if;
  if new.with_children then
    new.approval_mode := 'approval';
    if (tg_op = 'INSERT' or not old.with_children)
       and current_user in ('anon', 'authenticated') and not public.is_admin()
       and cardinality(public.children_requirements_missing()) > 0 then
      raise exception 'children_requirements_not_met' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger activities_with_children
  before insert or update on public.activities
  for each row execute function public.activities_with_children();

-- Asking to join.
create function public.activity_members_children_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin()
     and exists (select 1 from public.activities a where a.id = new.activity_id and a.with_children)
     and cardinality(public.children_requirements_missing()) > 0 then
    raise exception 'children_requirements_not_met' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger activity_members_children_guard
  before insert on public.activity_members
  for each row execute function public.activity_members_children_guard();

-- Trigger functions are never called through the API.
revoke all on function public.activities_with_children() from public, anon, authenticated;
revoke all on function public.activity_members_children_guard() from public, anon, authenticated;
