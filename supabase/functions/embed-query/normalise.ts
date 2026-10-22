/** Query normalisation; identical to importer/importer/embed.py normalise_query. */
export const MAX_QUERY_CHARS = 200;

// Explicit whitespace class shared with the Python side (not \s, which differs per runtime).
const WS = /[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g;

/** Length in Unicode code points (matches Python len()). */
export function codePointLength(s: string): number {
  return Array.from(s).length;
}

export function normaliseQuery(text: string): string {
  const collapsed = text.normalize('NFC').replace(WS, ' ').replace(/^ | $/g, '');
  return Array.from(collapsed.toLowerCase()).slice(0, MAX_QUERY_CHARS).join('');
}
