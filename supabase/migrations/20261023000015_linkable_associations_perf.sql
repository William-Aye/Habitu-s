-- The linkable-association search must not scan ~1.5M rows per keystroke: match with ilike on the
-- normalised name through a trigram index (position() cannot use one).
create index if not exists associations_name_norm_trgm
  on public.associations using gin (name_norm gin_trgm_ops);

-- Queries shorter than 3 characters have no trigram to look up: they return nothing.
-- The fallback (a query the normaliser empties, such as "club") matches the raw name, which
-- associations_name_trgm indexes; those words are plain ASCII, so accents do not matter there.
create or replace function public.search_linkable_associations(p_query text, p_limit int default 20)
returns table (id uuid, name text, city text, postcode text)
language sql stable security definer set search_path = public, pg_temp as $$
  with q as (
    select search.normalise_name(p_query) as norm, btrim(coalesce(p_query, '')) as raw
  ), pat as (
    select case when char_length(norm) >= 3
                then '%' || replace(replace(replace(norm, '\', '\\'), '%', '\%'), '_', '\_') || '%' end as norm_pat,
           case when norm = '' and char_length(raw) >= 3
                then '%' || replace(replace(replace(raw, '\', '\\'), '%', '\%'), '_', '\_') || '%' end as raw_pat
      from q
  )
  select a.id, a.name, a.city, a.postcode
    from public.associations a, pat
   where (a.verified = false or a.claimed_by = auth.uid())
     and ((pat.norm_pat is not null and a.name_norm ilike pat.norm_pat)
          or (pat.raw_pat is not null and a.name ilike pat.raw_pat))
   order by a.name, a.id
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;
