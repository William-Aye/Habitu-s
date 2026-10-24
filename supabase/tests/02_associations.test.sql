begin;
\ir helpers.inc
select plan(40);
select tests.create_user('carol@test.fr', 'Carol') as carol \gset
select tests.create_user('dave@test.fr', 'Dave') as dave \gset
select tests.create_user('root@test.fr', 'Root') as root \gset
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
insert into associations (id, name, source, rna_id) values ('00000000-0000-0000-0000-0000000000a1', 'Club de Go de Lyon', 'rna', 'W691000001');
insert into associations (id, name, source, rna_id) values ('00000000-0000-0000-0000-0000000000a2', 'Echecs Paris', 'rna', 'W751000002');
insert into tags (id, slug, label_fr, label_en) values ('00000000-0000-0000-0000-0000000000b1', 'go', 'Go', 'Go');
insert into association_tags (association_id, tag_id) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1');
insert into association_claims (id, association_id, claimant_id, proof_method, role_in_association, contact_email)
  values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2', :'dave', 'document', 'Presidente', 'p@club.fr');

-- structure
select has_index('public', 'associations', 'associations_location_gist', 'GiST index on location');
-- No HNSW index: search_explore never uses it (decision 5 of docs/plans/2026-10-22-query-vocabulary.md).
select hasnt_index('public', 'associations', 'associations_embedding_hnsw', 'no HNSW index on embedding');
select has_index('public', 'associations', 'associations_name_trgm', 'trigram index on name');
select is(has_table_privilege('authenticated', 'public.associations', 'TRUNCATE'), false, 'authenticated cannot truncate associations');
select is(has_table_privilege('anon', 'public.association_claims', 'TRUNCATE'), false, 'anon cannot truncate claims');

