import { supabase } from '../../lib/supabase';

export type AdminError =
  | 'not_allowed'
  | 'refused'
  | 'limit_reached'
  | 'invalid_statement'
  | 'invalid_target'
  | 'invalid_category'
  | 'invalid_word'
  | 'invalid' | 'not_found' | 'already_decided' | 'network' | 'unknown';
export type AdminResult<T extends object = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: AdminError };

export type ReportDecision = 'dismiss' | 'warn' | 'remove' | 'ban';
export type FeedbackStatus = 'new' | 'planned' | 'done' | 'wont_do';

export interface AdminReport {
  id: string;
  createdAt: string;
  source: 'user' | 'auto' | string;
  targetType: string;
  reason: string;
  details: string | null;
  preview: string | null;
  ownerFirstName: string | null;
  reporterFirstName: string | null;
}
export interface AdminClaim {
  id: string;
  associationName: string;
  city: string | null;
  claimantFirstName: string | null;
  role: string;
  contactEmail: string | null;
  hasDocument: boolean;
}
export interface AdminClub {
  id: string;
  name: string;
  city: string | null;
  purpose: string | null;
  createdByFirstName: string | null;
  activityCount: number;
}
export interface AdminCategoryRequest {
  id: string;
  requestedName: string;
  requesterFirstName: string | null;
}
export interface AdminFeedback {
  id: string;
  type: string;
  body: string;
  status: FeedbackStatus;
  senderFirstName: string | null;
  hasScreenshot: boolean;
}
export interface CategoryOption {
  id: string;
  nameFr: string;
}
export interface AssociationHit {
  id: string;
  name: string;
  city: string | null;
}

interface PgError {
  code?: string | null;
  message?: string | null;
}

function mapError(error: PgError): AdminError {
  const message = error.message ?? '';
  if (error.code === '42501') {
    if (message.includes('already_decided')) return 'already_decided';
    // Not told apart here: not_allowed means a missing second factor or a refusal, which the screen tells apart.
    return message.includes('limit_reached') ? 'limit_reached' : 'not_allowed';
  }
  if (error.code === 'P0002') return 'not_found';
  if (error.code === '23514' || error.code === '22023') {
    for (const known of ['invalid_statement', 'invalid_target', 'invalid_category', 'invalid_word'] as const) {
      if (message.includes(known)) return known;
    }
    return 'invalid';
  }
  if (!error.code && /network|fetch/i.test(message)) return 'network';
  return 'unknown';
}

async function call<T extends object>(
  fn: () => PromiseLike<{ data?: unknown; error: PgError | null }>,
  onData: (data: any) => T,
): Promise<AdminResult<T>> {
  try {
    const { data, error } = await fn();
    if (error) return { ok: false, error: mapError(error) };
    return { ok: true, ...onData(data) };
  } catch {
    return { ok: false, error: 'network' };
  }
}

const none = () => ({});
const rpc = (name: string, args: Record<string, unknown> = {}) => (supabase.rpc as any)(name, args);
const arr = (d: unknown): any[] => (Array.isArray(d) ? d : []);

export function listReports() {
  return call(
    () => rpc('admin_reports', { p_status: 'open', p_limit: 50 }),
    (d: any) => ({
      openCount: (d?.open_count ?? 0) as number,
      items: arr(d?.items).map(
        (r): AdminReport => ({
          id: r.id,
          createdAt: r.created_at,
          source: r.source,
          targetType: r.target_type,
          reason: r.reason,
          details: r.details ?? null,
          preview: r.preview ?? null,
          ownerFirstName: r.target_owner?.first_name ?? null,
          reporterFirstName: r.reporter_first_name ?? null,
        }),
      ),
    }),
  );
}

export function decideReport(id: string, decision: ReportDecision, statement: string) {
  return call(() => rpc('admin_decide_report', { p_report: id, p_decision: decision, p_statement: statement.trim() }), none);
}

export function listClaims() {
  return call(
    () => rpc('admin_claims', { p_status: 'pending', p_limit: 50 }),
    (d) => ({
      items: arr(d).map(
        (c): AdminClaim => ({
          id: c.id,
          associationName: c.association?.name ?? '',
          city: c.association?.city ?? null,
          claimantFirstName: c.claimant_first_name ?? null,
          role: c.role,
          contactEmail: c.contact_email ?? null,
          hasDocument: !!c.has_document,
        }),
      ),
    }),
  );
}

