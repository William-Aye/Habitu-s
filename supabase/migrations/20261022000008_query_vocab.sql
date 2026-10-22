-- Query vocabulary: the meaning of a query is looked up in precomputed embeddings of the words and
-- short phrases people type (docs/plans/2026-10-22-query-vocabulary.md), so search needs no live
-- embedding server. Everything lives in the private schema `search`; only search_explore (security
-- definer) reaches it.

-- ---------------------------------------------------------------------------------------------
-- Parameters: the vocabulary thresholds join search.params(); every existing value is unchanged.

alter type search.param_set
  add attribute vocab_fuzzy_sim real,
  add attribute vocab_fuzzy_min_len int,
  add attribute vocab_words_cover real,
  add attribute vocab_request_min_hits int,
  add attribute vocab_request_days int;

-- vocab_fuzzy_sim: "escalde" -> "escalade" scores 0.55, "yoda" -> "yoga" 0.25.
create or replace function search.params() returns search.param_set
language sql immutable
as $$
  select row(0.77::float8, 0.865::float8, 8, 70, 50, 15, 5, 0.6::real, 25, 10, 10, 5, 14, 20, 50, 10, 5,
             50, 500,
             0.5::real, 4, 0.5::real, 2, 90)::search.param_set
$$;

-- ---------------------------------------------------------------------------------------------
-- Normalisation and tokens: identical to importer/importer/embed.py (normalise_query), the app
-- and importer/importer/vocab.py (tokens); shared fixture shared/normalise_cases.json.

-- NFC, whitespace (explicit class, so the result does not depend on the locale) collapsed to one
-- space, trimmed, lower-cased, cut to 200 code points.
create function search.normalise_query(x text) returns text
language sql immutable
as $$
  select left(pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(
           normalize(x, nfc),
           '[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'), ' ')),
         200)
$$;

-- Tokens of an already-normalised string, in order; empty tokens dropped.
create function search.tokens(x text) returns text[]
language sql immutable
as $$
  select coalesce(pg_catalog.array_agg(s.t order by s.n), '{}')
  from pg_catalog.regexp_split_to_table(x, '[ ''’\-.,;:!?()"/«»…]+') with ordinality as s(t, n)
  where s.t <> ''
$$;

-- Single source: importer/importer/data/stopwords_fr.txt (a test checks this line matches it).
create table search.stopwords (word text primary key);
insert into search.stopwords (word) select unnest(string_to_array('a à au aux avec ce ces d dans de des du en et l la le les leur leurs mon ma mes ou par pour sa se ses son sur ta te tes ton un une vos votre nos notre club association asso', ' '));

-- ---------------------------------------------------------------------------------------------
-- Vocabulary and requests. Written by the importer (python -m importer vocab).

create table search.query_vocab (
  phrase text primary key,
  embedding extensions.vector(384) not null,
  source text not null check (source in ('ngram', 'category', 'tag', 'keyword', 'watchlist', 'request')),
  doc_freq int not null default 0,
  model text not null default 'e5-small-v1',  -- another value means "re-embed"
  updated_at timestamptz not null default now()
);
create index query_vocab_phrase_trgm on search.query_vocab using gist (phrase extensions.gist_trgm_ops);

-- Queries the vocabulary did not know, anonymised (search.anonymise_query) and counted per phrase,
-- at most once a day (search.log_vocab_request).
-- No user, no position, and days rather than times.
create table search.vocab_requests (
  phrase text primary key,
  hits int not null default 1,
  first_seen date not null default current_date,
  last_seen date not null default current_date
);

revoke all on search.stopwords, search.query_vocab, search.vocab_requests
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Resolution: exact phrase -> fuzzy (closest spelling) -> words (the most specific known unit) -> none.
-- Always returns exactly one row.

create function search.resolve_query(p_query text)
returns table (embedding extensions.vector, method text, matched text)
language plpgsql stable
set search_path = pg_catalog, pg_temp
as $$
declare
  prm search.param_set := search.params();
  q text := search.normalise_query(p_query);
  v_tokens text[];
  v_phrase text;
  v_emb extensions.vector;
  v_content int;
  v_covered int;
  v_matched text;
