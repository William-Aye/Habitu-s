-- Admin security: admin rights need a two-factor (aal2) session, every admin action is audited,
-- and accounts can be banned.

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false)
    and coalesce((auth.jwt() ->> 'aal') = 'aal2', false);
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

alter table public.profiles add column banned_at timestamptz;

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index admin_audit_log_created on public.admin_audit_log (created_at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;

create function public.admin_log(
  p_action text, p_target_type text, p_target_id uuid, p_details jsonb default '{}'
) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, details)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'));
$$;
revoke all on function public.admin_log(text, text, uuid, jsonb) from public, anon, authenticated;

create function public.admin_audit_page(p_before timestamptz default null, p_limit int default 50)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id)
      from (select l.id, l.admin_id, l.action, l.target_type, l.target_id, l.details, l.created_at
              from public.admin_audit_log l
             where p_before is null or l.created_at < p_before
             order by l.created_at desc, l.id
             limit greatest(1, least(coalesce(p_limit, 50), 200))) x), '[]'));
end $$;
revoke all on function public.admin_audit_page(timestamptz, int) from public, anon;
grant execute on function public.admin_audit_page(timestamptz, int) to authenticated;

create function public.ban_user(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update auth.users set banned_until = 'infinity' where id = p_user;
  update public.profiles set banned_at = coalesce(banned_at, now()) where id = p_user;
  update public.activities set archived_at = now()
   where organiser_id = p_user and archived_at is null;
  delete from public.collectif_members where user_id = p_user;
end $$;
revoke all on function public.ban_user(uuid, text) from public, anon, authenticated;
