begin;
\ir helpers.inc
select plan(21);
select tests.create_user('me@la.fr', 'Mia') as me \gset
select tests.create_user('other@la.fr', 'Omar') as other \gset
select tests.create_user('fresh@la.fr', 'Nina') as fresh \gset
update profiles set age_confirmed = true;
update profiles set created_at = now() - interval '2 days' where id <> :'fresh';
insert into associations (id, name, source, verified, claimed_by) values
  ('00000000-0000-0000-0000-0000000000a1', 'Echecs libres', 'rna', false, null),
  ('00000000-0000-0000-0000-0000000000a2', 'Echecs officiels', 'rna', true, null),
  ('00000000-0000-0000-0000-0000000000a3', 'Echecs de Mia', 'rna', true, :'me'),
  ('00000000-0000-0000-0000-0000000000a4', 'Echecs d''Omar', 'rna', true, :'other'),
  ('00000000-0000-0000-0000-0000000000a5', 'Café Belleville', 'rna', false, null);

-- search_linkable_associations
select tests.act_as_anon();
select throws_ok($$ select * from public.search_linkable_associations('Echecs') $$, '42501', null, 'anon is denied');

select tests.act_as(:'me');
select is((select array_agg(name order by name) from public.search_linkable_associations('Echecs')),
  array['Echecs de Mia', 'Echecs libres'], 'unverified and claimed-by-me are listed; verified-unclaimed and claimed-by-other hidden');
select is((select count(*) from public.search_linkable_associations('officiels'))::int, 0, 'verified and unclaimed is hidden');
select is((select count(*) from public.search_linkable_associations('Omar'))::int, 0, 'claimed by another is hidden');
select is((select name from public.search_linkable_associations('cafe')), 'Café Belleville', 'accent-insensitive match');
select is((select count(*) from public.search_linkable_associations('é'))::int, 0, 'one character is not searched');
select is((select count(*) from public.search_linkable_associations('club'))::int, 0, 'a query the normaliser empties falls back to the plain name');
select is((select count(*) from public.search_linkable_associations('%%'))::int, 0, 'wildcards are plain characters');
select is((select count(*) from public.search_linkable_associations('Echecs', 1))::int, 1, 'limit is honoured');

select tests.act_as_superuser();
insert into associations (name, source, verified) values ('Club_X', 'rna', false), ('Club Y', 'rna', false);
select tests.act_as(:'me');
select is((select array_agg(name) from public.search_linkable_associations('club_')), array['Club_X'],
  'an underscore is literal, not a wildcard');

-- the trigram indexes serve the searches
select tests.act_as_superuser();
create function pg_temp.plan_of(q text) returns text language plpgsql as $$
declare r text; t text := '';
begin
  for r in execute 'explain ' || q loop t := t || r || ' '; end loop;
  return t;
end $$;
set local enable_seqscan = off;
select matches(pg_temp.plan_of($$ select id from associations where name_norm ilike '%echecs%' $$),
  'associations_name_norm_trgm', 'the normalised-name search uses its trigram index');
select matches(pg_temp.plan_of($$ select id from associations where name ilike '%club%' $$),
  'associations_name_trgm', 'the raw-name fallback uses its trigram index');
set local enable_seqscan = on;

select tests.act_as(:'other');
select is((select array_agg(name order by name) from public.search_linkable_associations('Echecs')),
  array['Echecs d''Omar', 'Echecs libres'], 'the claimant sees their own association');

-- community clubs: organising rule
select tests.act_as(:'fresh');
select throws_ok($$ insert into associations (name, source, created_by) values ('Boules', 'community', auth.uid()) $$,
  '42501', 'not_allowed', 'a new account cannot add a club');

-- community clubs: limit of 5 per 24 h
select tests.act_as(:'me');
select lives_ok($$ insert into associations (name, source, created_by) select 'Club ' || n, 'community', auth.uid() from generate_series(1, 5) n $$,
  'five clubs in 24 hours');
select throws_ok($$ insert into associations (name, source, created_by) values ('Club 6', 'community', auth.uid()) $$,
  '42501', 'limit_reached', 'the sixth is refused');
select tests.act_as_superuser();
update associations set created_at = now() - interval '25 hours' where name = 'Club 1';
select tests.act_as(:'me');
select lives_ok($$ insert into associations (name, source, created_by) values ('Club 6', 'community', auth.uid()) $$,
  'an older club leaves the window');
select tests.act_as_superuser();
select is((select count(*) from associations where name = 'Club 6' and created_at > now() - interval '1 minute')::int, 1,
  'created_at is set by the server');

-- website
select tests.act_as(:'other');
select lives_ok($$ insert into associations (name, source, created_by, website) values ('Web 1', 'community', auth.uid(), 'HTTPS://boules.example/fr') $$,
  'an https link is accepted, any case');
select throws_ok($$ insert into associations (name, source, created_by, website) values ('Web 2', 'community', auth.uid(), 'javascript:alert(1)') $$,
  '22023', 'invalid_website', 'a non-web scheme is refused');
select throws_ok($$ insert into associations (name, source, created_by, website) values ('Web 3', 'community', auth.uid(), 'boules.example') $$,
  '22023', 'invalid_website', 'a bare domain is refused by the database');

select * from finish();
rollback;
