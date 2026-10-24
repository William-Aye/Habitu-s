import { idFromLink } from '../lib/links';

/** Opens https://<host>/activites/<slug>-<uuid> links (App Links) on the id-only routes. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const link = idFromLink(path);
    if (link) return `/${link.kind === 'activity' ? 'activites' : 'associations'}/${link.id}`;
  } catch {
    // Fall through to the unchanged path.
  }
  return path;
}
