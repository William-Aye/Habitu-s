export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/**
 * Circuit breaker: anonymous submissions accepted per rolling hour, all senders together. High on purpose:
 * the per-client limit below is what stops one person, so this only protects the table from a flood.
 * The count and the insert are separate steps, so a burst can overshoot it slightly; that is acceptable here.
 */
export const ANONYMOUS_HOURLY_CAP = 200;
/** Attempts (valid-looking requests that reach Turnstile) per client and rolling hour (FN-2). */
export const CLIENT_HOURLY_CAP = 10;
/** Distinct clients remembered at once; the oldest are dropped first. Bounds memory. */
const MAX_CLIENTS = 10_000;
const HOUR_MS = 60 * 60 * 1000;
export const MAX_BODY_CHARS = 5000;
/** A request body above this is refused before it is read (FN-4). The largest valid body is about 5 KB of text. */
export const MAX_BODY_BYTES = 16 * 1024;

export interface FeedbackRow {
  type: 'idea' | 'problem' | 'other';
  body: string;
  app_version: string | null;
  device_model: string | null;
  source: 'anonymous';
  user_id: null;
}

export interface Deps {
  /** Cloudflare Turnstile secret key (env TURNSTILE_SECRET). */
  turnstileSecret: string;
  now(): Date;
  fetch(input: string, init?: RequestInit): Promise<Response>;
  /**
   * Hostnames a Turnstile token may have been solved on (env TURNSTILE_HOSTNAMES, comma-separated: the site's
   * host, and challenges.cloudflare.com for the app's WebView). Empty: the hostname is not checked.
   */
  turnstileHostnames?: string[];
  /** Origins allowed to call from a browser (env ALLOWED_ORIGINS: the site's origin). Empty: none. */
  allowedOrigins?: string[];
  /** Anonymous feedback rows created at or after `since`. */
  countAnonymousSince(since: Date): Promise<number>;
  insertFeedback(row: FeedbackRow): Promise<void>;
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });
}

const CORS_HEADERS = 'authorization, apikey, content-type, x-client-info';

/**
 * Per-client sliding-window limiter without stored addresses (FN-2). The key is an HMAC of the address under a
 * random key that exists only in this isolate's memory, and entries are dropped after one hour, so nothing
 * recoverable is kept and nothing is written to the database.
 */
function createClientLimiter(now: () => Date) {
  const hits = new Map<string, number[]>();
  let key: Promise<CryptoKey> | undefined;
  const hmacKey = () =>
    key ??= crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) as Promise<CryptoKey>;
  return {
    /** Records an attempt and returns false when this client is over its cap. */
    async allow(ip: string): Promise<boolean> {
      const mac = await crypto.subtle.sign('HMAC', await hmacKey(), new TextEncoder().encode(ip));
      const id = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
      const t = now().getTime();
      // Every entry is re-inserted on each call, so the Map is ordered by last use: sweep expired clients
      // (newest hit older than the window) from the front, whether or not they ever come back.
      for (const [k, v] of hits) {
        if (t - v[v.length - 1] < HOUR_MS) break;
        hits.delete(k);
      }
      const recent = (hits.get(id) ?? []).filter((x) => t - x < HOUR_MS);
      hits.delete(id); // re-insert last, so the Map stays ordered oldest first
      if (recent.length >= CLIENT_HOURLY_CAP) {
        hits.set(id, recent);
        return false;
      }
      recent.push(t);
      hits.set(id, recent);
      while (hits.size > MAX_CLIENTS) hits.delete(hits.keys().next().value as string);
      return true;
    },
    /** Clients currently remembered (for tests). */
    size: () => hits.size,
  };
}

/** Reads the body as text, refusing more than `max` bytes without buffering the rest. null: too large. */
async function readLimited(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

const TYPES = ['idea', 'problem', 'other'] as const;

function optionalText(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || v.length > max) return undefined;
  const t = v.trim();
  return t === '' ? null : t;
}

/** The app's Turnstile widget must be rendered with action 'feedback'. */
export const TURNSTILE_ACTION = 'feedback';

