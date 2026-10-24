-- Retention jobs, inactive-account cleanup and storage file deletion (RGPD).
--
-- Files in Storage are removed through the Storage API only (a direct delete from storage.objects
-- leaves the backing file behind on hosted Supabase). SQL therefore records what must go in
-- storage_deletions and the storage-cleanup Edge Function, called every 10 minutes by pg_cron through
-- pg_net, removes the files and clears the rows. Vault secrets (same pattern as drain_outbox):
--   send_push_key         the service-role key, shared with send-push
--   storage_cleanup_url   https://<project>.supabase.co/functions/v1/storage-cleanup

create table public.storage_deletions (
  id bigserial primary key,
  bucket text not null,
  path text not null,
  queued_at timestamptz not null default now(),
  unique (bucket, path)
);
alter table public.storage_deletions enable row level security;
revoke all on public.storage_deletions from public, anon, authenticated;
grant select, delete on public.storage_deletions to service_role;
grant usage, select on sequence public.storage_deletions_id_seq to service_role;

-- Internal: queues every file of a user (folder <uid>/) in the three private/avatar buckets.
create function public.queue_user_storage_deletion(p_user uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.storage_deletions (bucket, path)
  select o.bucket_id, o.name
    from storage.objects o
   where o.bucket_id in ('avatars', 'claim-documents', 'feedback-screenshots')
     and (storage.foldername(o.name))[1] = p_user::text
  on conflict (bucket, path) do nothing;
$$;
revoke all on function public.queue_user_storage_deletion(uuid) from public, anon, authenticated;

-- Internal: the single way an account goes away (self-deletion and inactivity purge). Files are queued
-- first; feedback is kept without the link to the person, so its screenshot reference goes too.
create function public.purge_account(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.queue_user_storage_deletion(p_user);
  update public.feedback set screenshot_path = null
   where user_id = p_user and screenshot_path is not null;
  delete from auth.users where id = p_user;
end $$;
revoke all on function public.purge_account(uuid) from public, anon, authenticated;

-- delete_my_account: migration 9's, with the storage.objects delete replaced by the queue.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  perform public.purge_account(v_uid);
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Owners can delete their own uploads in the two private buckets (avatars already has its policy).
create policy claim_documents_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'claim-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy feedback_screenshots_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'feedback-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

-- Decided claims keep their row (history) but lose the document after a year, so a claim may end
-- up with neither proof; the rule stays for pending ones.
alter table public.association_claims drop constraint association_claims_proof;
alter table public.association_claims add constraint association_claims_proof
  check (status <> 'pending' or contact_email is not null or document_path is not null) not valid;

-- Inactive accounts
alter table public.profiles add column inactivity_notice_at timestamptz;

-- Any newer last_seen_at (touch_last_seen) withdraws the notice.
create function public.profiles_clear_inactivity_notice() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.last_seen_at is not null and new.last_seen_at > coalesce(old.last_seen_at, '-infinity'::timestamptz) then
    new.inactivity_notice_at := null;
  end if;
  return new;
end $$;
revoke all on function public.profiles_clear_inactivity_notice() from public, anon, authenticated;
create trigger profiles_clear_inactivity_notice before update of last_seen_at on public.profiles
  for each row execute function public.profiles_clear_inactivity_notice();

-- Notification texts: migration 31's set plus inactivity_notice (exact copy).
create or replace function public.notif_text(p_kind text, p_lang text) returns table (title text, body text)
language sql immutable set search_path = public, pg_temp as $$
  select case when p_lang = 'en' then t.title_en else t.title_fr end,
         case when p_lang = 'en' then t.body_en else t.body_fr end
    from (values
      ('session_reminder', 'Rappel', 'Vous avez une activité demain. Serez-vous là ?',
                           'Reminder', 'You have an activity tomorrow. Will you be there?'),
      ('new_member', 'Nouveau membre', 'Quelqu''un a rejoint votre activité.',
                     'New member', 'Someone joined your activity.'),
      ('join_request', 'Nouvelle demande', 'Une personne souhaite rejoindre votre activité.',
                       'New request', 'Someone would like to join your activity.'),
      ('request_accepted', 'Demande acceptée', 'Votre demande a été acceptée.',
                           'Request accepted', 'Your request was accepted.'),
      ('late_cancellation', 'Désistement tardif', 'Une personne ne viendra pas à une prochaine séance.',
                             'Late cancellation', 'Someone can no longer make an upcoming session.'),
      ('session_cancelled', 'Séance annulée', 'Une séance de votre activité est annulée.',
                             'Session cancelled', 'A session of your activity is cancelled.'),
      ('session_moved', 'Séance modifiée', 'Une séance de votre activité a changé.',
                         'Session changed', 'A session of your activity has changed.'),
      ('session_rule_changed', 'Séance modifiée', 'Une séance de votre activité a changé.',
                                'Session changed', 'A session of your activity has changed.'),
      ('collectif_invitation', 'Invitation', 'Vous êtes invité à organiser un collectif.',
                                'Invitation', 'You are invited to organise a collective.'),
      ('chat_message', 'Nouveau message', 'Nouveau message dans une de vos activités.',
                       'New message', 'New message in one of your activities.'),
      ('report_handled', 'Information de modération', 'Ouvrez l''application pour voir le détail.',
                         'Moderation information', 'Open the app to see the details.'),
      ('moderation_notice', 'Information de modération', 'Ouvrez l''application pour voir le détail.',
                            'Moderation information', 'Open the app to see the details.'),
      ('claim_decided', 'Demande traitée', 'Ouvrez l''application pour voir le détail.',
                        'Request handled', 'Open the app to see the details.'),
      ('category_decided', 'Demande traitée', 'Ouvrez l''application pour voir le détail.',
                           'Request handled', 'Open the app to see the details.'),
      ('inactivity_notice', 'Compte inactif',
                            'Votre compte sera supprimé dans 30 jours faute d''activité. Ouvrez l''application pour le garder.',
                            'Inactive account',
                            'Your account will be deleted in 30 days because of inactivity. Open the app to keep it.')
    ) as t(kind, title_fr, body_fr, title_en, body_en)
   where t.kind = p_kind
  union all
  select case when p_lang = 'en' then 'Notification' else 'Notification' end,
         case when p_lang = 'en' then 'Open the app to see the details.' else 'Ouvrez l''application pour voir le détail.' end
   where p_kind not in ('session_reminder', 'new_member', 'join_request', 'request_accepted', 'late_cancellation',
                        'session_cancelled', 'session_moved', 'session_rule_changed', 'collectif_invitation',
                        'chat_message', 'report_handled', 'moderation_notice', 'claim_decided',
                        'category_decided', 'inactivity_notice');
$$;

create function public.run_retention() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reports int; v_snapshots int; v_audit int; v_feedback int; v_sf int;
  v_claims int; v_docs int; v_docs2 int; v_orphans int;
begin
  -- Reports and snapshots: 3 years after the decision, or after creation while still open.
  select count(*), coalesce(sum((select count(*) from public.report_snapshots s where s.report_id = r.id)), 0)::int
    into v_reports, v_snapshots
    from public.reports r where coalesce(r.decided_at, r.created_at) < now() - interval '3 years';
  delete from public.reports where coalesce(decided_at, created_at) < now() - interval '3 years';

  delete from public.admin_audit_log where created_at < now() - interval '3 years';
  get diagnostics v_audit = row_count;

  -- Feedback: 2 years, with its screenshot.
  insert into public.storage_deletions (bucket, path)
  select 'feedback-screenshots', f.screenshot_path from public.feedback f
   where f.created_at < now() - interval '2 years' and f.screenshot_path is not null
  on conflict (bucket, path) do nothing;
  delete from public.feedback where created_at < now() - interval '2 years';
  get diagnostics v_feedback = row_count;

  delete from public.session_feedback where created_at < now() - interval '6 months';
  get diagnostics v_sf = row_count;

  -- Claims: a pending one is dropped after a year with its document; a decided one keeps its row
  -- but loses the document a year after the decision.
  insert into public.storage_deletions (bucket, path)
  select 'claim-documents', c.document_path from public.association_claims c
   where c.status = 'pending' and c.created_at < now() - interval '1 year' and c.document_path is not null
  on conflict (bucket, path) do nothing;
  select count(*) into v_docs from public.association_claims c
   where c.status = 'pending' and c.created_at < now() - interval '1 year' and c.document_path is not null;
  delete from public.association_claims where status = 'pending' and created_at < now() - interval '1 year';
  get diagnostics v_claims = row_count;

  insert into public.storage_deletions (bucket, path)
  select 'claim-documents', c.document_path from public.association_claims c
   where c.status <> 'pending' and coalesce(c.decided_at, c.created_at) < now() - interval '1 year'
     and c.document_path is not null
  on conflict (bucket, path) do nothing;
  update public.association_claims set document_path = null, contact_email = null
   where status <> 'pending' and coalesce(decided_at, created_at) < now() - interval '1 year'
     and document_path is not null;
  get diagnostics v_docs2 = row_count;

  -- Orphan uploads: files nothing references after 7 days (abandoned forms, failed inserts).
  insert into public.storage_deletions (bucket, path)
  select o.bucket_id, o.name from storage.objects o
   where o.created_at < now() - interval '7 days'
     and ((o.bucket_id = 'claim-documents'
           and not exists (select 1 from public.association_claims c where c.document_path = o.name))
       or (o.bucket_id = 'feedback-screenshots'
           and not exists (select 1 from public.feedback f where f.screenshot_path = o.name)))
  on conflict (bucket, path) do nothing;
  get diagnostics v_orphans = row_count;

  return jsonb_build_object('reports', v_reports, 'report_snapshots', v_snapshots, 'admin_audit_log', v_audit,
                            'feedback', v_feedback, 'session_feedback', v_sf, 'claims', v_claims,
                            'claim_documents', v_docs + v_docs2, 'orphan_uploads', v_orphans);
end $$;
revoke all on function public.run_retention() from public, anon, authenticated;
select cron.schedule('retention', '20 3 * * *', 'select public.run_retention()');

-- Notice at 35 months without activity; deletion 30 days later if still inactive (banned accounts: no notice).
create function public.run_inactive_accounts() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_notified int := 0; v_cleared int; v_deleted int := 0;
  r record;
begin
  -- A notice the person has since answered by coming back is withdrawn.
  update public.profiles p set inactivity_notice_at = null
    from auth.users u
   where u.id = p.id and p.inactivity_notice_at is not null
     and coalesce(p.last_seen_at, u.last_sign_in_at, u.created_at) >= p.inactivity_notice_at;
  get diagnostics v_cleared = row_count;

  -- Never-seen accounts count from their last sign-in, else from their creation.
  for r in select p.id from public.profiles p join auth.users u on u.id = p.id
            where coalesce(p.last_seen_at, u.last_sign_in_at, u.created_at) < now() - interval '35 months'
              and p.inactivity_notice_at is null and p.banned_at is null
            order by p.id loop
    perform public.notify_user(r.id, 'inactivity_notice', 'Compte inactif',
      'Votre compte sera supprimé dans 30 jours faute d''activité. Ouvrez l''application pour le garder.',
      'Inactive account', 'Your account will be deleted in 30 days because of inactivity. Open the app to keep it.',
      jsonb_build_object('kind', 'inactivity_notice'), 'inactivity_notice:' || r.id);
    update public.profiles set inactivity_notice_at = now() where id = r.id;
    v_notified := v_notified + 1;
  end loop;

  -- Admins are warned but never purged automatically.
  for r in select p.id from public.profiles p join auth.users u on u.id = p.id
            where p.inactivity_notice_at < now() - interval '30 days' and p.role <> 'admin'
              and coalesce(p.last_seen_at, u.last_sign_in_at, u.created_at) < p.inactivity_notice_at
            order by p.id loop
    perform public.purge_account(r.id);
    v_deleted := v_deleted + 1;
  end loop;
  -- A banned account gets no notice (it cannot open the app to answer it): it goes once it has been inactive
  -- for 36 months and 30 days. Admins are never purged automatically.
  for r in select p.id from public.profiles p join auth.users u on u.id = p.id
            where p.banned_at is not null and p.role <> 'admin'
              and coalesce(p.last_seen_at, u.last_sign_in_at, u.created_at) < now() - interval '36 months 30 days'
            order by p.id loop
    perform public.purge_account(r.id);
    v_deleted := v_deleted + 1;
  end loop;
  return jsonb_build_object('notified', v_notified, 'cleared', v_cleared, 'deleted', v_deleted);
end $$;
revoke all on function public.run_inactive_accounts() from public, anon, authenticated;
select cron.schedule('inactive-accounts', '40 3 * * *', 'select public.run_inactive_accounts()');

-- limit_log: one day is enough for the longest (24 hour) window.
create function public.prune_limit_log() returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.limit_log where at < now() - interval '1 day';
$$;
revoke all on function public.prune_limit_log() from public, anon, authenticated;
select cron.schedule('hourly-limits', '5 * * * *', 'select public.prune_limit_log()');

-- Calls the storage-cleanup Edge Function when files are waiting (no-op without the Vault secrets).
create function public.drain_storage_deletions() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key text;
  v_url text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'send_push_key';
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'storage_cleanup_url';
  if v_key is null or v_url is null then
    return;
  end if;
  if not exists (select 1 from public.storage_deletions) then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
end $$;
revoke all on function public.drain_storage_deletions() from public, anon, authenticated;
select cron.schedule('storage-cleanup', '*/10 * * * *', 'select public.drain_storage_deletions()');