export function decideClaim(id: string, approve: boolean, note?: string) {
  return call(() => rpc('admin_decide_claim', { p_claim: id, p_approve: approve, p_note: note?.trim() || null }), none);
}

/** The path comes from an audited RPC; the link is signed by the client and lives 5 minutes. */
async function signedUrl(bucket: string, pathRpc: string, args: Record<string, unknown>): Promise<AdminResult<{ url: string }>> {
  const path = await call(() => rpc(pathRpc, args), (d) => ({ path: d as string }));
  if (!path.ok) return path;
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path.path, 300);
    if (error || !data?.signedUrl) return { ok: false, error: 'unknown' };
    return { ok: true, url: data.signedUrl };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export const claimDocumentUrl = (id: string) => signedUrl('claim-documents', 'admin_claim_document_path', { p_claim: id });
export const feedbackScreenshotUrl = (id: string) =>
  signedUrl('feedback-screenshots', 'admin_feedback_screenshot_path', { p_id: id });

export function listClubs() {
  return call(
    () => rpc('admin_community_clubs', { p_limit: 50 }),
    (d) => ({
      items: arr(d).map(
        (c): AdminClub => ({
          id: c.id,
          name: c.name,
          city: c.city ?? null,
          purpose: c.purpose ?? null,
          createdByFirstName: c.created_by_first_name ?? null,
          activityCount: c.activity_count ?? 0,
        }),
      ),
    }),
  );
}

export function decideClub(id: string, action: 'approve' | 'merge' | 'reject', opts: { into?: string; note?: string } = {}) {
  return call(
    () => rpc('admin_decide_club', { p_id: id, p_action: action, p_into: opts.into ?? null, p_note: opts.note?.trim() || null }),
    none,
  );
}

export async function searchAssociations(q: string): Promise<AdminResult<{ items: AssociationHit[] }>> {
  const text = q.trim().replace(/[%_,()]/g, ' ');
  if (text.length < 2) return { ok: true, items: [] };
  return call(
    () => supabase.from('associations').select('id, name, city').is('removed_at', null).ilike('name', `%${text}%`).limit(8),
    (d) => ({ items: arr(d).map((a): AssociationHit => ({ id: a.id, name: a.name, city: a.city ?? null })) }),
  );
}

export function listCategoryRequests() {
  return call(
    () => rpc('admin_category_requests', { p_limit: 50 }),
    (d) => ({
      items: arr(d).map(
        (r): AdminCategoryRequest => ({
          id: r.id,
          requestedName: r.requested_name,
          requesterFirstName: r.requester_first_name ?? null,
        }),
      ),
    }),
  );
}

export function decideCategory(
  id: string,
  action: 'approve' | 'merge' | 'reject',
  opts: { parent?: string; nameEn?: string; into?: string; note?: string } = {},
) {
  return call(
    () =>
      rpc('admin_decide_category', {
        p_id: id,
        p_action: action,
        p_parent: opts.parent ?? null,
        p_name_en: opts.nameEn?.trim() || null,
        p_into: opts.into ?? null,
        p_note: opts.note?.trim() || null,
      }),
    none,
  );
}

/** Root categories (parent picker) and every category (merge target). */
export function listCategories() {
  return call(
    () => supabase.from('categories').select('id, parent_id, name_fr').order('sort_order', { ascending: true }),
    (d) => ({
      roots: arr(d).filter((c) => c.parent_id === null).map((c): CategoryOption => ({ id: c.id, nameFr: c.name_fr })),
      all: arr(d).map((c): CategoryOption => ({ id: c.id, nameFr: c.name_fr })),
    }),
  );
}

export function listFeedback() {
  return call(
    () => rpc('admin_feedback', { p_status: 'new', p_limit: 50 }),
    (d) => ({
      items: arr(d).map(
        (f): AdminFeedback => ({
          id: f.id,
          type: f.type,
          body: f.body,
          status: f.status,
          senderFirstName: f.sender_first_name ?? null,
          hasScreenshot: !!f.screenshot_path,
        }),
      ),
    }),
  );
}

export function setFeedbackStatus(id: string, status: FeedbackStatus) {
  return call(() => rpc('admin_set_feedback_status', { p_id: id, p_status: status }), none);
}

export function listBannedWords() {
  return call(
    () => supabase.from('banned_words').select('word').order('word', { ascending: true }).limit(500),
    (d) => ({ words: arr(d).map((w) => w.word as string) }),
  );
}

export function setBannedWord(word: string, add: boolean) {
  return call(() => rpc('admin_set_banned_word', { p_word: word, p_add: add }), none);
}
