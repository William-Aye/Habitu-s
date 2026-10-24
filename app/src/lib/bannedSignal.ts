/**
 * The auth server answers 400 or 403 `user_banned` to a sign-in or a token refresh, but the SDK swallows it on a
 * refresh (it just removes the session). This module sees the answer at the fetch level and remembers it
 * until a session works again.
 */
let banned = false;
const listeners = new Set<() => void>();

export function isBannedSignal(): boolean {
  return banned;
}

export function setBannedSignal(value: boolean): void {
  if (banned === value) return;
  banned = value;
  listeners.forEach((l) => l());
}

export function subscribeBannedSignal(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const AUTH_PATHS = ['/auth/v1/token', '/auth/v1/user'];

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    const o = input as { url?: unknown; href?: unknown };
    if (typeof o.url === 'string') return o.url;
    if (typeof o.href === 'string') return o.href;
  }
  return '';
}

/** A fetch that flags a banned account. The body is read from a clone, so the SDK still gets its own. */
export const bannedAwareFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  try {
    if ((res.status === 400 || res.status === 403) && AUTH_PATHS.some((p) => urlOf(input).includes(p))) {
      const body = (await res.clone().json()) as { error_code?: unknown; code?: unknown };
      if (body?.error_code === 'user_banned' || body?.code === 'user_banned') setBannedSignal(true);
    }
  } catch {
    // An unreadable body is not a ban answer.
  }
  return res;
};
