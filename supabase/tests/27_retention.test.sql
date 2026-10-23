begin;
\ir helpers.inc
select plan(67);
select tests.create_user('adm@rt.fr', 'Admin') as adm \gset
select tests.create_user('ina@rt.fr', 'Ines') as ina \gset
select tests.create_user('old@rt.fr', 'Olga') as old \gset
select tests.create_user('bak@rt.fr', 'Basile') as bak \gset
select tests.create_user('rec@rt.fr', 'Rose') as rec \gset
select tests.create_user('act@rt.fr', 'Aude') as act \gset
select tests.create_user('ban@rt.fr', 'Bruno') as ban \gset
select tests.create_user('del@rt.fr', 'Denis') as del \gset
update profiles set role = 'admin' where id = :'adm';
update profiles set age_confirmed = true;
insert into categories (id, slug, name_fr, name_en, icon) values
  ('00000000-0000-0000-0000-0000000000c1', 'jeux', 'Jeux', 'Games', 'grid-3x3');
insert into associations (id, name, source, confidence, city, location) values
  ('00000000-0000-0000-0000-0000000000d1', 'Club A', 'rna', 85, 'Lyon', 'SRID=4326;POINT(4.85 45.77)'),
  ('00000000-0000-0000-0000-0000000000d2', 'Club B', 'rna', 85, 'Lyon', 'SRID=4326;POINT(4.85 45.77)'),
  ('00000000-0000-0000-0000-0000000000d3', 'Club C', 'rna', 85, 'Lyon', 'SRID=4326;POINT(4.85 45.77)'),
  ('00000000-0000-0000-0000-0000000000d4', 'Club D', 'rna', 85, 'Lyon', 'SRID=4326;POINT(4.85 45.77)'),
  ('00000000-0000-0000-0000-0000000000d5', 'Club E', 'rna', 85, 'Lyon', 'SRID=4326;POINT(4.85 45.77)');

-- structure and privileges
select has_table('public', 'storage_deletions', 'the storage deletion queue exists');
select has_column('public', 'profiles', 'inactivity_notice_at', 'profiles carry the inactivity notice date');
select ok(not has_table_privilege('authenticated', 'public.storage_deletions', 'select'), 'API roles cannot read the queue');
select ok(not has_table_privilege('anon', 'public.storage_deletions', 'insert'), 'anon cannot write the queue');
select ok(has_table_privilege('service_role', 'public.storage_deletions', 'delete'), 'the service role clears the queue');
select tests.act_as(:'ina');
select throws_ok($$ select public.run_retention() $$, '42501', null, 'run_retention is not callable by users');
select throws_ok($$ select public.run_inactive_accounts() $$, '42501', null, 'run_inactive_accounts is not callable by users');
select throws_ok($$ select public.drain_storage_deletions() $$, '42501', null, 'drain_storage_deletions is not callable by users');
select throws_ok($$ select public.queue_user_storage_deletion('00000000-0000-0000-0000-000000000001') $$, '42501', null, 'queue_user_storage_deletion is not callable by users');
select tests.act_as_superuser();
select ok(exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'claim_documents_delete_own' and cmd = 'DELETE'), 'owners can delete their own claim documents');
select ok(exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'feedback_screenshots_delete_own' and cmd = 'DELETE'), 'owners can delete their own feedback screenshots');

-- cron
select is((select schedule from cron.job where jobname = 'retention'), '20 3 * * *', 'retention runs nightly at 03:20');
select is((select schedule from cron.job where jobname = 'inactive-accounts'), '40 3 * * *', 'inactive accounts run nightly at 03:40');
select is((select schedule from cron.job where jobname = 'hourly-limits'), '5 * * * *', 'limit log pruned hourly');
select is((select schedule from cron.job where jobname = 'storage-cleanup'), '*/10 * * * *', 'storage cleanup runs every 10 minutes');

