import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import { supabase } from '../../lib/supabase';
import { authed } from '../safety/authed';
import type { SafetyResult } from '../safety/types';

export const CLAIM_ROLE_MAX = 80;
export const CLAIM_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const EXTENSIONS: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

export interface ClaimInput {
  associationId: string;
  role: string;
  contactEmail?: string;
  documentUri?: string;
  documentMimeType?: string;
}

/**
 * Files a claim on a listing. The proof is an e-mail address or a document (stored privately at
 * `claim-documents/<uid>/<uuid>.<ext>`); an admin checks it by hand.
 */
export function submitClaim(input: ClaimInput): Promise<SafetyResult> {
  const email = input.contactEmail?.trim() || undefined;
  return authed(async (userId) => {
    let documentPath: string | null = null;
    if (input.documentUri) {
      const ext = EXTENSIONS[input.documentMimeType ?? ''];
      if (!ext) return { error: { code: '22023', message: 'unsupported_document' } };
      const path = `${userId}/${randomUUID()}.${ext}`;
      try {
        const bytes = await new File(input.documentUri).arrayBuffer();
        const { error } = await supabase.storage
          .from('claim-documents')
          .upload(path, bytes, { contentType: input.documentMimeType });
        if (error) return { error: { message: 'network' } };
      } catch {
        return { error: { message: 'network' } };
      }
      documentPath = path;
    }
    return supabase.from('association_claims').insert({
      association_id: input.associationId,
      claimant_id: userId,
      proof_method: email ? 'domain_email' : 'document',
      role_in_association: input.role.trim(),
      contact_email: email ?? null,
      document_path: documentPath,
    });
  });
}

export interface ClaimedAssociation {
  id: string;
  name: string;
}

/**
 * My verified associations: those where one of my claims was approved. `associations.claimed_by` is not
 * readable by the API roles, so this goes through my own claims; the database re-checks at link time.
 */
export function myVerifiedAssociations(): Promise<SafetyResult<{ associations: ClaimedAssociation[] }>> {
  return authed<{ associations: ClaimedAssociation[] }>(
    (userId) =>
      supabase
        .from('association_claims')
        .select('association_id, associations!inner(id, name, verified)')
        .eq('claimant_id', userId)
        .eq('status', 'approved')
        .eq('associations.verified', true),
    (rows) => {
      const seen = new Map<string, ClaimedAssociation>();
      for (const r of (rows ?? []) as { associations: { id: string; name: string } | null }[]) {
        if (r.associations) seen.set(r.associations.id, { id: r.associations.id, name: r.associations.name });
      }
      return { associations: [...seen.values()] };
    },
  );
}

/** Links a collectif to one of my verified associations; resolves with how many activities moved. */
export function linkCollectifToAssociation(
  collectifId: string,
  associationId: string,
): Promise<SafetyResult<{ moved: number }>> {
  return authed<{ moved: number }>(
    () => supabase.rpc('link_collectif_to_association', { p_collectif: collectifId, p_association: associationId }),
    (n) => ({ moved: typeof n === 'number' ? n : 0 }),
  );
}
