-- WEB-2 (pre-launch security review): web_sitemap_range(p_kind, p_lo, p_hi) let anyone holding the
-- public anon key ask for any id range, null bounds included: one request scanned up to 50,000 rows
-- and returned several megabytes, straight from PostgREST (no edge cache in front of it).
-- It now takes the bucket number the site already uses (web/src/pages.ts) and computes the bounds
-- itself: 16 activity buckets (first hex digit of the id), 256 association buckets (first two hex
-- digits). One call covers at most one bucket and returns at most 10,000 rows (about 6,000
-- associations per bucket at 1.5 million). Anything else is refused.
-- The selection rules are migration 36's, unchanged.

drop function public.web_sitemap_range(text, uuid, uuid);

create function public.web_sitemap_range(p_kind text, p_bucket int) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_count int := case p_kind when 'activities' then 16 when 'associations' then 256 end;
  v_lo uuid;
  v_hi uuid;
begin
  if v_count is null then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if p_bucket is null or p_bucket < 0 or p_bucket >= v_count then
    raise exception 'invalid bucket' using errcode = '22023';
  end if;
  -- bucket n covers ids from byte n * (256 / count) up to the next bucket's first byte (exclusive)
  v_lo := (lpad(to_hex(p_bucket * (256 / v_count)), 2, '0') || '000000-0000-0000-0000-000000000000')::uuid;
  v_hi := case when p_bucket = v_count - 1 then null
               else (lpad(to_hex((p_bucket + 1) * (256 / v_count)), 2, '0') || '000000-0000-0000-0000-000000000000')::uuid end;

  if p_kind = 'activities' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'updated_at', r.created_at)
                                      order by r.id)
      from (select a.id, a.title, a.created_at from public.activities a
            where a.archived_at is null and a.removed_by_moderation_at is null
              and a.published_at <= now()
              and not exists (select 1 from public.profiles p where p.id = a.organiser_id and p.banned_at is not null)
              and a.id >= v_lo and (v_hi is null or a.id < v_hi)
            order by a.id limit 10000) r), '[]'::jsonb);
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'city', r.city,
                                                       'updated_at', r.updated_at) order by r.id)
    from (select a.id, a.name, a.city, a.updated_at from public.associations a
          where a.removed_at is null
            and not search.is_hidden(a.confidence, a.source)
            and not search.is_dormant(a.website, a.osm_id, a.claimed_by, a.rna_published_on, a.source, current_date)
            and a.id >= v_lo and (v_hi is null or a.id < v_hi)
          order by a.id limit 10000) r), '[]'::jsonb);
end $$;
revoke all on function public.web_sitemap_range(text, int) from public;
grant execute on function public.web_sitemap_range(text, int) to anon, authenticated;
