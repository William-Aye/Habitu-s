/**
 * The project's server key. Projects on the new API keys get `SUPABASE_SECRET_KEYS`, a JSON object
 * keyed by name (`default` is the secret key shown in Settings, API Keys). Older projects and the
 * legacy path only have `SUPABASE_SERVICE_ROLE_KEY`. The Vault secret `send_push_key` must equal the
 * key returned here, since the cron jobs send it as their bearer token.
 */
export function serverKey(get: (name: string) => string | undefined = (n) => Deno.env.get(n)): string {
  const raw = get('SUPABASE_SECRET_KEYS');
  if (raw) {
    try {
      const key = (JSON.parse(raw) as Record<string, unknown>)['default'];
      if (typeof key === 'string' && key) return key;
    } catch {
      // Malformed value: fall back to the legacy variable below.
    }
  }
  return get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

/**
 * The bearer token the cron jobs must send to `send-push` and `storage-cleanup` (TM-6). With the
 * function secret `CRON_SECRET` set, only that value is accepted, so the server key no longer has to
 * sit in Vault and in the request log. A value shorter than 32 characters is refused (empty string,
 * which never matches). Without it, the server key is still accepted, as before.
 */
export function cronBearer(get: (name: string) => string | undefined = (n) => Deno.env.get(n)): string {
  const secret = get('CRON_SECRET');
  if (secret !== undefined && secret !== '') return secret.length >= 32 ? secret : '';
  return serverKey(get);
}
