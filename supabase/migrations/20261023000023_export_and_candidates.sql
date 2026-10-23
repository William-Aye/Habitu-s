-- Data export: add collectif memberships, collectifs created and the notification history.
-- Collectif candidates: only non-archived activities count.
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return jsonb_build_object(
    'account', (select jsonb_build_object(
        'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
        'providers', coalesce((select jsonb_agg(i.provider order by i.provider)
                                 from auth.identities i where i.user_id = u.id), '[]'::jsonb))
      from auth.users u where u.id = v_uid),
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
    'session_feedback_sent', coalesce((select jsonb_agg(to_jsonb(sf)) from public.session_feedback sf where sf.user_id = v_uid), '[]'),
    'safety_tips_seen', coalesce((select jsonb_agg(to_jsonb(st)) from public.safety_tips_seen st where st.user_id = v_uid), '[]'),
    'notification_log', coalesce((select jsonb_agg(to_jsonb(nl)) from public.notification_log nl where nl.user_id = v_uid), '[]'),
    'push_tokens', coalesce((select jsonb_agg(jsonb_build_object('token', pt.token, 'platform', pt.platform, 'updated_at', pt.updated_at)) from public.push_tokens pt where pt.user_id = v_uid), '[]'),
    'collectif_memberships', coalesce((select jsonb_agg(to_jsonb(cm)) from public.collectif_members cm where cm.user_id = v_uid), '[]'),
    'collectifs_created', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'description', c.description, 'town_label', c.town_label,
        'town_point', ST_AsText(c.town_point::geometry), 'created_at', c.created_at))
      from public.collectifs c where c.created_by = v_uid), '[]'),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', n.kind, 'title', n.title, 'body', n.body, 'data', n.data, 'send_after', n.send_after,
        'sent_at', n.sent_at, 'failed_at', n.failed_at) order by n.id)
      from public.notification_outbox n where n.user_id = v_uid), '[]'),
    'organiser_stats', (select to_jsonb(o) from public.organiser_stats o where o.user_id = v_uid)
  );
end $$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- Collectif candidates (as in 20261023000018): archived activities no longer count.
create or replace function public.collectif_candidates(p_collectif uuid)
returns table (user_id uuid, first_name text, photo_url text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_collectif_responsable(p_collectif) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select p.id, p.first_name, p.photo_url
      from public.profiles p
     where p.id in (select am.user_id
                      from public.activity_members am
                      join public.activities a on a.id = am.activity_id
                     where a.organised_by_collectif_id = p_collectif and am.status = 'member'
                       and a.archived_at is null)
       and p.first_name <> '' and p.age_confirmed
       and p.created_at <= now() - interval '24 hours'
       and not public.is_blocked_between(p.id)
       and not exists (select 1 from public.collectif_members m
                        where m.collectif_id = p_collectif and m.user_id = p.id)
     order by p.first_name, p.id;
end $$;
