begin;
\ir helpers.inc
select plan(58);

-- Same helper as 07: similarity of tests.vec(s) to tests.vec(1.0) is exactly s.
create function tests.vec(s float8) returns extensions.vector language sql immutable as $$
  select (array[s, sqrt(1 - s * s)] || array_fill(0::float8, array[382]))::extensions.vector
$$;

-- ---------------------------------------------------------------------------------------------
-- Structure and parameters
select has_table('search', 'query_vocab', 'search.query_vocab exists');
select has_table('search', 'vocab_requests', 'search.vocab_requests exists');
select has_table('search', 'stopwords', 'search.stopwords exists');
select has_index('search', 'query_vocab', 'query_vocab_phrase_trgm', 'trigram index on phrase');
select is((select count(*)::int from search.stopwords), 44, '44 stop-words seeded');
select ok((select bool_and(w in (select word from search.stopwords))
           from unnest(array['a', 'à', 'd', 'de', 'pour', 'club', 'association', 'asso']) w),
          'stop-words include accents, elisions and club/association/asso');
select is(((search.params()).vocab_fuzzy_sim, (search.params()).vocab_fuzzy_min_len,
           (search.params()).vocab_words_cover, (search.params()).vocab_request_min_hits,
           (search.params()).vocab_request_days),
          (0.5::real, 4, 0.5::real, 2, 90), 'vocabulary parameters');
select is(((search.params()).strong, (search.params()).max_offset), (70, 500), 'existing parameters kept');
select is((select schedule from cron.job where jobname = 'prune-vocab-requests'), '20 4 * * *',
          'prune job scheduled');

-- ---------------------------------------------------------------------------------------------
-- Normalisation and tokens
select is(search.normalise_query('  Jeu  de GO '), 'jeu de go', 'trim, collapse, lower');
select is(search.normalise_query('ÉCHECS'), 'échecs', 'accented capitals lower-cased');
select is(search.normalise_query('e' || chr(769) || 'cole'), 'école', 'NFC');
select is(char_length(search.normalise_query(repeat('a', 250))), 200, 'cut to 200 characters');
select is(search.normalise_query(chr(160) || 'danse' || chr(160) || chr(160) || 'bretonne' || chr(65279)),
          'danse bretonne', 'NBSP and U+FEFF are whitespace');
select is(search.normalise_query(E'\tclub\n\n de \r\n go' || chr(12288) || chr(8195)), 'club de go',
          'tabs, newlines, ideographic and em spaces');
select is(search.normalise_query('   '), '', 'blank gives empty');
select is(search.tokens('cours d''escalade pour débutants'), '{cours,d,escalade,pour,débutants}'::text[],
          'tokens split on apostrophes and spaces');
select is(search.tokens('arts-martiaux, «judo»… (enfants) l’aïkido/karaté?!'),
          '{arts,martiaux,judo,enfants,l,aïkido,karaté}'::text[], 'tokens split on punctuation');
select is(search.tokens(''), '{}'::text[], 'no tokens');

-- ---------------------------------------------------------------------------------------------
-- Resolution
insert into search.query_vocab (phrase, embedding, source)
values ('escalade', tests.vec(0.99), 'ngram'), ('jeu de go', tests.vec(0.98), 'watchlist'),
       ('danse', tests.vec(0.90), 'ngram'), ('bretonne', tests.vec(0.85), 'ngram'),
       ('danse bretonne', tests.vec(0.97), 'ngram'), ('yoga', tests.vec(0.96), 'category'),
       ('go', tests.vec(0.95), 'tag');

select is((select (method, matched) from search.resolve_query('Jeu de GO')), ('exact'::text, 'jeu de go'::text),
          'exact after normalisation');
select ok((select embedding = tests.vec(0.98) from search.resolve_query('Jeu de GO')), 'exact embedding');
select is((select (method, matched) from search.resolve_query('escalde')), ('fuzzy'::text, 'escalade'::text), 'typo: fuzzy');
select ok((select embedding = tests.vec(0.99) from search.resolve_query('escalde')), 'fuzzy embedding');
select is((select (method, matched) from search.resolve_query('go')), ('exact'::text, 'go'::text), 'short exact');
select is((select method from search.resolve_query('gol')), 'none', 'short query: no fuzzy match');
select is(extensions.similarity('yog', 'yoga'), 0.5::real, 'yog -> yoga is exactly at the fuzzy threshold');
select is((select method from search.resolve_query('yog')), 'none', 'under 4 characters: never fuzzy');
select ok((select method = 'words' and matched like '%danse bretonne%' and embedding is not null
           from search.resolve_query('cours de danse bretonne')), 'words: pair and tokens averaged');
