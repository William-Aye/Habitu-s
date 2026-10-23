import { supabase } from '../../lib/supabase';
import { run } from '../activities/errors';
import type { SafetyError, SafetyResult } from './types';

type CallResult = { data?: unknown; error: { code?: string | null; message?: string | null } | null };

/** Runs a call as the signed-in user. With no session nothing is sent and the answer is signed_out. */
export async function authed<T extends object = Record<never, never>>(
  call: (userId: string) => PromiseLike<CallResult>,
  onData: (data: any) => T = () => ({}) as T,
): Promise<SafetyResult<T>> {
  let userId: string | undefined;
  try {
    const { data } = await supabase.auth.getSession();
    userId = data?.session?.user?.id;
  } catch {
    return { ok: false, error: 'network' };
  }
  if (!userId) return { ok: false, error: 'signed_out' };
  const r = await run(() => call(userId), onData);
  if (r.ok) return r;
  const known: string[] = ['not_allowed', 'limit_reached', 'network'];
  return { ok: false, error: (known.includes(r.error) ? r.error : 'unknown') as SafetyError };
}
