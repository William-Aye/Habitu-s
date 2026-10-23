export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Abuse cap: anonymous submissions accepted per rolling hour, all senders together. */
export const ANONYMOUS_HOURLY_CAP = 20;
export const MAX_BODY_CHARS = 5000;

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
  /** Anonymous feedback rows created at or after `since`. */
  countAnonymousSince(since: Date): Promise<number>;
  insertFeedback(row: FeedbackRow): Promise<void>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const TYPES = ['idea', 'problem', 'other'] as const;

function optionalText(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || v.length > max) return undefined;
  const t = v.trim();
  return t === '' ? null : t;
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    let input: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      input = parsed as Record<string, unknown>;
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }

    const type = TYPES.find((t) => t === input.type);
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    const appVersion = optionalText(input.app_version, 50);
    const deviceModel = optionalText(input.device_model, 100);
    const token = input.turnstile_token;
    if (!type || body.length < 1 || body.length > MAX_BODY_CHARS || appVersion === undefined
      || deviceModel === undefined || typeof token !== 'string' || token === '' || token.length > 4096) {
      return json({ error: 'invalid_body' }, 400);
    }

    let verified: boolean;
    try {
      const res = await deps.fetch(SITEVERIFY_URL, {
        method: 'POST',
        body: new URLSearchParams({ secret: deps.turnstileSecret, response: token }),
        signal: AbortSignal.timeout(10_000),
      });
      verified = res.ok && (await res.json())?.success === true;
    } catch (e) {
      console.error('turnstile verification failed', e);
      return json({ error: 'verification_unavailable' }, 502);
    }
    if (!verified) return json({ error: 'turnstile_failed' }, 403);

    try {
      const since = new Date(deps.now().getTime() - 60 * 60 * 1000);
      if ((await deps.countAnonymousSince(since)) >= ANONYMOUS_HOURLY_CAP) return json({ error: 'rate_limited' }, 429);
      await deps.insertFeedback({
        type, body, app_version: appVersion, device_model: deviceModel, source: 'anonymous', user_id: null,
      });
    } catch (e) {
      console.error('feedback insert failed', e);
      return json({ error: 'insert_failed' }, 500);
    }
    return json({ ok: true });
  };
}
