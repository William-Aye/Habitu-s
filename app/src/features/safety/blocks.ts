import { supabase } from '../../lib/supabase';
import { authed } from './authed';
import type { SafetyResult } from './types';

export interface BlockedPerson {
  userId: string;
  firstName: string;
}

/** The one way to block someone (chat and activity pages both come here). */
export function block(userId: string): Promise<SafetyResult> {
  return authed((me) =>
    supabase
      .from('blocks')
      .upsert({ blocker_id: me, blocked_id: userId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true }),
  );
}

export function unblock(userId: string): Promise<SafetyResult> {
  return authed((me) => supabase.from('blocks').delete().eq('blocker_id', me).eq('blocked_id', userId));
}

/** Only my own blocks, with first names, from the my_blocked RPC. */
export function listBlocked(): Promise<SafetyResult<{ blocked: BlockedPerson[] }>> {
  return authed(
    () => supabase.rpc('my_blocked'),
    (data) => ({
      blocked: ((data ?? []) as any[]).map((b) => ({ userId: b.user_id as string, firstName: (b.first_name ?? '') as string })),
    }),
  );
}
