/**
 * True when Supabase Auth refused a sign-in or a session refresh because the account is banned
 * (error code `user_banned`; the message says "User is banned" on older servers).
 */
export function isBannedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown };
  return e.code === 'user_banned' || /user is banned|user_banned/i.test(String(e.message ?? ''));
}