-- anon
select tests.act_as_anon();
select is((select count(*) from associations)::int, 2, 'anon reads associations');
select is((select count(*) from association_tags)::int, 1, 'anon reads association_tags');
select throws_ok($$ insert into associations (name, source) values ('Anon', 'community') $$, '42501', null, 'anon cannot insert associations');
select throws_ok($$ insert into association_tags (association_id, tag_id) values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1') $$, '42501', null, 'anon cannot write association_tags');
select throws_ok($$ select * from association_claims $$, '42501', null, 'anon cannot read claims');

-- carol: ordinary user
select tests.act_as(:'carol');
select lives_ok($$ insert into associations (name, source, created_by) values ('Atelier Arduino', 'community', auth.uid()) $$, 'community club insert');
select throws_ok($$ insert into associations (name, source, created_by) values ('Fake', 'rna', auth.uid()) $$, '42501', null, 'cannot insert as rna');
select throws_ok($$ insert into associations (name, source, created_by, verified) values ('Fake', 'community', auth.uid(), true) $$, '42501', null, 'cannot self-verify');
select throws_ok(format($f$ insert into associations (name, source, created_by, claimed_by) values ('Fake', 'community', auth.uid(), %L) $f$, :'carol'), '42501', null, 'cannot self-claim on insert');
select throws_ok(format($f$ insert into associations (name, source, created_by) values ('Fake', 'community', %L) $f$, :'dave'), '42501', null, 'cannot insert as someone else');
select is_empty($$ update associations set purpose = 'x' where id = '00000000-0000-0000-0000-0000000000a1' returning 1 $$,
  'cannot edit unclaimed association');
select lives_ok($$ insert into association_claims (association_id, claimant_id, proof_method, role_in_association, contact_email) values ('00000000-0000-0000-0000-0000000000a1', auth.uid(), 'domain_email', 'Presidente', 'p@club.fr') $$, 'can file a claim');
select throws_ok($$ insert into association_claims (association_id, claimant_id, proof_method, role_in_association, contact_email, status) values ('00000000-0000-0000-0000-0000000000a1', auth.uid(), 'document', 'Presidente', 'p@club.fr', 'approved') $$, '42501', null, 'cannot self-approve claim');
select is((select count(*) from association_claims)::int, 1, 'user sees only own claims');
select throws_ok($$ insert into association_tags (association_id, tag_id) values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1') $$, '42501', null, 'user cannot write association_tags');

-- claimant
select tests.act_as_superuser();
update associations set claimed_by = :'carol' where id = '00000000-0000-0000-0000-0000000000a1';
select tests.act_as(:'carol');
select lives_ok($$ update associations set purpose = 'Jeu de go', locked_fields = '{purpose}' where id = '00000000-0000-0000-0000-0000000000a1' $$, 'claimant can update purpose');
select is((select purpose from associations where id = '00000000-0000-0000-0000-0000000000a1'), 'Jeu de go', 'purpose actually changed');
select throws_ok($$ update associations set name = 'Hijack' where id = '00000000-0000-0000-0000-0000000000a1' $$, '42501', null, 'claimant cannot rename');
select throws_ok($$ update associations set verified = true where id = '00000000-0000-0000-0000-0000000000a1' $$, '42501', null, 'claimant cannot verify');
select throws_ok($$ update associations set rna_id = 'W000' where id = '00000000-0000-0000-0000-0000000000a1' $$, '42501', null, 'claimant cannot change rna_id');
select throws_ok($$ update associations set claimed_by = null where id = '00000000-0000-0000-0000-0000000000a1' $$, '42501', null, 'claimant cannot change claimed_by');
select throws_ok($$ update associations set embedding = array_fill(0, array[384])::vector where id = '00000000-0000-0000-0000-0000000000a1' $$, '42501', null, 'claimant cannot set embedding');
select throws_ok($$ update associations set location = 'SRID=4326;POINT(4.83 45.76)'::geography where id = '00000000-0000-0000-0000-0000000000a1' $$, '42501', null, 'claimant cannot set location');
select throws_ok($$ update associations set confidence = 100 where id = '00000000-0000-0000-0000-0000000000a1' $$, '42501', null, 'claimant cannot set confidence');
select lives_ok($$ update associations set locked_fields = '{purpose,website}' where id = '00000000-0000-0000-0000-0000000000a1' $$, 'claimant can write locked_fields');
select throws_ok($$ insert into associations (name, source, created_by, rna_id) values ('X', 'community', auth.uid(), 'W1') $$, '42501', null, 'non-admin cannot insert rna_id');
select throws_ok($$ insert into associations (name, source, created_by, confidence) values ('X', 'community', auth.uid(), 90) $$, '42501', null, 'non-admin cannot insert confidence');

-- admin
select tests.act_as_superuser();
update profiles set role = 'admin' where id = :'root';
select tests.act_as_admin(:'root');
select lives_ok($$ update associations set verified = true, name = 'Club de Go' where id = '00000000-0000-0000-0000-0000000000a2' $$, 'admin can update/verify');
select is((select count(*) from association_claims)::int, 2, 'admin reads all claims');
select lives_ok($$ update association_claims set status = 'approved' where id = '00000000-0000-0000-0000-0000000000c1' $$, 'admin approves claim');
select is((select status from association_claims where id = '00000000-0000-0000-0000-0000000000c1'), 'approved', 'claim status changed');
select lives_ok($$ insert into association_tags (association_id, tag_id) values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1') $$, 'admin inserts association_tags');
select lives_ok($$ delete from association_tags where association_id = '00000000-0000-0000-0000-0000000000a2' $$, 'admin deletes association_tags');
select lives_ok($$ insert into associations (id, name, source, verified, rna_id) values ('00000000-0000-0000-0000-0000000000a3', 'Admin Club', 'rna', true, 'W3') $$, 'admin inserts rna verified association');
select lives_ok($$ delete from associations where id = '00000000-0000-0000-0000-0000000000a3' $$, 'admin deletes association');

select * from finish();
rollback;
