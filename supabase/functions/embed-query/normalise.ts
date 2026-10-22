/** Query normalisation; identical to importer/importer/embed.py normalise_query. */
export const MAX_QUERY_CHARS = 200;

export function normaliseQuery(text: string): string {
  return text
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .slice(0, MAX_QUERY_CHARS);
}
