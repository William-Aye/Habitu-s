-- DB-4 and AUTH-4 (pre-launch security review): a banned person keeps a valid access token for up
-- to an hour (Auth refuses the refresh, by design). refuse_banned_writer covered INSERT on twelve
-- tables only, so in that hour they could still edit their profile, a claimed club's public page,
-- sessions, attendances and blocks, and insert into the tables without the guard. Now:
--   * the same guard runs BEFORE UPDATE on every table a client may update, and BEFORE INSERT on
--     the remaining client-writable tables (search_misses is left out on purpose: search_explore
--     logs a miss for every reader, and a failed search would not protect anything);
--   * ban_user also releases the person's association claims (claimed_by cleared, verified false),
--     so a club never stays shown as claimed by a banned person.
-- ban_user is migration 29's with the claim release added.

create trigger refuse_banned_writer before update on public.profiles
  for each row execute function public.refuse_banned_writer();
create trigger refuse_banned_writer_update before update on public.associations
  for each row execute function public.refuse_banned_writer();
create trigger refuse_banned_writer_update before update on public.activities
  for each row execute function public.refuse_banned_writer();
create trigger refuse_banned_writer before insert or update on public.sessions
  for each row execute function public.refuse_banned_writer();
create trigger refuse_banned_writer_update before update on public.collectifs
  for each row execute function public.refuse_banned_writer();
create trigger refuse_banned_writer_update before update on public.collectif_members
  for each row execute function public.refuse_banned_writer();
create trigger refuse_banned_writer_update before update on public.activity_members
  for each row execute function public.refuse_banned_writer();
create trigger refuse_banned_writer_update before update on public.attendances
  for each row execute function public.refuse_banned_writer();
create trigger refuse_banned_writer_update before update on public.blocks
  for each row execute function public.refuse_banned_writer();
create trigger refuse_banned_writer before insert or update on public.user_interests
  for each row execute function public.refuse_banned_writer();
create trigger refuse_banned_writer before insert or update on public.saved_searches
  for each row execute function public.refuse_banned_writer();
create trigger refuse_banned_writer before insert or update on public.activity_interests
  for each row execute function public.refuse_banned_writer();
create trigger refuse_banned_writer before insert on public.association_waiters
  for each row execute function public.refuse_banned_writer();
create trigger refuse_banned_writer before insert or update on public.session_feedback
  for each row execute function public.refuse_banned_writer();
create trigger refuse_banned_writer before insert or update on public.safety_tips_seen
  for each row execute function public.refuse_banned_writer();
create trigger refuse_banned_writer before insert or update on public.activity_tags
  for each row execute function public.refuse_banned_writer();
create trigger refuse_banned_writer before insert or update on public.association_tags
  for each row execute function public.refuse_banned_writer();

create or replace function public.ban_user(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- a finite far date: Auth's Go scanner returns 500 on 'infinity'
  update auth.users set banned_until = now() + interval '100 years' where id = p_user;
  update public.profiles set banned_at = coalesce(banned_at, now()) where id = p_user;
  update public.activities set archived_at = coalesce(archived_at, now()), removed_by_moderation_at = coalesce(removed_by_moderation_at, now())
   where organiser_id = p_user and (archived_at is null or removed_by_moderation_at is null);
  -- the person's clubs are no longer theirs to edit, nor shown as claimed
  update public.associations set claimed_by = null, verified = false where claimed_by = p_user;
  -- the after-delete trigger frees future attendances and the welcome role
  delete from public.activity_members where user_id = p_user;
  delete from public.collectif_members where user_id = p_user;
  -- sessions and refresh tokens are kept: Auth refuses a banned user's refresh with user_banned itself
end $$;
revoke all on function public.ban_user(uuid, text) from public, anon, authenticated;