begin
  if coalesce(q, '') = '' then
    return query select null::extensions.vector, 'none'::text, null::text;
    return;
  end if;

  select v.embedding into v_emb from search.query_vocab v where v.phrase = q;
  if found then
    return query select v_emb, 'exact'::text, q;
    return;
  end if;

  v_tokens := search.tokens(q);

  -- Fuzzy is for spelling mistakes: the closest phrase must also have as many tokens as the query,
  -- otherwise "cours de danse bretonne" (similarity 0.65 to "danse bretonne") would drop words
  -- that the words step keeps.
  if char_length(q) >= prm.vocab_fuzzy_min_len then
    select v.phrase, v.embedding into v_phrase, v_emb
    from search.query_vocab v
    order by v.phrase operator(extensions.<->) q
    limit 1;
    if found and extensions.similarity(v_phrase, q) >= prm.vocab_fuzzy_sim
       and cardinality(search.tokens(v_phrase)) = cardinality(v_tokens) then
      return query select v_emb, 'fuzzy'::text, v_phrase;
      return;
    end if;
  end if;

  -- Units: every non-stop-word token, and every run of 2 or 3 adjacent tokens (vocabulary phrases are
  -- 1-3 tokens joined by single spaces) with a non-stop-word in it: "jeu de go club" finds "jeu de go".
  with t as (
    select u.tok, u.n, exists (select 1 from search.stopwords s where s.word = u.tok) as stop
    from unnest(v_tokens) with ordinality as u(tok, n)
  ),
  units as (
    select t.tok as unit, t.n as pos, 1 as len from t where not t.stop
    union all
    select a.tok || ' ' || b.tok, a.n, 2 from t a join t b on b.n = a.n + 1
    where not (a.stop and b.stop)
    union all
    select a.tok || ' ' || b.tok || ' ' || c.tok, a.n, 3
    from t a join t b on b.n = a.n + 1 join t c on c.n = a.n + 2
    where not (a.stop and b.stop and c.stop)
  ),
  hit as (
    select u.unit, u.pos, u.len, v.embedding, v.doc_freq
    from units u join search.query_vocab v on v.phrase = u.unit
  ),
  -- No average: e5 vectors share a large common component, so the mean of several units collapses
  -- toward it and ranks every document alike. The most specific unit carries the meaning: most
  -- tokens, then rarest (curated phrases have doc_freq 0), then alphabetical.
  best as (
    select h.unit, h.embedding from hit h order by h.len desc, h.doc_freq, h.unit limit 1
  )
  select (select count(*) from t where not t.stop),
         (select count(distinct t.n) from t join hit h on t.n between h.pos and h.pos + h.len - 1
          where not t.stop),
         (select b.embedding from best b),
         (select b.unit from best b)
    into v_content, v_covered, v_emb, v_matched;

  if v_content > 0 and v_covered::real / v_content >= prm.vocab_words_cover then
    return query select v_emb, 'words'::text, v_matched;
    return;
  end if;

  return query select null::extensions.vector, 'none'::text, null::text;
end
$$;

-- A query the vocabulary approximated (words) or missed (none) is counted, anonymised, so the
-- nightly job can add the ones seen on vocab_request_min_hits different days (one hit per phrase
-- per day: a single person repeating a query cannot promote it). A phrase with 6 or more digits in
-- total is never stored ("06 12 34 56 78" survives anonymise_query token by token). p_method is
-- the query's resolve_query method, which search_explore already holds.
create function search.log_vocab_request(p_query text, p_method text) returns void
language plpgsql volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  v_phrase text;
begin
  if p_method is null or p_method not in ('words', 'none') then
    return;
  end if;
  v_phrase := search.anonymise_query(p_query);
  if char_length(v_phrase) < 2 or char_length(regexp_replace(v_phrase, '[^0-9]', '', 'g')) >= 6 then
    return;
  end if;
  insert into search.vocab_requests as r (phrase) values (v_phrase)
  on conflict (phrase) do update
    set hits = r.hits + case when r.last_seen < current_date then 1 else 0 end, last_seen = current_date;
end
$$;

-- Same, resolving the query first.
create function search.log_vocab_request(p_query text) returns void
language sql volatile
set search_path = pg_catalog, pg_temp
as $$
  select search.log_vocab_request(p_query, (select r.method from search.resolve_query(p_query) r))
$$;

