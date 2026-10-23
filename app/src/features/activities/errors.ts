import { supabase } from '../../lib/supabase';
import type { ApiError, ApiResult } from './types';

interface PgError {
  code?: string | null;
  message?: string | null;
}

export function mapError(error: PgError): ApiError {
  const message = error.message ?? '';
  if (error.code === '42501') {
    if (message.includes('limit_reached')) return 'limit_reached';
    // The guard on activities.organised_by_association_id (the association was verified meanwhile).
    return message.includes('association not linkable') ? 'association_unavailable' : 'not_allowed';
  }
  if (error.code === '22023' && message.includes('invalid_website')) return 'invalid_website';
  // Unique violation: rejoining after removal, or a double tap.
  if (error.code === '23505') return 'not_allowed';
  if (message.includes('session_full')) return 'session_full';
  if (!error.code && /network|fetch/i.test(message)) return 'network';
  return 'unknown';
}

type CallResult = { data?: unknown; error: PgError | null };

/** Runs a call; a thrown exception is a failed fetch (network), a returned error is mapped. */
export async function run<T extends object>(
  call: () => PromiseLike<CallResult>,
  onData: (data: any) => T,
  opts: { expectRows?: boolean } = {},
): Promise<ApiResult<T>> {
  try {
    const { data, error } = await call();
    if (error) return { ok: false, error: mapError(error) };
    // RLS silently filters out rows it forbids: no affected row means not allowed.
    if (opts.expectRows && (!Array.isArray(data) || data.length === 0)) {
      return { ok: false, error: 'not_allowed' };
    }
    return { ok: true, ...onData(data) };
  } catch {
    return { ok: false, error: 'network' };
  }
}

const NOT_SIGNED_IN: CallResult = { data: null, error: { code: '42501', message: 'not authenticated' } };

/** Like `run`, for calls that act as the signed-in user. */
export function runAsUser<T extends object>(
  call: (userId: string) => PromiseLike<CallResult>,
  onData: (data: any) => T,
  opts?: { expectRows?: boolean },
): Promise<ApiResult<T>> {
  return run(async () => {
    const { data } = await supabase.auth.getSession();
    const userId = data?.session?.user?.id;
    return userId ? call(userId) : NOT_SIGNED_IN;
  }, onData, opts);
}

export function toPoint(lon: number, lat: number): string {
  return `SRID=4326;POINT(${lon} ${lat})`;
}