-- reports: 3 years after decided_at, or after created_at while open
insert into reports (id, reporter_id, target_type, target_id, reason, status, decision, statement_of_reasons, decided_at, created_at) values
  ('00000000-0000-0000-0000-00000000e001', :'rec', 'user', :'old', 'other', 'dismissed', 'dismiss', 'Classe sans suite.', now() - interval '3 years 1 day', now() - interval '4 years'),
  ('00000000-0000-0000-0000-00000000e002', :'rec', 'user', :'old', 'other', 'dismissed', 'dismiss', 'Classe sans suite.', now() - interval '3 years' + interval '1 day', now() - interval '4 years'),
  ('00000000-0000-0000-0000-00000000e003', :'rec', 'user', :'old', 'other', 'open', null, null, null, now() - interval '3 years 1 day'),
  ('00000000-0000-0000-0000-00000000e004', :'rec', 'user', :'old', 'other', 'open', null, null, null, now() - interval '3 years' + interval '1 day');
insert into report_snapshots (report_id, snapshot) values
  ('00000000-0000-0000-0000-00000000e001', '{}'), ('00000000-0000-0000-0000-00000000e002', '{}'),
  ('00000000-0000-0000-0000-00000000e003', '{}'), ('00000000-0000-0000-0000-00000000e004', '{}');

-- audit log: 3 years
insert into admin_audit_log (admin_id, action, created_at) values
  (:'adm', 'old_one', now() - interval '3 years 1 day'), (:'adm', 'edge_one', now() - interval '3 years' + interval '1 day');

-- feedback: 2 years, with the screenshot
insert into feedback (id, user_id, type, body, screenshot_path, created_at) values
  ('00000000-0000-0000-0000-00000000f001', :'rec', 'idea', 'Vieux', :'rec' || '/00000000-0000-0000-0000-0000000000aa.png', now() - interval '2 years 1 day'),
  ('00000000-0000-0000-0000-00000000f002', :'rec', 'idea', 'Hier', :'rec' || '/00000000-0000-0000-0000-0000000000bb.png', now() - interval '1 day'),
  ('00000000-0000-0000-0000-00000000f003', null, 'idea', 'Vieux sans capture', null, now() - interval '2 years 1 day');
insert into storage.objects (bucket_id, name) values
  ('feedback-screenshots', :'rec' || '/00000000-0000-0000-0000-0000000000aa.png'),
  ('feedback-screenshots', :'rec' || '/00000000-0000-0000-0000-0000000000bb.png');

-- session feedback: 6 months
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000a1', :'act', '00000000-0000-0000-0000-0000000000c1', 'Partie de go', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00');
insert into sessions (id, activity_id, starts_at) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', now() + interval '2 days');
insert into session_feedback (session_id, user_id, went_well, created_at) values
  ('00000000-0000-0000-0000-0000000000e1', :'rec', true, now() - interval '6 months 1 day'),
  ('00000000-0000-0000-0000-0000000000e1', :'old', true, now() - interval '6 months' + interval '1 day');

-- claims: pending > 1 year deleted with the document; decided > 1 year keeps the row, loses the document
insert into association_claims (id, association_id, claimant_id, proof_method, role_in_association, document_path, contact_email, status, created_at, decided_at) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000d1', :'rec', 'document', 'Presidente', :'rec' || '/old-pending.pdf', null, 'pending', now() - interval '1 year 1 day', null),
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000000d2', :'rec', 'document', 'Presidente', :'rec' || '/young-pending.pdf', null, 'pending', now() - interval '1 year' + interval '1 day', null),
  ('00000000-0000-0000-0000-00000000c003', '00000000-0000-0000-0000-0000000000d3', :'rec', 'document', 'Presidente', :'rec' || '/old-rejected.pdf', null, 'rejected', now() - interval '2 years', now() - interval '1 year 1 day'),
  ('00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-0000000000d4', :'rec', 'document', 'Presidente', :'rec' || '/young-rejected.pdf', null, 'rejected', now() - interval '2 years', now() - interval '1 year' + interval '1 day'),
  ('00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-0000000000d5', :'rec', 'domain_email', 'Presidente', null, 'a@club-e.fr', 'pending', now() - interval '2 years', null);

