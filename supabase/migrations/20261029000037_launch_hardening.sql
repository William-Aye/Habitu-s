-- Launch hardening.
-- 1. public.is_banned is no longer an RPC: authenticated and anon cannot call it. Only the
--    security definer functions and triggers (which run as the owner) keep using it.

-- ---------------------------------------------------------------------------------------------
-- 1. is_banned
-- The messages_select_group policy runs as the querying role, so it needs a function that role may
-- execute. It gets one in a schema that PostgREST does not expose (api.schemas is public and
-- graphql_public), so it is not reachable as an RPC. Everything else keeps calling public.is_banned
-- from security definer code, which runs as the owner.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create function private.is_banned(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = p_user and banned_at is not null);
$$;
revoke all on function private.is_banned(uuid) from public, anon;
grant execute on function private.is_banned(uuid) to authenticated;

drop policy messages_select_group on public.messages;
create policy messages_select_group on public.messages for select to authenticated
  using (activity_id is not null and public.is_activity_member(activity_id)
    and created_at >= public.chat_visible_since(activity_id)
    and not public.is_blocked_between(sender_id)
    and not private.is_banned(sender_id));

revoke all on function public.is_banned(uuid) from public, anon, authenticated;

-- The 15 function_search_path_mutable advisor warnings (search.* and importer.* helpers) are NOT
-- fixed here, on purpose: they are invoker-rights SQL functions that PostgreSQL inlines only when
-- they carry no SET clause (migrations 6 and 7, pgTAP 07_search). Pinning search_path would stop the
-- inlining and slow search and the 1.5M-row import. Each body schema-qualifies every name outside
-- pg_catalog. They are permanent, justified entries in supabase/advisors-allowlist.json.
