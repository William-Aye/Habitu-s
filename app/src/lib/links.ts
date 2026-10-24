// Shared and public addresses. slugify must stay identical to web/src/slug.ts
// (both are tested against web/src/slug_fixtures.json).
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const LINK_RE = new RegExp(`^(?:[a-z][a-z0-9+.-]*:\/\/[^/]*)?(?:\/app)?\/?(activites|associations)\/(?:[^/?#]*-)?(${UUID})\/?(?:[?#].*)?$`, 'i');
const TRANSLIT: Record<string, string> = { ł: 'l', ø: 'o', đ: 'd', ß: 'ss', æ: 'ae', œ: 'oe' };

export function slugify(text: string, max = 60): string {
  const s = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[łøđßæœ]/g, (c) => TRANSLIT[c])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, max).replace(/-+$/g, '');
}

/** The configured website address without a trailing slash ('' when unset). */
export function webBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_WEB_BASE_URL ?? '').replace(/\/+$/, '');
}

function build(kind: 'activites' | 'associations', id: string, slug: string, base: string): string {
  if (!base) return `friendapp://${kind}/${id}`;
  return `${base}/${kind}/${slug ? `${slug}-` : ''}${id}`;
}

/** Readable address of an activity; the app's own link when no website is configured. */
export function activityUrl(id: string, title: string, base: string = webBaseUrl()): string {
  return build('activites', id, slugify(title), base);
}

export function associationUrl(id: string, name: string, city?: string | null, base: string = webBaseUrl()): string {
  return build('associations', id, slugify(`${name} ${city ?? ''}`), base);
}

/** The activity or association an incoming link points at (any address form), or null. */
export function idFromLink(url: string): { kind: 'activity' | 'association'; id: string } | null {
  const m = LINK_RE.exec(url.trim());
  if (!m) return null;
  return { kind: m[1].toLowerCase() === 'activites' ? 'activity' : 'association', id: m[2].toLowerCase() };
}
