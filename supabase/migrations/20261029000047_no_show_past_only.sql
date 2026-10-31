-- DB-7 (pre-launch security review): an organiser could mark a member as a no-show for a session
-- that had not happened yet (or one the member had cancelled). The member could then no longer
-- confirm or cancel (attendances_update_own refuses no_show rows), and their record was wrong.
-- The organiser may now mark only a confirmed attendance of a session that has started.

drop policy attendances_organiser_no_show on public.attendances;
create policy attendances_organiser_no_show on public.attendances for update to authenticated
  using (public.is_session_organiser(session_id)
    and status = 'confirmed'
    and exists (select 1 from public.sessions s where s.id = session_id and s.starts_at <= now()))
  with check (public.is_session_organiser(session_id)
    and status = 'no_show'
    and public.session_has_member(session_id, user_id)
    and exists (select 1 from public.sessions s where s.id = session_id and s.starts_at <= now()));
