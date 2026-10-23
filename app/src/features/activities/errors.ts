import { supabase } from '../../lib/supabase';
import type { ApiError, ApiResult } from './types';

interface PgError {
  code?: string | null;
  message?: string | null;
}

export function mapError(error: PgError): ApiError {
  const message = error.message ?? '';
  if (error.code === '42501') return message.includes('limit_reached') ? 'limit_reached' : 'not_allowed';
  if (message.includes('session_full')) return 'session_full';
  if (!error.code && /network|fetch/i.test(message)) return 'network';
  return 'unknown';
}

type CallResult = { data?: unknown; error: PgError | null };

/** Runs a call; a thrown exception is a failed fetch (network), a returned error is mapped. */
export async function run<T extends object>(
  call: () => PromiseLike<CallResult>,
  onData: (data: any) => T,
): Promise<ApiResult<T>> {
  try {
    const { data, error } = await call();
    if (error) return { ok: false, error: mapError(error) };
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
): Promise<ApiResult<T>> {
  return run(async () => {
    const { data } = await supabase.auth.getSession();
    const userId = data?.session?.user?.id;
    return userId ? call(userId) : NOT_SIGNED_IN;
  }, onData);
}

export function toPoint(lon: number, lat: number): string {
  return `SRID=4326;POINT(${lon} ${lat})`;
}
