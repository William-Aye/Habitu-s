/**
 * True when `header` is exactly `Bearer <key>`. Both sides are hashed first, then the digests are compared
 * without stopping at the first difference, so the time taken does not depend on how many bytes match.
 */
export async function bearerMatches(header: string | null, key: string): Promise<boolean> {
  if (!key || header === null) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(header)),
    crypto.subtle.digest('SHA-256', enc.encode(`Bearer ${key}`)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