export function createHandler(deps: Deps): ((req: Request) => Promise<Response>) & { trackedClients(): number } {
  const limiter = createClientLimiter(() => deps.now());
  const origins = (deps.allowedOrigins ?? []).map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  const hostnames = (deps.turnstileHostnames ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
  const handle = async (req: Request): Promise<Response> => {
    // CORS (FN-7): the web build calls this function from the site's origin, and only from there.
    const origin = req.headers.get('origin');
    const allowed = origin !== null && origins.includes(origin);
    const cors: Record<string, string> = allowed
      ? { 'access-control-allow-origin': origin, vary: 'Origin' }
      : origin !== null ? { vary: 'Origin' } : {};
    const reply = (body: unknown, status = 200) => json(body, status, cors);

    if (req.method === 'OPTIONS') {
      if (!allowed) return new Response(null, { status: 403, headers: cors });
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers': CORS_HEADERS,
          'access-control-max-age': '600',
        },
      });
    }
    if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    // A browser request from another origin is refused outright; the native app sends no Origin header.
    if (origin !== null && !allowed) return reply({ error: 'origin_not_allowed' }, 403);

    if (!deps.turnstileSecret) {
      console.error('TURNSTILE_SECRET is not set');
      return reply({ error: 'server_misconfigured' }, 500);
    }

    // Type and size are checked before anything is parsed (FN-4). Requiring JSON also forces a CORS preflight.
    if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      return reply({ error: 'unsupported_media_type' }, 415);
    }
    const raw = await readLimited(req, MAX_BODY_BYTES);
    if (raw === null) return reply({ error: 'payload_too_large' }, 413);

    let input: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      input = parsed as Record<string, unknown>;
    } catch {
      return reply({ error: 'invalid_body' }, 400);
    }

    const type = TYPES.find((t) => t === input.type);
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    const appVersion = optionalText(input.app_version, 50);
    const deviceModel = optionalText(input.device_model, 100);
    const token = input.turnstile_token;
    if ([body, appVersion, deviceModel].some((t) => typeof t === 'string' && t.includes('\u0000'))) {
      return reply({ error: 'invalid_body' }, 400);
    }
    if (!type || body.length < 1 || body.length > MAX_BODY_CHARS || appVersion === undefined
      || deviceModel === undefined || typeof token !== 'string' || token === '' || token.length > 4096) {
      return reply({ error: 'invalid_body' }, 400);
    }

    // The sender's address goes to Turnstile only; it is never stored.
    const ip = req.headers.get('cf-connecting-ip')?.trim()
      || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '';
    // Per client, before the Turnstile call: the address is hashed in memory only (FN-2).
    // Requests with no address header share one bucket instead of skipping the limit.
    if (!(await limiter.allow(ip || 'unknown'))) return reply({ error: 'rate_limited' }, 429);
    const form = new URLSearchParams({ secret: deps.turnstileSecret, response: token });
    if (ip) form.set('remoteip', ip);

    let verified: boolean;
    try {
      const res = await deps.fetch(SITEVERIFY_URL, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
      const result = res.ok ? await res.json() : null;
      // Cloudflare echoes the widget's action and the host it ran on: refuse a token minted for another form or site.
      verified = result?.success === true && result.action === TURNSTILE_ACTION
        && (hostnames.length === 0
          || (typeof result.hostname === 'string' && hostnames.includes(result.hostname.toLowerCase())));
    } catch (e) {
      console.error('turnstile verification failed', e);
      return reply({ error: 'verification_unavailable' }, 502);
    }
    if (!verified) return reply({ error: 'turnstile_failed' }, 403);

    try {
      const since = new Date(deps.now().getTime() - HOUR_MS);
      if ((await deps.countAnonymousSince(since)) >= ANONYMOUS_HOURLY_CAP) return reply({ error: 'rate_limited' }, 429);
      await deps.insertFeedback({
        type, body, app_version: appVersion, device_model: deviceModel, source: 'anonymous', user_id: null,
      });
    } catch (e) {
      console.error('feedback insert failed', e);
      return reply({ error: 'insert_failed' }, 500);
    }
    return reply({ ok: true });
  };
  return Object.assign(handle, { trackedClients: () => limiter.size() });
}
