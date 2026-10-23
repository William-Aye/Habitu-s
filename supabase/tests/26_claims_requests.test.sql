begin;
\ir helpers.inc
select plan(92);
select tests.create_user('adm@cr.fr', 'Admin') as adm \gset
select tests.create_user('cla@cr.fr', 'Claude') as cla \gset
select tests.create_user('cl2@cr.fr', 'Clara') as cl2 \gset
select tests.create_user('oth@cr.fr', 'Otto') as oth \gset
select tests.create_user('res@cr.fr', 'Rose') as res \gset
select tests.create_user('nor@cr.fr', 'Nora') as nor \gset
select tests.create_user('usr@cr.fr', 'Ugo') as usr \gset
update profiles set role = 'admin' where id = :'adm';
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
insert into categories (id, slug, name_fr, name_en, icon) values
  ('00000000-0000-0000-0000-0000000000c1', 'jeux', 'Jeux', 'Games', 'grid-3x3');
insert into associations (id, name, source, confidence, city, location, created_by) values
  ('00000000-0000-0000-0000-0000000000d1', 'Club Alpha', 'community', 0, 'Lyon', 'SRID=4326;POINT(4.85 45.77)', :'usr'),
  ('00000000-0000-0000-0000-0000000000d2', 'Club Beta', 'community', 0, 'Lyon', 'SRID=4326;POINT(4.85 45.77)', :'usr'),
  ('00000000-0000-0000-0000-0000000000d3', 'Club Gamma', 'community', 0, 'Lyon', 'SRID=4326;POINT(4.85 45.77)', :'usr'),
  ('00000000-0000-0000-0000-0000000000d4', 'Club Delta', 'community', 0, 'Lyon', 'SRID=4326;POINT(4.85 45.77)', :'usr'),
  ('00000000-0000-0000-0000-0000000000d5', 'Club Epsilon', 'community', 0, 'Lyon', 'SRID=4326;POINT(4.85 45.77)', :'usr'),
  ('00000000-0000-0000-0000-0000000000d6', 'Ligue Zeta', 'rna', 85, 'Lyon', 'SRID=4326;POINT(4.85 45.77)', null);
insert into activities (id, organiser_id, organised_by_association_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000a1', :'usr', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'Go chez Beta', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00');
insert into collectifs (id, name, town_label, town_point, created_by) values
  ('00000000-0000-0000-0000-00000000c0a1', 'Les Joueurs', 'Lyon', 'POINT(4.85 45.77)', :'res');
insert into collectif_members (collectif_id, user_id, role, status, accepted_at) values
  ('00000000-0000-0000-0000-00000000c0a1', :'nor', 'organiser', 'active', now());
