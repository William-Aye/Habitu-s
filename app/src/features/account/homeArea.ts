import type { StoredLocation } from '../explore/types';
import type { HomeAreaInput } from './auth';

const LOOKUP_TIMEOUT_MS = 10_000;

/**
 * The home area is the commune centre. A town picked in Explore already is one; a GPS
 * position is first turned into its commune. Returns null when it cannot be resolved,
 * so a precise position is never saved by accident.
 */
export async function resolveHomeArea(
  location: StoredLocation | null,
): Promise<HomeAreaInput | null> {
  if (!location) return null;
  if (location.source === 'town') {
    return { label: location.label, lon: location.lon, lat: location.lat };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://geo.api.gouv.fr/communes?lat=${location.lat}&lon=${location.lon}` +
        '&fields=nom,centre,codesPostaux&limit=1',
      { signal: controller.signal },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as {
      nom?: string;
      centre?: { coordinates?: [number, number] };
      codesPostaux?: string[];
    }[];
    const first = rows[0];
    const c = first?.centre?.coordinates;
    if (!first?.nom || !c) return null;
    const cp = first.codesPostaux?.[0];
    return { label: cp ? `${first.nom} (${cp})` : first.nom, lon: c[0], lat: c[1] };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
