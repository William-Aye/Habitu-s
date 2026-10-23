import { supabase } from '../../lib/supabase';
import { runAsUser } from './errors';
import type { ApiResult } from './types';

export interface LinkableAssociation {
  id: string;
  name: string;
  address: string | null;
}

const MAX_RESULTS = 10;

/**
 * Directory search limited to what the database lets this user link: an unverified association,
 * or a verified one they claimed (see activities_guard_association).
 */
export async function searchLinkableAssociations(q: string, userId: string): Promise<LinkableAssociation[]> {
  // % and _ are wildcards in ilike; commas and parentheses would break the or() filter.
  const term = q.trim().replace(/[%_,()\\]/g, ' ');
  if (term.length < 2) return [];
  const { data, error } = await supabase
    .from('associations')
    .select('id, name, address')
    .ilike('name', `%${term}%`)
    .or(`verified.eq.false,claimed_by.eq.${userId}`)
    .order('name')
    .limit(MAX_RESULTS);
  if (error) throw new Error('association search failed');
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, address: r.address ?? null }));
}

/**
 * A club that is not listed: creates a community listing (labelled "Ajouté par la communauté",
 * queued for the admin check, ranked lower until then). The website or contact is optional.
 */
export function addCommunityAssociation(input: {
  name: string;
  website: string;
}): Promise<ApiResult<{ id: string }>> {
  const website = input.website.trim();
  return runAsUser(
    (userId) =>
      supabase
        .from('associations')
        .insert({
          name: input.name.trim(),
          website: website === '' ? null : website,
          source: 'community',
          created_by: userId,
        })
        .select('id')
        .single(),
    (row) => ({ id: row.id as string }),
  );
}
