-- The linkable-association search ran 6-42 s at 1M rows: as a SECURITY DEFINER SQL function it is
-- not inlined, so it ran a generic plan whose bitmap Recheck evaluated normalise_name($1) and the
-- CASE once per row. In plpgsql the patterns are computed once into variables and the query
-- is planned with them as values. Prefix matches come first, which also keeps the sort cheap.
create or replace function public.search_linkable_associations(p_query text, p_limit int default 20)
returns table (id uuid, name text, city text, postcode text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_norm text := search.normalise_name(p_query);
  v_raw text := btrim(coalesce(p_query, ''));
  v_norm_pat text;
  v_raw_pat text;
  v_prefix text;
  v_uid uuid := auth.uid();
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if char_length(v_norm) >= 3 then
    v_norm_pat := '%' || replace(replace(replace(v_norm, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_prefix := substr(v_norm_pat, 2);
  end if;
  if v_norm = '' and char_length(v_raw) >= 3 then
    v_raw_pat := '%' || replace(replace(replace(v_raw, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  if v_norm_pat is null and v_raw_pat is null then
    return;
  end if;
  return query
    select a.id, a.name, a.city, a.postcode
      from public.associations a
     where (a.verified = false or a.claimed_by = v_uid)
       and ((v_norm_pat is not null and a.name_norm ilike v_norm_pat)
            or (v_raw_pat is not null and a.name ilike v_raw_pat))
     order by (v_prefix is not null and a.name_norm like v_prefix) desc, a.name, a.id
     limit v_limit;
end $$;
revoke all on function public.search_linkable_associations(text, int) from public, anon;
grant execute on function public.search_linkable_associations(text, int) to authenticated;