insert into activities (id, organiser_id, organised_by_collectif_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time) values
  ('00000000-0000-0000-0000-0000000000a2', :'res', '00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000c1', 'Go collectif 1', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00'),
  ('00000000-0000-0000-0000-0000000000a3', :'nor', '00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000c1', 'Go collectif 2', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 3, '19:00');

-- claims: constraints and limit
select tests.act_as(:'cla');
select throws_ok($$ insert into association_claims (association_id, claimant_id, proof_method, role_in_association)
  values ('00000000-0000-0000-0000-0000000000d1', auth.uid(), 'document', 'Presidente') $$, '23514', null,
  'a claim with neither an email nor a document is refused');
select throws_ok($$ insert into association_claims (association_id, claimant_id, proof_method, role_in_association, contact_email)
  values ('00000000-0000-0000-0000-0000000000d1', auth.uid(), 'domain_email', 'P', 'a@club.fr') $$, '23514', null,
  'the role needs at least 2 characters');
select throws_ok(format($$ insert into association_claims (association_id, claimant_id, proof_method, role_in_association, document_path)
  values ('00000000-0000-0000-0000-0000000000d1', auth.uid(), 'document', 'Presidente', %L) $$, :'oth' || '/doc.pdf'), '42501', null,
  'a document must sit in the claimant''s own folder');
select throws_ok($$ insert into association_claims (association_id, claimant_id, proof_method, role_in_association, contact_email, admin_note)
  values ('00000000-0000-0000-0000-0000000000d1', auth.uid(), 'domain_email', 'Presidente', 'a@club.fr', 'ok') $$, '42501', null,
  'a claimant cannot write the admin note');
select lives_ok(format($$ insert into association_claims (id, association_id, claimant_id, proof_method, role_in_association, contact_email)
  values ('00000000-0000-0000-0000-0000000c1a01', '00000000-0000-0000-0000-0000000000d1', %L, 'domain_email', 'Presidente', 'a@club.fr') $$, :'cla'), 'a claim with an email is accepted');
select lives_ok(format($$ insert into association_claims (association_id, claimant_id, proof_method, role_in_association, document_path)
  values ('00000000-0000-0000-0000-0000000000d4', %L, 'document', 'Tresoriere', %L) $$, :'cla', :'cla' || '/statuts.pdf'), 'a claim with a document is accepted');
select lives_ok(format($$ insert into association_claims (association_id, claimant_id, proof_method, role_in_association, contact_email)
  values ('00000000-0000-0000-0000-0000000000d5', %L, 'domain_email', 'Membre', 'b@club.fr') $$, :'cla'), 'a third claim today is accepted');
select throws_ok(format($$ insert into association_claims (association_id, claimant_id, proof_method, role_in_association, contact_email)
  values ('00000000-0000-0000-0000-0000000000d2', %L, 'domain_email', 'Membre', 'c@club.fr') $$, :'cla'), '42501', 'limit_reached',
  'the 4th claim in a day raises limit_reached');
select throws_ok($$ select admin_note from association_claims $$, '42501', null, 'a claimant cannot read the admin note column');
select tests.act_as(:'cl2');
select lives_ok(format($$ insert into association_claims (id, association_id, claimant_id, proof_method, role_in_association, contact_email)
  values ('00000000-0000-0000-0000-0000000c1a02', '00000000-0000-0000-0000-0000000000d1', %L, 'domain_email', 'Secretaire', 'd@club.fr') $$, :'cl2'), 'a second person claims the same club');
select is((select count(*) from association_claims)::int, 1, 'a claimant sees only their own claim');
select is((select count(*) from association_claims where id = '00000000-0000-0000-0000-0000000c1a01')::int, 0, 'a claimant cannot read another claim');

-- claim documents
select tests.act_as(:'cla');
select lives_ok(format($$ insert into storage.objects (bucket_id, name, owner, metadata) values ('claim-documents', %L, auth.uid(), '{}') $$, :'cla' || '/statuts.pdf'), 'a claimant uploads into their own folder');
select throws_ok(format($$ insert into storage.objects (bucket_id, name, owner, metadata) values ('claim-documents', %L, auth.uid(), '{}') $$, :'oth' || '/statuts.pdf'), '42501', null, 'a claimant cannot upload into another folder');
select is((select count(*) from storage.objects where bucket_id = 'claim-documents')::int, 0, 'the owner cannot read the document back');
select tests.act_as(:'oth');
select is((select count(*) from storage.objects where bucket_id = 'claim-documents')::int, 0, 'another person cannot read the document');
select tests.act_as_admin(:'adm');
select is((select count(*) from storage.objects where bucket_id = 'claim-documents')::int, 1, 'an admin reads the document');
select tests.act_as_superuser();
select is((select public from storage.buckets where id = 'claim-documents'), false, 'claim-documents is private');
select tests.act_as_admin(:'adm');
select tests.act_as_superuser();
select is((select file_size_limit from storage.buckets where id = 'claim-documents'), 10485760::bigint, 'claim documents are limited to 10 MB');
select tests.act_as_admin(:'adm');
select tests.act_as_superuser();
select is((select public from storage.buckets where id = 'feedback-screenshots'), false, 'feedback-screenshots is private');
select tests.act_as_admin(:'adm');
select tests.act_as_superuser();
select is((select file_size_limit from storage.buckets where id = 'feedback-screenshots'), 5242880::bigint, 'screenshots are limited to 5 MB');
select tests.act_as_admin(:'adm');

-- admin claims
select tests.act_as(:'oth');
select throws_ok($$ select admin_claims('pending') $$, '42501', 'not_allowed', 'a non-admin cannot list claims');
select throws_ok($$ select admin_decide_claim('00000000-0000-0000-0000-0000000c1a01', true, null) $$, '42501', 'not_allowed', 'a non-admin cannot decide a claim');
select tests.act_as_aal1(:'adm');
select throws_ok($$ select admin_claims('pending') $$, '42501', 'not_allowed', 'an admin without two-factor cannot list claims');
select tests.act_as_admin(:'adm');
select is(jsonb_array_length(admin_claims('pending')), 4, 'the admin lists the pending claims');
select is((select e->>'role' from jsonb_array_elements(admin_claims('pending')) e where e->>'id' = '00000000-0000-0000-0000-0000000c1a01'), 'Presidente', 'a listed claim carries the role');
select is((select e->'association'->>'name' from jsonb_array_elements(admin_claims('pending')) e where e->>'id' = '00000000-0000-0000-0000-0000000c1a01'), 'Club Alpha', 'a listed claim carries the association');
select is((select count(*) from jsonb_array_elements(admin_claims('pending')) e where (e->>'has_document')::boolean)::int, 1, 'a claim with a document says so');
select matches(admin_claim_document_url((select id from association_claims where document_path is not null)), '^/storage/v1/object/sign/claim-documents/.+\?token=.+', 'the admin gets a signed url for the document');
select tests.act_as_superuser();
select is((select count(*) from admin_audit_log where action = 'claim_document_url')::int, 1, 'reading a document is audited');
select tests.act_as_admin(:'adm');
select throws_ok($$ select admin_claim_document_url('00000000-0000-0000-0000-0000000c1a01') $$, 'P0002', null, 'a claim without a document has no url');
select lives_ok($$ select admin_decide_claim('00000000-0000-0000-0000-0000000c1a01', true, 'Verifie par telephone') $$, 'the admin approves a claim');
select tests.act_as_superuser();
select is((select claimed_by from associations where id = '00000000-0000-0000-0000-0000000000d1'), :'cla'::uuid, 'approval sets claimed_by');
select tests.act_as_admin(:'adm');
select tests.act_as_superuser();
select is((select verified from associations where id = '00000000-0000-0000-0000-0000000000d1'), true, 'approval verifies the association');
select tests.act_as_admin(:'adm');
select is((select status from association_claims where id = '00000000-0000-0000-0000-0000000c1a02'), 'rejected', 'the other pending claim on that association is rejected');
select tests.act_as_superuser();
select is((select count(*) from notification_outbox where kind = 'claim_decided' and user_id = :'cla')::int, 1, 'the claimant is notified');
select tests.act_as_admin(:'adm');
select tests.act_as_superuser();
select is((select count(*) from notification_outbox where kind = 'claim_decided' and user_id = :'cl2')::int, 1, 'the displaced claimant is notified');
select tests.act_as_admin(:'adm');
select tests.act_as_superuser();
select is((select title from notification_outbox where kind = 'claim_decided' and user_id = :'cla'), 'Demande traitée', 'the notice is generic');
select tests.act_as_admin(:'adm');
select tests.act_as_superuser();
select is((select count(*) from admin_audit_log where action = 'claim_decision')::int, 1, 'the decision is audited');
select tests.act_as_admin(:'adm');
select throws_ok($$ select admin_decide_claim('00000000-0000-0000-0000-0000000c1a01', false, null) $$, '42501', 'already_decided', 'a claim is decided once');
select tests.act_as(:'cla');
select throws_ok($$ update associations set removed_at = null, reviewed_at = now() where id = '00000000-0000-0000-0000-0000000000d1' $$, '42501', null, 'a claimant cannot touch review fields');

-- community clubs
select tests.act_as_admin(:'adm');
select is((select count(*) from jsonb_array_elements(admin_community_clubs()) e where e->>'id' like '00000000-0000-0000-0000-0000000000d%')::int, 5, 'unreviewed community clubs are listed');
select lives_ok($$ select admin_decide_club('00000000-0000-0000-0000-0000000000d2', 'merge', '00000000-0000-0000-0000-0000000000d1') $$, 'the admin merges a duplicate');
select tests.act_as_superuser();
select is((select organised_by_association_id from activities where id = '00000000-0000-0000-0000-0000000000a1'), '00000000-0000-0000-0000-0000000000d1'::uuid, 'merging moves the activities');
select tests.act_as_admin(:'adm');
select tests.act_as_superuser();
select is((select count(*) from associations where id = '00000000-0000-0000-0000-0000000000d2')::int, 0, 'merging deletes the duplicate');
select tests.act_as_admin(:'adm');
select throws_ok($$ select admin_decide_club('00000000-0000-0000-0000-0000000000d3', 'merge') $$, '23514', null, 'a merge needs a target');
select lives_ok($$ select admin_decide_club('00000000-0000-0000-0000-0000000000d4', 'approve') $$, 'the admin approves a club');
select tests.act_as_superuser();
select isnt((select reviewed_at from associations where id = '00000000-0000-0000-0000-0000000000d4'), null, 'approval sets reviewed_at');
select tests.act_as_admin(:'adm');
select is((select count(*) from jsonb_array_elements(admin_community_clubs()) e where e->>'id' = '00000000-0000-0000-0000-0000000000d4')::int, 0, 'a reviewed club leaves the queue');
select ok(exists (select 1 from jsonb_array_elements(search_explore(4.85, 45.77, 10, null, null, '{association}')->'results') r where r->>'id' = '00000000-0000-0000-0000-0000000000d3'), 'setup: the club is found before it is rejected');
select lives_ok($$ select admin_decide_club('00000000-0000-0000-0000-0000000000d3', 'reject') $$, 'the admin rejects a club');
select tests.act_as_anon();
select is((select count(*) from jsonb_array_elements(search_explore(4.85, 45.77, 10, null, null, '{association}')->'results') r where r->>'id' = '00000000-0000-0000-0000-0000000000d3')::int, 0, 'a rejected club disappears from search_explore');
select is(get_association('00000000-0000-0000-0000-0000000000d3'), null, 'a rejected club disappears from get_association');
select isnt(get_association('00000000-0000-0000-0000-0000000000d4'), null, 'an approved club still shows');
select tests.act_as(:'usr');
select is((select count(*) from search_linkable_associations('Club Gamma'))::int, 0, 'a rejected club is not linkable');
select is((select count(*) from search_linkable_associations('Club Delta'))::int, 1, 'an approved club is linkable');

-- a removal decision on a report takes effect on associations
select lives_ok($$ insert into reports (target_type, target_id, reason) values ('association', '00000000-0000-0000-0000-0000000000d5', 'fake_or_spam') $$, 'a member reports a club');
select tests.act_as_admin(:'adm');
select lives_ok($$ select admin_decide_report((select id from reports where target_id = '00000000-0000-0000-0000-0000000000d5'), 'remove', 'Fiche trompeuse, retrait de la fiche') $$, 'the admin removes the reported club');
select tests.act_as_superuser();
select isnt((select removed_at from associations where id = '00000000-0000-0000-0000-0000000000d5'), null, 'remove sets removed_at');
select tests.act_as_admin(:'adm');
select tests.act_as_anon();
select is(get_association('00000000-0000-0000-0000-0000000000d5'), null, 'a removed association disappears from get_association');
select is((select count(*) from jsonb_array_elements(search_explore(4.85, 45.77, 10, null, null, '{association}')->'results') r where r->>'id' = '00000000-0000-0000-0000-0000000000d5')::int, 0, 'a removed association disappears from search');

-- category requests
select tests.act_as(:'usr');
select lives_ok(format($$ insert into category_requests (id, user_id, requested_name) values ('00000000-0000-0000-0000-0000000ca701', %L, 'Jeu de dames'), ('00000000-0000-0000-0000-0000000ca702', %L, 'Jeux de dames'), ('00000000-0000-0000-0000-0000000ca703', %L, 'Autre truc') $$, :'usr', :'usr', :'usr'), 'a member requests categories');
select throws_ok($$ select admin_category_requests() $$, '42501', 'not_allowed', 'a non-admin cannot list category requests');
select tests.act_as_admin(:'adm');
select is(jsonb_array_length(admin_category_requests()), 3, 'the admin lists the requests');
select lives_ok($$ select admin_decide_category('00000000-0000-0000-0000-0000000ca701', 'approve', '00000000-0000-0000-0000-0000000000c1', 'Draughts') $$, 'the admin approves a request');
select tests.act_as_superuser();
select is((select name_en from categories where name_fr = 'Jeu de dames' and parent_id = '00000000-0000-0000-0000-0000000000c1'), 'Draughts', 'the category is created under the parent with both names');
select tests.act_as_admin(:'adm');
select tests.act_as_superuser();
select is((select status from category_requests where id = '00000000-0000-0000-0000-0000000ca701'), 'approved', 'the request is approved');
select tests.act_as_admin(:'adm');
select lives_ok($$ select admin_decide_category('00000000-0000-0000-0000-0000000ca702', 'merge', p_into => (select id from categories where name_fr = 'Jeu de dames')) $$, 'the admin merges a request');
select matches((select admin_note from category_requests where id = '00000000-0000-0000-0000-0000000ca702'), (select id::text from categories where name_fr = 'Jeu de dames'), 'the merge target is recorded');
select lives_ok($$ select admin_decide_category('00000000-0000-0000-0000-0000000ca703', 'reject', p_note => 'Trop vague') $$, 'the admin rejects a request');
select tests.act_as_superuser();
select is((select count(*) from notification_outbox where kind = 'category_decided' and user_id = :'usr')::int, 3, 'every decision notifies the requester');
select tests.act_as_admin(:'adm');
select throws_ok($$ select admin_decide_category('00000000-0000-0000-0000-0000000ca703', 'reject') $$, '42501', 'already_decided', 'a request is decided once');
select tests.act_as_superuser();
select is((select count(*) from admin_audit_log where action = 'category_decision')::int, 3, 'category decisions are audited');
select tests.act_as_admin(:'adm');

-- feedback
select tests.act_as_anon();
select throws_ok($$ insert into feedback (type, body) values ('idea', 'Bonjour') $$, '42501', null, 'anonymous insert into feedback is refused');
select tests.act_as(:'oth');
select lives_ok(format($$ insert into feedback (user_id, type, body) values (%L, 'idea', 'Un'), (%L, 'problem', 'Deux'), (%L, 'other', 'Trois') $$, :'oth', :'oth', :'oth'), 'three feedbacks in an hour are accepted');
select throws_ok(format($$ insert into feedback (user_id, type, body) values (%L, 'idea', 'Quatre') $$, :'oth'), '42501', 'limit_reached', 'the 4th signed-in feedback in an hour raises limit_reached');
select tests.act_as(:'nor');
select throws_ok(format($$ insert into feedback (user_id, type, body, screenshot_path) values (%L, 'idea', 'Capture', %L) $$, :'nor', :'oth' || '/c.png'), '42501', null, 'a screenshot must sit in the sender''s folder');
select lives_ok(format($$ insert into feedback (user_id, type, body, screenshot_path) values (%L, 'idea', 'Capture', %L) $$, :'nor', :'nor' || '/c.png'), 'a screenshot in the sender''s folder is accepted');
select throws_ok(format($$ insert into feedback (user_id, type, body, source) values (%L, 'idea', 'Faux anonyme', 'anonymous') $$, :'nor'), '42501', null, 'a signed-in sender cannot claim to be anonymous');
select lives_ok(format($$ insert into storage.objects (bucket_id, name, owner, metadata) values ('feedback-screenshots', %L, auth.uid(), '{}') $$, :'nor' || '/c.png'), 'a sender uploads a screenshot into their own folder');
select throws_ok(format($$ insert into storage.objects (bucket_id, name, owner, metadata) values ('feedback-screenshots', %L, auth.uid(), '{}') $$, :'oth' || '/c.png'), '42501', null, 'a sender cannot upload into another folder');
select tests.act_as_superuser();
insert into feedback (user_id, type, body, source) values (null, 'idea', 'Anonyme', 'anonymous');
select tests.act_as(:'oth');
select throws_ok($$ select admin_feedback('new') $$, '42501', 'not_allowed', 'a non-admin cannot list feedback');
select tests.act_as_admin(:'adm');
select is(jsonb_array_length(admin_feedback('new')), 5, 'the admin lists feedback');
select lives_ok($$ select admin_set_feedback_status((select id from feedback where body = 'Anonyme'), 'planned') $$, 'the admin sets a status');
select tests.act_as_superuser();
select is((select status from feedback where body = 'Anonyme'), 'planned', 'the status changed');
select tests.act_as_admin(:'adm');
select is((select count(*) from storage.objects where bucket_id = 'feedback-screenshots')::int, 1, 'an admin reads screenshots');

-- collectif link
select tests.act_as(:'nor');
select throws_ok($$ select link_collectif_to_association('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000d1') $$, '42501', 'not_allowed', 'a non-responsable cannot link');
select tests.act_as(:'res');
select throws_ok($$ select link_collectif_to_association('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000d1') $$, '42501', 'not_allowed', 'a responsable who is not the claimant cannot link');
select tests.act_as_superuser();
update associations set claimed_by = :'res', verified = false where id = '00000000-0000-0000-0000-0000000000d6';
select tests.act_as(:'res');
select throws_ok($$ select link_collectif_to_association('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000d6') $$, '42501', 'not_allowed', 'an unverified claim cannot link');
select tests.act_as_superuser();
update associations set verified = true where id = '00000000-0000-0000-0000-0000000000d6';
select tests.act_as(:'res');
select is(link_collectif_to_association('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000d6'), 2, 'a verified claim links and returns the count');
select tests.act_as_superuser();
select is((select count(*) from activities where organised_by_association_id = '00000000-0000-0000-0000-0000000000d6')::int, 2, 'the collectif''s activities are moved');
select tests.act_as(:'res');
select tests.act_as_superuser();
select is((select count(*) from collectifs where id = '00000000-0000-0000-0000-00000000c0a1')::int, 1, 'the collectif stays');
select tests.act_as(:'res');

select * from finish();
rollback;
