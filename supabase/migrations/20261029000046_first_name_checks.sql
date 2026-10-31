-- DB-6 and AUTH-10 (pre-launch security review): profiles.first_name had no length limit and no
-- word filter, in the database or at sign-up (handle_new_user copies the sign-up metadata). A
-- 100,000-character name or a slur showed in rosters, chat and push texts ("X a rejoint").
--   * first_name is at most 40 characters (the app's MAX_FIRST_NAME); longer existing names are cut;
--   * a client's change of first_name goes through the banned-word filter (word_filter, as for
--     activity titles and messages);
--   * handle_new_user cuts the sign-up name to 40 characters and leaves it empty when it holds a
--     banned word (refusing would fail the whole sign-up; the app then asks for a first name).
-- The photo_url part of DB-6 is fixed by migration 39. handle_new_user is migration 2's otherwise.

update public.profiles set first_name = left(first_name, 40) where char_length(first_name) > 40;
alter table public.profiles add constraint profiles_first_name_length check (char_length(first_name) <= 40);

create trigger profiles_word_filter before update of first_name on public.profiles
  for each row execute function public.word_filter('first_name');

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text := left(coalesce(new.raw_user_meta_data->>'first_name', ''), 40);
begin
  if public.text_has_banned_word(v_name) then
    v_name := '';
  end if;
  insert into public.profiles (id, first_name) values (new.id, v_name);
  return new;
end $$;
