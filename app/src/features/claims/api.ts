import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import { supabase } from '../../lib/supabase';
import { authed } from '../safety/authed';
import { storageFailure } from '../safety/storageError';
import type { SafetyError, SafetyResult } from '../safety/types';

export const CLAIM_ROLE_MAX = 80;
export const CLAIM_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const EXTENSIONS: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

export type ClaimError = SafetyError | 'duplicate' | 'too_large' | 'unsupported';
export type ClaimResult = { ok: true } | { ok: false; error: ClaimError };

const EXTENSION_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** The type of a picked document: the picker's own when it gives one, else guessed from the extension. */
export function documentMimeType(name: string, mimeType: string | null | undefined): string | null {
  if (mimeType) return mimeType;
  return EXTENSION_TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

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
export async function submitClaim(input: ClaimInput): Promise<ClaimResult> {
  const email = input.contactEmail?.trim() || undefined;
  let special: ClaimError | null = null;
  const result = await authed(async (userId) => {
    let documentPath: string | null = null;
    if (input.documentUri) {
      const ext = EXTENSIONS[input.documentMimeType ?? ''];
      if (!ext) {
        special = 'unsupported';
        return { error: { code: '22023', message: 'unsupported_document' } };
      }
      const path = `${userId}/${randomUUID()}.${ext}`;
      try {
        const bytes = await new File(input.documentUri).arrayBuffer();
        const { error } = await supabase.storage
          .from('claim-documents')
          .upload(path, bytes, { contentType: input.documentMimeType });
        if (error) {
          const failure = storageFailure(error);
          if (failure === 'too_large') special = 'too_large';
          return { error: { code: failure === 'network' ? null : 'storage', message: failure === 'network' ? 'network' : error.message } };
        }
      } catch {
        return { error: { message: 'network' } };
      }
      documentPath = path;
    }
    const inserted = await supabase.from('association_claims').insert({
      association_id: input.associationId,
      claimant_id: userId,
      proof_method: email ? 'domain_email' : 'document',
      role_in_association: input.role.trim(),
      contact_email: email ?? null,
      document_path: documentPath,
    });
    // A second pending claim on the same association (unique index).
    if (inserted.error?.code === '23505') special = 'duplicate';
    return inserted;
  });
  const found = special as ClaimError | null;
  if (!result.ok && found) return { ok: false, error: found };
  return result;
}

/** My claim on a listing: 'approved' wins over 'pending'; null when none (or signed out). */
export async function myClaimStatus(associationId: string): Promise<'pending' | 'approved' | null> {
  const r = await authed<{ statuses: string[] }>(
    (userId) =>
      supabase
        .from('association_claims')
        .select('status')
        .eq('association_id', associationId)
        .eq('claimant_id', userId)
        .in('status', ['pending', 'approved']),
    (rows) => ({ statuses: ((rows ?? []) as { status: string }[]).map((x) => x.status) }),
  );
  if (!r.ok) return null;
  if (r.statuses.includes('approved')) return 'approved';
  return r.statuses.includes('pending') ? 'pending' : null;
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
