import { supabase } from '../../lib/supabase';
import type {
  AssociationDetail,
  ExploreParams,
  ExploreResponse,
  ExploreResult,
  Town,
} from './types';
import { normaliseQuery } from './types';

export class ExploreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExploreError';
  }
}

const EMBEDDING_DIMENSIONS = 384;

export async function embedQuery(text: string, timeoutMs = 8000): Promise<number[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const call = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke('embed-query', { body: { text } });
      if (error) return null;
      const v = (data as { embedding?: unknown } | null)?.embedding;
      if (
        Array.isArray(v) &&
        v.length === EMBEDDING_DIMENSIONS &&
        v.every((n) => typeof n === 'number' && Number.isFinite(n))
      ) {
        return v as number[];
      }
      return null;
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function mapResult(r: any): ExploreResult {
  return {
    kind: r.kind,
    id: r.id,
    title: r.title,
    subtitle: r.subtitle ?? null,
    snippet: r.snippet ?? null,
    lon: r.lon,
    lat: r.lat,
    distanceKm: r.distance_km,
    score: r.score,
    label: r.label ?? null,
    isWeak: !!r.is_weak,
    isNew: !!r.is_new,
    sourceLabel: r.source_label ?? null,
    tagSlugs: r.tag_slugs ?? [],
  };
}

export async function searchExplore(
  p: ExploreParams,
  page: { limit: number; offset: number },
  embedding: number[] | null,
): Promise<ExploreResponse> {
  const { data, error } = await supabase.rpc('search_explore', {
    p_lon: p.center.lon,
    p_lat: p.center.lat,
    p_radius_km: p.radiusKm,
    p_query: normaliseQuery(p.query),
    p_query_embedding: embedding,
    p_kinds: p.kinds,
    p_weekday: p.weekday,
    p_newcomer_friendly: p.newcomerFriendly,
    p_interest_category_ids: p.interestCategoryIds,
    p_sort: p.sort,
    p_limit: page.limit,
    p_offset: page.offset,
  } as any);
  if (error || !data) throw new ExploreError(error?.message ?? 'empty response');
  const d = data as any;
  return {
    mode: d.mode,
    results: (d.results ?? []).map(mapResult),
    strongCount: d.strong_count ?? 0,
    strongCount50km: d.strong_count_50km ?? 0,
    suggestRadiusKm: d.suggest_radius_km ?? null,
    hasMore: !!d.has_more,
  };
}

export async function getAssociation(id: string): Promise<AssociationDetail | null> {
  const { data, error } = await supabase.rpc('get_association', { p_id: id } as any);
  if (error) throw new ExploreError(error.message);
  if (!data) return null;
  const d = data as any;
  return {
    id: d.id,
    name: d.name,
    purpose: d.purpose ?? null,
    city: d.city ?? null,
    postcode: d.postcode ?? null,
    lon: d.lon ?? null,
    lat: d.lat ?? null,
    website: d.website ?? null,
    phone: d.phone ?? null,
    email: d.email ?? null,
    openingHours: d.opening_hours ?? null,
    source: d.source,
    verified: !!d.verified,
    claimed: !!d.claimed,
    sourceLabel: d.source_label ?? null,
    attributionKeys: d.attribution_keys ?? [],
    tags: (d.tags ?? []).map((t: any) => ({ slug: t.slug, labelFr: t.label_fr, labelEn: t.label_en })),
    activities: d.activities ?? [],
    canWait: !!d.can_wait,
    isWaiting: !!d.is_waiting,
  };
}

export async function addWaiter(associationId: string): Promise<'added' | 'signed_out'> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return 'signed_out';
  const { error } = await supabase
    .from('association_waiters')
    .insert({ association_id: associationId, user_id: userId });
  // 23505: already waiting — idempotent.
  if (error && error.code !== '23505') throw new ExploreError(error.message);
  return 'added';
}

export async function removeWaiter(associationId: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;
  const { error } = await supabase
    .from('association_waiters')
    .delete()
    .eq('association_id', associationId)
    .eq('user_id', userId);
  if (error) throw new ExploreError(error.message);
}

export async function searchTowns(q: string): Promise<Town[]> {
  const url =
    `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(q)}` +
    '&fields=nom,centre,codesPostaux&boost=population&limit=5';
  const res = await fetch(url);
  if (!res.ok) throw new ExploreError(`geo.api ${res.status}`);
  const rows = (await res.json()) as {
    nom: string;
    codesPostaux?: string[];
    centre?: { coordinates: [number, number] };
  }[];
  return rows
    .filter((r) => r.centre?.coordinates)
    .map((r) => ({
      label: r.codesPostaux?.[0] ? `${r.nom} (${r.codesPostaux[0]})` : r.nom,
      lon: r.centre!.coordinates[0],
      lat: r.centre!.coordinates[1],
    }));
}
