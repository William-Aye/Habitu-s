import type { StoredLocation } from '../explore/types';
import type { HomeAreaInput } from './auth';

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
  try {
    const res = await fetch(
      `https://geo.api.gouv.fr/communes?lat=${location.lat}&lon=${location.lon}` +
        '&fields=nom,centre,codesPostaux&limit=1',
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as {
      nom?: string;
      centre?: { coordinates?: [number, number] };
    }[];
    const first = rows[0];
    const c = first?.centre?.coordinates;
    if (!first?.nom || !c) return null;
    return { label: first.nom, lon: c[0], lat: c[1] };
  } catch {
    return null;
  }
}
