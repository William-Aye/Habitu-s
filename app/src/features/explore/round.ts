/** A GPS coordinate is kept, looked up and sent only at ~1 km precision (0.01 degree). */
export function roundKm(v: number): number {
  return Math.round(v * 100) / 100;
}
