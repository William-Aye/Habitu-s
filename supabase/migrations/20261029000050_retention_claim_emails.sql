-- Retention fix: a decided claim older than a year lost its contact email only when it also had a
-- document. A claim made by e-mail only (no document) kept its contact_email for good, against the
-- privacy text ("the contact email address is deleted 1 year after the decision"). The cleanup now
-- matches rows with a document or a contact email. Everything else in run_retention is unchanged from
-- migration 20261024000032 (the latest definition).
create or replace function public.run_retention() returns jsonb
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
     and (document_path is not null or contact_email is not null);
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