revoke all on function search.normalise_query(text), search.tokens(text), search.resolve_query(text),
  search.log_vocab_request(text), search.log_vocab_request(text, text) from public, anon, authenticated, service_role;

select cron.schedule('prune-vocab-requests', '20 4 * * *',
  $$ delete from search.vocab_requests
     where last_seen < current_date - (search.params()).vocab_request_days $$);

-- ---------------------------------------------------------------------------------------------
-- search_explore: without a caller embedding, the query's meaning comes from search.resolve_query.
-- Attributes and grants as in 20261022000007_search.sql; changes: v_emb, v_match, the request log
-- and "query_match" in the response.

create or replace function public.search_explore(
  p_lon float8, p_lat float8,
  p_radius_km int default 10,
  p_query text default null,
  p_query_embedding extensions.vector default null,
  p_kinds text[] default '{activity,association}',
  p_weekday smallint default null,
  p_newcomer_friendly boolean default false,
  p_interest_category_ids uuid[] default '{}',
  p_sort text default 'best',
  p_limit int default 20, p_offset int default 0
) returns jsonb
language plpgsql volatile security definer
set search_path = public, search, extensions, pg_temp
-- JIT compiles the scoring expressions for ~450 ms of the scan over a 150k-row candidate set and
-- never pays back on this workload (measured: p95 1.6 s with it, 1.35 s without).
set jit = off
-- A generic plan (chosen after five calls in a session) cannot fold the inlined explore_rows on
-- the call's mode and filters: measured 1.3 s against 0.75 s per radius-10 search at 150k rows.
set plan_cache_mode = force_custom_plan
as $$
declare
  prm record;
  v_point geography;
  v_query text := nullif(btrim(p_query), '');
  v_mode text;
  v_slugs text[] := '{}';
  v_results jsonb;
  v_strong int;
  v_has_more boolean;
  v_strong_50 int;
  v_suggest int;
  v_miss text;
  v_emb extensions.vector := p_query_embedding;
  v_match text;
