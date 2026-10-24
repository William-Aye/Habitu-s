import { supabase } from '../../lib/supabase';
import { authed } from './authed';
import type { SafetyResult } from './types';

/** The tips I have already dismissed (own rows only, by RLS). */
export function listSeenTips(): Promise<SafetyResult<{ tips: string[] }>> {
  return authed(
    (me) => supabase.from('safety_tips_seen').select('tip_id').eq('user_id', me),
    (data) => ({ tips: ((data ?? []) as { tip_id: string }[]).map((r) => r.tip_id) }),
  );
}

export function markTipsSeen(ids: string[]): Promise<SafetyResult> {
  if (ids.length === 0) return Promise.resolve({ ok: true });
  return authed((me) =>
    supabase
      .from('safety_tips_seen')
      .upsert(ids.map((tip_id) => ({ user_id: me, tip_id })), { onConflict: 'user_id,tip_id', ignoreDuplicates: true }),
  );
}
