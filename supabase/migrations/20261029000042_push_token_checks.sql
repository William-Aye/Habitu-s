-- FN-1 (pre-launch security review): register_push_token took any string of 10 to 300 characters,
-- any number of times. Junk tokens, or tokens of another Expo project, can make Expo refuse a whole
-- batch of 100 messages, failing other people's notifications with them (send-push now also drops
-- malformed tokens and splits a refused batch). Here:
--   * the token must have the Expo push token shape and the platform must be ios or android;
--   * a person keeps at most five tokens (devices): registering a sixth drops the least recently
--     registered ones;
--   * existing tokens that do not have the shape are deleted (they could only ever fail).
-- DB-8 (handing a known token over to the caller) is unchanged on purpose: it is how a shared or
-- resold device moves to its new user, and tokens are not readable through the API.

delete from public.push_tokens where token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$';

create or replace function public.register_push_token(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$' then
    raise exception 'invalid token' using errcode = '22023';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'invalid platform' using errcode = '22023';
  end if;
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, v_uid, p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
  delete from public.push_tokens t
   where t.user_id = v_uid
     and t.token not in (select k.token from public.push_tokens k where k.user_id = v_uid
                          order by (k.token = p_token) desc, k.updated_at desc, k.token limit 5);
end $$;
revoke all on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
