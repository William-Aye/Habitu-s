export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const ATTRIBUTION = '© OpenMapTiles © OpenStreetMap contributors';

const KM_PER_DEGREE_LAT = 111.32;

/** [west, south, east, north] box covering `radiusKm` around the centre. */
export function boundsAround(
  center: { lon: number; lat: number },
  radiusKm: number,
): [number, number, number, number] {
  const dLat = radiusKm / KM_PER_DEGREE_LAT;
  const dLon = radiusKm / (KM_PER_DEGREE_LAT * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.01));
  return [center.lon - dLon, center.lat - dLat, center.lon + dLon, center.lat + dLat];
}

/** Pixel radius of `km` on screen at a given zoom and latitude (512px tiles). */
export function kmToPixels(km: number, zoom: number, lat: number): number {
  const metersPerPixel = (78271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  return (km * 1000) / metersPerPixel;
}