create temp table r1 as select public.run_retention() as r;
select is((select r->>'reports' from r1), '2', 'two expired reports counted (decided 3y+1d ago, open 3y+1d ago)');
select is((select count(*)::int from reports where id in ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000e003')), 0, 'expired reports are deleted');
select is((select count(*)::int from reports where id in ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000e004')), 2, 'reports one day younger are kept');
select is((select count(*)::int from report_snapshots where report_id in ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000e003')), 0, 'their snapshots go too');
select is((select count(*)::int from report_snapshots where report_id in ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000e004')), 2, 'non-expired snapshots stay');
select is((select r->>'report_snapshots' from r1), '2', 'snapshot count reported');
select is((select count(*)::int from admin_audit_log where action = 'old_one'), 0, 'audit rows older than 3 years are deleted');
select is((select count(*)::int from admin_audit_log where action = 'edge_one'), 1, 'audit rows one day younger stay');
select is((select r->>'admin_audit_log' from r1), '1', 'audit count reported');
select is((select count(*)::int from feedback where id in ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f003')), 0, 'feedback older than 2 years is deleted');
select is((select count(*)::int from feedback where id = '00000000-0000-0000-0000-00000000f002'), 1, 'recent feedback stays');
select is((select r->>'feedback' from r1), '2', 'feedback count reported');
select is((select array_agg(path) from storage_deletions where bucket = 'feedback-screenshots'),
          array[:'rec' || '/00000000-0000-0000-0000-0000000000aa.png'], 'only the expired screenshot is queued for removal');
select is((select count(*)::int from session_feedback), 1, 'raw session feedback older than 6 months is deleted');
select is((select user_id from session_feedback), :'old'::uuid, 'the younger answer stays');
select is((select r->>'session_feedback' from r1), '1', 'session feedback count reported');
select is((select count(*)::int from association_claims where id = '00000000-0000-0000-0000-00000000c001'), 0, 'a pending claim older than a year is deleted');
select is((select count(*)::int from association_claims where id = '00000000-0000-0000-0000-00000000c002'), 1, 'a younger pending claim stays');
select is((select count(*)::int from association_claims where id = '00000000-0000-0000-0000-00000000c005'), 0, 'an old pending claim without a document is deleted too');
select is((select document_path from association_claims where id = '00000000-0000-0000-0000-00000000c003'), null, 'a claim decided over a year ago keeps its row but loses its document');
select is((select document_path from association_claims where id = '00000000-0000-0000-0000-00000000c004'), :'rec' || '/young-rejected.pdf', 'a claim decided less than a year ago keeps its document');
select is((select array_agg(path order by path) from storage_deletions where bucket = 'claim-documents'),
          array[:'rec' || '/old-pending.pdf', :'rec' || '/old-rejected.pdf'] , 'expired claim documents are queued');
select is((select r->>'claims' from r1), '2', 'claims count reported');
select is((select r->>'claim_documents' from r1), '2', 'claim documents count reported');
select lives_ok($$ select public.run_retention() $$, 'a second run does not fail');
select is((select count(*)::int from storage_deletions), 3, 'a second run queues nothing twice');

-- limit_log: 1 day
insert into limit_log (user_id, kind, at) values
  (:'rec', 'report', now() - interval '1 day 1 minute'), (:'rec', 'report', now() - interval '23 hours');
select lives_ok($$ select public.prune_limit_log() $$, 'the hourly prune runs');
select is((select count(*)::int from limit_log where user_id = :'rec'), 1, 'limit_log keeps the last day only');

-- inactive accounts
update profiles set last_seen_at = now() - interval '35 months 1 day' where id = :'ina';
update profiles set last_seen_at = now() - interval '36 months' where id = :'old';
update profiles set inactivity_notice_at = now() - interval '31 days' where id = :'old';
update profiles set last_seen_at = now() - interval '36 months' where id = :'bak';
update profiles set inactivity_notice_at = now() - interval '31 days' where id = :'bak';
update profiles set last_seen_at = now() - interval '1 day' where id = :'rec';
update profiles set last_seen_at = now() - interval '34 months' where id = :'act';
insert into storage.objects (bucket_id, name) values
  ('avatars', :'old' || '/a.jpg'), ('claim-documents', :'old' || '/d.pdf'),
  ('feedback-screenshots', :'old' || '/00000000-0000-0000-0000-0000000000cc.png');
-- Basile is seen again after the notice: the existing last_seen_at path clears it
update profiles set last_seen_at = now() where id = :'bak';
select is((select inactivity_notice_at from profiles where id = :'bak'), null, 'activity clears the notice');
update profiles set inactivity_notice_at = now() - interval '31 days' where id = :'bak';

create temp table r2 as select public.run_inactive_accounts() as r;
select is((select count(*)::int from notification_outbox where user_id = :'ina' and kind = 'inactivity_notice'), 1, 'an account unseen for 35 months gets a notice');
select isnt((select inactivity_notice_at from profiles where id = :'ina'), null, 'its notice date is stored');
select is((select r->>'notified' from r2), '1', 'notified count reported');
select is((select count(*)::int from notification_outbox where user_id = :'ina' and kind = 'inactivity_notice' and body = 'Votre compte sera supprimé dans 30 jours faute d''activité. Ouvrez l''application pour le garder.'), 1, 'the notice carries the exact copy');
select lives_ok($$ select public.run_inactive_accounts() $$, 'running the job twice is fine');
select is((select count(*)::int from notification_outbox where user_id = :'ina' and kind = 'inactivity_notice'), 1, 'still only one notice');
select is((select count(*)::int from profiles where id = :'ina'), 1, 'the noticed account is not deleted yet');
select is((select count(*)::int from auth.users where id = :'old'), 0, 'an account noticed 31 days ago and still inactive is deleted');
select is((select r->>'deleted' from r2), '1', 'deleted count reported');
select is((select count(*)::int from auth.users where id = :'bak'), 1, 'an account seen after the notice is not deleted');
select is((select count(*)::int from profiles where id = :'rec' and inactivity_notice_at is null), 1, 'an account seen yesterday is untouched');
select is((select count(*)::int from notification_outbox where user_id in (:'rec', :'act') and kind = 'inactivity_notice'), 0, 'active accounts get no notice');
select is((select count(*)::int from storage_deletions where path like :'old' || '/%'), 3, 'the purged account''s files in all three buckets are queued');
select is((select array_agg(distinct bucket order by bucket) from storage_deletions where path like :'old' || '/%'),
          array['avatars', 'claim-documents', 'feedback-screenshots'], 'one entry per bucket');

-- deleting my account queues my files; a ban queues nothing
insert into storage.objects (bucket_id, name) values
  ('avatars', :'del' || '/a.jpg'), ('claim-documents', :'del' || '/d.pdf'),
  ('feedback-screenshots', :'del' || '/00000000-0000-0000-0000-0000000000dd.png'),
  ('avatars', :'ban' || '/a.jpg');
insert into feedback (id, user_id, type, body, screenshot_path) values
  ('00000000-0000-0000-0000-00000000f009', :'del', 'idea', 'Mon idee', :'del' || '/00000000-0000-0000-0000-0000000000dd.png');
select public.ban_user(:'ban', 'test ban reason');
select is((select count(*)::int from storage_deletions where path like :'ban' || '/%'), 0, 'a ban queues no file removal');
select tests.act_as(:'del');
select lives_ok($$ select public.delete_my_account() $$, 'delete_my_account still works');
select tests.act_as_superuser();
select is((select count(*)::int from auth.users where id = :'del'), 0, 'the account is gone');
select is((select array_agg(distinct bucket order by bucket) from storage_deletions where path like :'del' || '/%'),
          array['avatars', 'claim-documents', 'feedback-screenshots'], 'deleting my account queues files from all three buckets');
select is((select screenshot_path from feedback where id = '00000000-0000-0000-0000-00000000f009'), null, 'the kept feedback no longer points to the removed screenshot');

-- draining the queue
select lives_ok($$ select public.drain_storage_deletions() $$, 'drain without secrets does nothing');
select is((select count(*)::int from net.http_request_queue), 0, 'no HTTP request without secrets');
select vault.create_secret('test-key', 'send_push_key');
select vault.create_secret('http://localhost:1/functions/v1/storage-cleanup', 'storage_cleanup_url');
select public.drain_storage_deletions();
select is((select count(*)::int from net.http_request_queue), 1, 'one HTTP request when files are waiting');
delete from storage_deletions;
select public.drain_storage_deletions();
select is((select count(*)::int from net.http_request_queue), 1, 'no further request when the queue is empty');

select * from finish();
rollback;
