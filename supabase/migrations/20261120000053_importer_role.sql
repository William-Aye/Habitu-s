-- TM-7 (threat model): the GitHub import and vocabulary jobs connected as `postgres`, so a
-- compromised action or package in those jobs could take the whole database. They now get their own
-- role with only what they use.
--
-- The role cannot log in until the owner gives it a password on the hosted project (see
-- importer/README.md); IMPORTER_DB_URL then uses it instead of `postgres`. It bypasses row-level
-- security because it is a background job that reads every association, but it has table rights
-- only on the directory, vocabulary and embedding tables: nothing on profiles, messages, auth,
-- storage or Vault, and no right to create or change objects.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'habituer_importer') then
    create role habituer_importer nologin noinherit bypassrls;
  end if;
end $$;
alter role habituer_importer set statement_timeout = '30min';

grant usage on schema public, search, importer, extensions to habituer_importer;
grant temporary on database postgres to habituer_importer;

-- Directory import: staging, geocoding cache, run log; the merge itself runs in importer.apply_run.
grant select, insert, update, delete on importer.staged_rna, importer.staged_osm, importer.geocode_cache
  to habituer_importer;
grant select, insert, update on public.import_runs to habituer_importer;
grant select on public.associations, public.categories, public.tags to habituer_importer;

-- Vocabulary build.
grant select, insert, update, delete on search.query_vocab to habituer_importer;
grant select, delete on search.vocab_requests to habituer_importer;

-- Embeddings of new activities and collectifs: read the text, and write the two embedding columns
-- only through this function. It runs as its owner, so the tables' triggers behave as before, while
-- the role itself has no update right on these user tables.
create or replace function importer.set_embedding(p_table text, p_id uuid, p_embedding extensions.vector,
                                                  p_hash text) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  if p_table = 'activities' then
    update public.activities set embedding = p_embedding, embedding_hash = p_hash where id = p_id;
  elsif p_table = 'collectifs' then
    update public.collectifs set embedding = p_embedding, embedding_hash = p_hash where id = p_id;
  else
    raise exception 'unknown table %', p_table using errcode = '22023';
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function importer.set_embedding(text, uuid, extensions.vector, text) from public, anon, authenticated;

grant select (id, title, description, embedding_hash) on public.activities to habituer_importer;
grant select (id, name, description, embedding_hash) on public.collectifs to habituer_importer;

-- The importer and search helper functions (normalising, tokenising, parameters, apply_run,
-- set_embedding).
grant execute on all functions in schema importer, search to habituer_importer;