select ok((select method = 'words' and matched like '%jeu de go%' and embedding is not null
           from search.resolve_query('jeu de go club')), 'words: adjacent token triple');
select is((select (embedding, method, matched) from search.resolve_query('xyzzy plugh')),
          (null::extensions.vector, 'none'::text, null::text), 'unknown words: none, no embedding');
select is((select method from search.resolve_query('yoda')), 'none', 'yoda is not yoga (similarity 0.25)');
select is((select method from search.resolve_query('de la')), 'none', 'only stop-words: none');
select is((select method from search.resolve_query('')), 'none', 'empty: none');
select is((select count(*)::int from search.resolve_query('escalde')), 1, 'always exactly one row');

-- ---------------------------------------------------------------------------------------------
-- search_explore
select ok(r->>'mode' = 'search' and r->>'query_match' = 'fuzzy', 'search_explore resolves a typo')
  from public.search_explore(4.835, 45.764, 10, 'escalde') r;
select is(r->>'query_match', 'given', 'a caller embedding wins')
  from public.search_explore(4.835, 45.764, 10, 'escalde', p_query_embedding => tests.vec(1.0)) r;
select ok(r->>'mode' = 'keyword_only' and r->>'query_match' = 'none', 'unknown words: keyword_only')
  from public.search_explore(4.835, 45.764, 10, 'xyzzy plugh') r;
select ok(r->>'mode' = 'browse' and r ? 'query_match' and r->>'query_match' is null, 'browse: query_match null')
  from public.search_explore(4.835, 45.764, 10) r;

-- Learning and privacy
delete from search.vocab_requests;
select is(r->>'query_match', 'words', 'words via search_explore')
  from public.search_explore(4.835, 45.764, 10, 'cours de danse bretonne') r;
select public.search_explore(4.835, 45.764, 10, 'Cours  de danse bretonne') is not null;
select is((select hits from search.vocab_requests where phrase = 'cours de danse bretonne'), 2,
          'two searches, one request with 2 hits');
select public.search_explore(4.835, 45.764, 10, 'appelez 0612345678 yoga') is not null;
select is((select count(*)::int from search.vocab_requests where phrase = 'appelez yoga'), 1,
          'phone number removed before storing');
select is((select count(*)::int from search.vocab_requests where phrase ~ '[0-9]'), 0, 'no digits stored');
select public.search_explore(4.835, 45.764, 10, 'yoga') is not null;
select is((select count(*)::int from search.vocab_requests where phrase = 'yoga'), 0, 'exact match not stored');
select search.log_vocab_request('pilates', 'exact');
select is((select count(*)::int from search.vocab_requests where phrase = 'pilates'), 0,
          'two-argument form: exact is not stored');
select search.log_vocab_request('yoga', 'none');
select is((select count(*)::int from search.vocab_requests where phrase = 'yoga'), 1,
          'two-argument form trusts the given method (no second resolution)');
select public.search_explore(4.835, 45.764, 10, 'quelque chose', p_offset => 20) is not null;
select is((select count(*)::int from search.vocab_requests where phrase = 'quelque chose'), 0,
          'page 2 not stored');
select is((select data_type from information_schema.columns
           where table_schema = 'search' and table_name = 'vocab_requests' and column_name = 'first_seen'),
          'date', 'first_seen is a date');
-- Pruning
insert into search.vocab_requests (phrase, hits, first_seen, last_seen)
values ('ancienne', 1, current_date - 200, current_date - 91), ('recente', 1, current_date - 200, current_date - 89);
do $$ begin execute (select command from cron.job where jobname = 'prune-vocab-requests'); end $$;
select is(array(select phrase from search.vocab_requests where phrase in ('ancienne', 'recente')),
          '{recente}'::text[], 'prune deletes requests unseen for 90 days');

-- ---------------------------------------------------------------------------------------------
-- Access
select ok(not has_function_privilege(r, f, 'execute'), f || ' not executable by ' || r)
  from unnest(array['search.resolve_query(text)', 'search.log_vocab_request(text)',
                    'search.log_vocab_request(text,text)']) f,
       unnest(array['anon', 'authenticated']) r;
select tests.create_user('vocab@test.fr') as vocab_user \gset
select tests.act_as_anon();
select throws_ok($$ select * from search.query_vocab $$, '42501', null, 'anon cannot read query_vocab');
select throws_ok($$ select * from search.vocab_requests $$, '42501', null, 'anon cannot read vocab_requests');
select tests.act_as(:'vocab_user');
select throws_ok($$ select * from search.query_vocab $$, '42501', null, 'authenticated cannot read query_vocab');
select throws_ok($$ select * from search.vocab_requests $$, '42501', null,
                 'authenticated cannot read vocab_requests');
select tests.act_as_superuser();

select * from finish();
rollback;