begin
  select * into prm from search.params();
  if p_radius_km is null or p_radius_km not in (5, 10, 25, 50) then
    raise exception 'radius must be 5, 10, 25 or 50 km' using errcode = '22023';
  end if;
  if p_lon is null or p_lat is null or p_lon not between -180 and 180 or p_lat not between -90 and 90 then
    raise exception 'invalid coordinates' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and prm.max_limit then
    raise exception 'limit must be between 1 and %', prm.max_limit using errcode = '22023';
  end if;
  if p_offset is null or p_offset not between 0 and prm.max_offset then
    raise exception 'offset must be between 0 and %', prm.max_offset using errcode = '22023';
  end if;
  if char_length(p_query) > 200 then
    raise exception 'query too long' using errcode = '22023';
  end if;
  if p_query_embedding is not null and vector_dims(p_query_embedding) <> 384 then
    raise exception 'query embedding must have 384 dimensions' using errcode = '22023';
  end if;
  if p_sort is null or p_sort not in ('best', 'nearest') then
    raise exception 'sort must be best or nearest' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_kinds), 0) = 0 or not p_kinds <@ '{activity,association}'::text[]
     or array_position(p_kinds, null) is not null then
    raise exception 'kinds must be activity and/or association' using errcode = '22023';
  end if;
  if p_weekday is not null and p_weekday not between 1 and 7 then
    raise exception 'weekday must be between 1 and 7' using errcode = '22023';
  end if;

  v_point := ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography;
  if v_query is not null and p_query_embedding is not null then
    v_match := 'given';
  elsif v_query is not null then
    select r.embedding, r.method into v_emb, v_match from search.resolve_query(v_query) r;
  end if;
  v_mode := case when v_query is null then 'browse'
                 when v_emb is not null then 'search' else 'keyword_only' end;
  if v_mode = 'browse' and cardinality(p_interest_category_ids) > 0 then
    select coalesce(array_agg(c.slug), '{}') into v_slugs
    from categories c
    where c.id = any(p_interest_category_ids) or c.parent_id = any(p_interest_category_ids);
    if cardinality(v_slugs) = 0 then v_slugs := '{""}'; end if;  -- unknown ids match nothing
  end if;

  with r as (
    select e.*, coalesce(e.score < prm.weak, false) as is_weak
    from search.explore_rows(v_point, p_radius_km * 1000.0, v_query,
           case when v_mode = 'search' then v_emb end,
           p_kinds, p_weekday, coalesce(p_newcomer_friendly, false), v_slugs) e
  ),
  ranked as (
    select r.*, row_number() over (order by
             case when v_mode = 'browse' then r.penalty > 0 else r.is_weak end,
             case when v_mode <> 'browse' and p_sort = 'best' then floor(r.score / prm.tie_window::float8) end desc,
             r.distance_m, r.id) as rn
    from r
  ),
  page as (
    select * from ranked where rn > p_offset and rn <= p_offset + p_limit
  ),
  items as (
    select pg.rn, jsonb_build_object(
             'kind', pg.kind, 'id', pg.id, 'title', d.title, 'subtitle', d.subtitle,
             'snippet', left(d.body, 140),
             'lon', ST_X(d.pt::geometry), 'lat', ST_Y(d.pt::geometry),
             'distance_km', round((pg.distance_m / 1000)::numeric, 1),
             'score', pg.score,
             'label', case when pg.score is null then null
                           when pg.score >= prm.strong then 'very_relevant'
                           when pg.score >= prm.weak then 'relevant' else 'weak' end,
             'is_weak', pg.is_weak, 'is_new', pg.is_new, 'source_label', pg.source_label,
             'tag_slugs', to_jsonb(d.tag_slugs)) as item
    from page pg
    cross join lateral (
      select a.name as title, a.city as subtitle, a.purpose as body, a.town_point as pt,
             array(select t.slug from association_tags at join tags t on t.id = at.tag_id
                   where at.association_id = a.id order by t.slug) as tag_slugs
      from associations a where pg.kind = 'association' and a.id = pg.id
      union all
      select x.title, x.place_label, x.description, x.place,
             array(select t.slug from activity_tags at join tags t on t.id = at.tag_id
                   where at.activity_id = x.id order by t.slug)
      from activities x where pg.kind = 'activity' and x.id = pg.id
    ) d
  )
  select coalesce((select jsonb_agg(item order by rn) from items), '[]'::jsonb),
         (select count(*) from ranked where score >= prm.strong),
         -- No next page past max_offset: the app would request an offset the guard rejects.
         p_offset + p_limit < prm.max_offset
           and exists (select 1 from ranked where rn = p_offset + p_limit + 1)
    into v_results, v_strong, v_has_more;

  if v_mode <> 'browse' and v_strong < prm.widen_min and p_radius_km < 50 then
    select count(*) into v_strong_50
    from search.explore_rows(v_point, 50000, v_query,
           case when v_mode = 'search' then v_emb end,
           p_kinds, p_weekday, coalesce(p_newcomer_friendly, false), v_slugs) e
    where e.score >= prm.strong;
    if v_strong_50 > v_strong then v_suggest := 50; end if;
  end if;

  if v_mode <> 'browse' and p_offset = 0 and v_strong = 0 then
    v_miss := search.anonymise_query(v_query);
    if char_length(v_miss) >= 2 then
      -- created_at carries the day only, like `day`: a miss never records when it was searched.
      insert into search_misses (query, area_label, day, created_at)
      values (v_miss,
              (select a.city from associations a
               where a.city is not null and a.town_point is not null
               order by a.town_point <-> v_point limit 1),
              current_date, current_date::timestamptz)
      on conflict (query, (coalesce(area_label, '')), day)
        do update set hits = search_misses.hits + 1;
    end if;
  end if;

  if v_mode <> 'browse' and p_offset = 0 and v_match in ('words', 'none') then
    perform search.log_vocab_request(v_query, v_match);
  end if;

  return jsonb_build_object('mode', v_mode, 'query_match', v_match, 'results', v_results,
    'strong_count', v_strong,
    'strong_count_50km', v_strong_50, 'suggest_radius_km', v_suggest, 'has_more', v_has_more);
end
$$;
revoke all on function public.search_explore(float8, float8, int, text, extensions.vector, text[], smallint,
  boolean, uuid[], text, int, int) from public;
grant execute on function public.search_explore(float8, float8, int, text, extensions.vector, text[], smallint,
  boolean, uuid[], text, int, int) to anon, authenticated;
