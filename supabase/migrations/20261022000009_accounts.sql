-- Accounts: last seen, home-area snapping, my-data export, account deletion, avatars bucket.

-- last_seen_at: written only through touch_last_seen(); not part of the API column-update grant.
alter table public.profiles add column last_seen_at timestamptz;

-- home_area is snapped to a 0.01 degree grid (~1 km) whatever the client sends.
create function public.profiles_snap_home_area() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  if new.home_area is not null then
    new.home_area := ST_SetSRID(ST_MakePoint(
      round(ST_X(new.home_area::geometry)::numeric, 2),
      round(ST_Y(new.home_area::geometry)::numeric, 2)), 4326)::geography;
  end if;
  return new;
end $$;
revoke all on function public.profiles_snap_home_area() from public, anon, authenticated;

create trigger profiles_snap_home_area before insert or update of home_area on public.profiles
  for each row execute function public.profiles_snap_home_area();

-- At most one write per hour per user.
create function public.touch_last_seen() returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.profiles set last_seen_at = now()
   where id = auth.uid() and (last_seen_at is null or last_seen_at < now() - interval '1 hour');
$$;
revoke all on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;

-- RGPD export: every personal row of the caller, nothing about others. Other people's ids appear only
-- as targets the caller acted on (activity, association, blocked user, message recipient, report target).
-- session_feedback is anonymous by design (its user_id is only a uniqueness guard) and is excluded.
-- Admin-only columns (admin_note, moderation decisions) are left out of the rows.
create function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return jsonb_build_object(
    'profile', (select to_jsonb(p) - 'home_area' || jsonb_build_object('home_area', ST_AsText(p.home_area::geometry))
                  from public.profiles p where p.id = v_uid),
    'interests', coalesce((select jsonb_agg(to_jsonb(i)) from public.user_interests i where i.user_id = v_uid), '[]'),
    'category_requests', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'requested_name', r.requested_name, 'status', r.status, 'created_at', r.created_at))
      from public.category_requests r where r.user_id = v_uid), '[]'),
    'activities_organised', coalesce((select jsonb_agg(to_jsonb(a) - 'embedding' - 'place'
        || jsonb_build_object('place', ST_AsText(a.place::geometry)))
      from public.activities a where a.organiser_id = v_uid), '[]'),
    'memberships', coalesce((select jsonb_agg(to_jsonb(m)) from public.activity_members m where m.user_id = v_uid), '[]'),
    'interests_in_activities', coalesce((select jsonb_agg(to_jsonb(ai)) from public.activity_interests ai where ai.user_id = v_uid), '[]'),
    'attendances', coalesce((select jsonb_agg(to_jsonb(t)) from public.attendances t where t.user_id = v_uid), '[]'),
    'messages_sent', coalesce((select jsonb_agg(to_jsonb(ms)) from public.messages ms where ms.sender_id = v_uid), '[]'),
    'reports_filed', coalesce((select jsonb_agg(jsonb_build_object(
        'id', rp.id, 'target_type', rp.target_type, 'target_id', rp.target_id, 'reason', rp.reason,
        'details', rp.details, 'status', rp.status, 'created_at', rp.created_at))
      from public.reports rp where rp.reporter_id = v_uid), '[]'),
    'blocks', coalesce((select jsonb_agg(to_jsonb(b)) from public.blocks b where b.blocker_id = v_uid), '[]'),
    'saved_searches', coalesce((select jsonb_agg(to_jsonb(s) - 'center'
        || jsonb_build_object('center', ST_AsText(s.center::geometry)))
      from public.saved_searches s where s.user_id = v_uid), '[]'),
    'association_waiters', coalesce((select jsonb_agg(to_jsonb(w)) from public.association_waiters w where w.user_id = v_uid), '[]'),
    'association_claims', coalesce((select jsonb_agg(to_jsonb(c)) from public.association_claims c where c.claimant_id = v_uid), '[]'),
    'feedback_sent', coalesce((select jsonb_agg(to_jsonb(f)) from public.feedback f where f.user_id = v_uid), '[]'),
    'organiser_stats', (select to_jsonb(o) from public.organiser_stats o where o.user_id = v_uid)
  );
end $$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- Immediate deletion. Rows cascade from auth.users -> profiles. reports.reporter_id and feedback.user_id
-- are set null (moderation history and product feedback are kept, no longer linked to the person).
-- Deleting storage.objects by SQL removes the metadata only; Supabase discourages it because the file
-- may linger in the backing store. Acceptable for now.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  -- storage.protect_delete() blocks direct deletes unless this transaction-local flag is set.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'avatars' and (storage.foldername(name))[1] = v_uid::text;
  perform set_config('storage.allow_delete_query', 'false', true);
  delete from auth.users where id = v_uid;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Avatars: public read, JPEG only, 1 MB, one folder per user.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, '{image/jpeg}')
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
