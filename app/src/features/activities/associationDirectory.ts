import { supabase } from '../../lib/supabase';
import { runAsUser } from './errors';
import type { ApiResult } from './types';

export interface LinkableAssociation {
  id: string;
  name: string;
  city: string | null;
  postcode: string | null;
}

const MAX_RESULTS = 10;

/**
 * Directory search limited to what the database lets this user link: an unverified association,
 * or a verified one they claimed. The rule lives in the function (API roles cannot read claimed_by).
 */
export async function searchLinkableAssociations(q: string): Promise<LinkableAssociation[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const { data, error } = await supabase.rpc('search_linkable_associations', {
    p_query: term,
    p_limit: MAX_RESULTS,
  });
  if (error) throw new Error('association search failed');
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, city: r.city ?? null, postcode: r.postcode ?? null }));
}

/** The database accepts web links only: a bare domain gets https://. */
function webLink(text: string): string | null {
  const value = text.trim();
  if (value === '') return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/**
 * A club that is not listed: creates a community listing (labelled "Ajouté par la communauté",
 * queued for the admin check, ranked lower until then). The website or contact is optional.
 */
export function addCommunityAssociation(input: {
  name: string;
  website: string;
}): Promise<ApiResult<{ id: string }>> {
  return runAsUser(
    (userId) =>
      supabase
        .from('associations')
        .insert({
          name: input.name.trim(),
          website: webLink(input.website),
          source: 'community',
          created_by: userId,
        })
        .select('id')
        .single(),
    (row) => ({ id: row.id as string }),
  );
}
