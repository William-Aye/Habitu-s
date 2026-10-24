const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
/** A slow or rate-limited service never holds up publishing for longer than this. */
export const PUBLIC_PLACE_TIMEOUT_MS = 4000;
const RADIUS_M = 60;
/** Only places the public can walk into count: a tag key alone also matches private ones (a shop's flat, a pitch). */
export const PUBLIC_AMENITIES = [
  'cafe', 'restaurant', 'bar', 'pub', 'library', 'community_centre', 'arts_centre', 'cinema', 'theatre',
  'townhall', 'place_of_worship', 'marketplace', 'fast_food', 'ice_cream',
] as const;
export const PUBLIC_LEISURE = ['park', 'sports_centre', 'pitch', 'stadium', 'playground', 'fitness_centre', 'dance'] as const;
export const PUBLIC_TOURISM = ['museum', 'gallery', 'attraction'] as const;

const alt = (values: readonly string[]) => `"^(${values.join('|')})$"`;

function query(lat: number, lon: number): string {
  const around = `(around:${RADIUS_M},${lat},${lon})`;
  const filters = [
    `["amenity"~${alt(PUBLIC_AMENITIES)}]`,
    '["shop"]',
    `["leisure"~${alt(PUBLIC_LEISURE)}]`,
    `["tourism"~${alt(PUBLIC_TOURISM)}]`,
    `["sport"]["leisure"~${alt(PUBLIC_LEISURE)}]`,
    '["office"="association"]',
  ];
  return `[out:json][timeout:3];(${filters.map((f) => `nwr${around}${f};`).join('')});out ids 1;`;
}

/**
 * Asks OpenStreetMap (Overpass) whether a public place (cafe, shop, park, sports hall, association
 * office... from a fixed list of public tags) lies within 60 m. Only the position, rounded to about 10 m, is sent: no identifier of the user.
 * `'unknown'` on any failure or after 4 seconds, so the caller never blocks on this check.
 */
export async function hasPublicPlaceNearby(lat: number, lon: number): Promise<boolean | 'unknown'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUBLIC_PLACE_TIMEOUT_MS);
  try {
    const body = `data=${encodeURIComponent(query(Number(lat.toFixed(4)), Number(lon.toFixed(4))))}`;
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) return 'unknown';
    const json = (await res.json()) as { elements?: unknown; remark?: unknown };
    // Overpass answers 200 with an empty list and a remark when it ran out of time or memory.
    if (typeof json.remark === 'string' && /runtime error/i.test(json.remark)) return 'unknown';
    if (!Array.isArray(json.elements)) return 'unknown';
    return json.elements.length > 0;
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}
