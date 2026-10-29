export const BATCH_SIZE = 100;
export const MAX_ATTEMPTS = 5;
export const RETRY_STEP_MS = 5 * 60 * 1000;

/** The shape of an Expo push token; anything else is dropped without being sent (FN-1). */
export const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$/;

/** Expo answered the whole request with an HTTP error (thrown by expoSend). */
export class ExpoRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** A 4xx (other than rate limiting) is about the content of the batch, so a smaller batch can pass. */
const isBatchRejection = (e: unknown) =>
  e instanceof ExpoRequestError && e.status >= 400 && e.status < 500 && e.status !== 429;

export interface OutboxRow {
  id: number;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  attempts: number;
  tokens: string[];
}

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  categoryId?: string;
}

export interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

export interface RetryPlan {
  attempts: number;
  failed: boolean;
  sendAfter: Date | null;
}

export interface Deps {
  /** The service-role key; only callers presenting it as a bearer token are served. */
  serviceKey: string;
  now(): Date;
  /** Takes up to `limit` due rows (with each recipient's tokens). */
  fetchOutbox(limit: number): Promise<OutboxRow[]>;
  markSent(ids: number[]): Promise<void>;
  markRetry(id: number, err: string, next: RetryPlan): Promise<void>;
  dropToken(token: string): Promise<void>;
  /** Posts one batch (at most 100) to Expo; tickets come back in the same order. */
  expoSend(messages: ExpoMessage[]): Promise<ExpoTicket[]>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!deps.serviceKey || req.headers.get('authorization') !== `Bearer ${deps.serviceKey}`) {
      return json({ error: 'unauthorized' }, 401);
    }

    let rows: OutboxRow[];
    try {
      rows = await deps.fetchOutbox(100);
    } catch (e) {
      console.error('fetch outbox failed', e);
      return json({ error: 'fetch_failed' }, 500);
    }

    // Flatten to one message per well-formed token, remembering which row it belongs to. Malformed
    // tokens are dropped: they can only fail, and could fail a whole batch with them.
    const messages: { rowIdx: number; msg: ExpoMessage }[] = [];
    const noToken: number[] = [];
    const dead: string[] = [];
    const valid = rows.map((r) => r.tokens.filter((t) => EXPO_TOKEN.test(t)));
    rows.forEach((r, rowIdx) => {
      for (const t of r.tokens) if (!EXPO_TOKEN.test(t)) dead.push(t);
      if (valid[rowIdx].length === 0) noToken.push(r.id);
      for (const to of valid[rowIdx]) {
        messages.push({
          rowIdx,
          msg: {
            to,
            title: r.title,
            body: r.body,
            data: r.data,
            ...(r.kind === 'session_reminder' ? { categoryId: 'session_reminder' } : {}),
          },
        });
      }
    });

    // One ticket per message. A batch Expo rejects as a whole (4xx: a bad message, or tokens of
    // several Expo projects) is split in two and retried, so one bad message cannot fail the others.
    // Any other failure gives every message of the batch an error ticket.
    const send = async (batch: ExpoMessage[]): Promise<ExpoTicket[]> => {
      try {
        const res = await deps.expoSend(batch);
        if (!Array.isArray(res) || res.length !== batch.length) throw new Error('unexpected Expo response');
        return res;
      } catch (e) {
        if (batch.length > 1 && isBatchRejection(e)) {
          const mid = Math.ceil(batch.length / 2);
          return [...(await send(batch.slice(0, mid))), ...(await send(batch.slice(mid)))];
        }
        console.error('expo send failed', errText(e));
        const message = errText(e);
        return batch.map(() => ({ status: 'error' as const, message }));
      }
    };
    const tickets: ExpoTicket[] = [];
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      tickets.push(...(await send(messages.slice(i, i + BATCH_SIZE).map((m) => m.msg))));
    }

    const toSend = [...noToken];
    const perRow = rows.map(() => ({ ok: 0, dead: 0, other: [] as string[] }));
    messages.forEach((m, i) => {
      const t = tickets[i];
      const slot = perRow[m.rowIdx];
      if (t.status === 'ok') slot.ok++;
      else if (t.details?.error === 'DeviceNotRegistered') {
        slot.dead++;
        dead.push(m.msg.to);
      } else slot.other.push(t.details?.error ?? t.message ?? 'unknown_error');
    });

    const now = deps.now();
    let retried = 0;
    for (const [idx, r] of rows.entries()) {
      const s = perRow[idx];
      if (valid[idx].length === 0) continue;
      // Delivered somewhere, or every token is dead: nothing more to do for this row.
      if (s.ok > 0 || s.other.length === 0) {
        toSend.push(r.id);
        continue;
      }
      const attempts = r.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      try {
        await deps.markRetry(r.id, s.other[0], {
          attempts,
          failed,
          sendAfter: failed ? null : new Date(now.getTime() + RETRY_STEP_MS * attempts),
        });
        retried++;
      } catch (e) {
        console.error('markRetry failed', e);
      }
    }

    for (const token of new Set(dead)) {
      try {
        await deps.dropToken(token);
      } catch (e) {
        console.error('dropToken failed', e);
      }
    }
    if (toSend.length > 0) {
      try {
        await deps.markSent(toSend);
      } catch (e) {
        console.error('markSent failed', e);
        return json({ error: 'mark_failed' }, 500);
      }
    }
    return json({ processed: rows.length, sent: toSend.length, retried });
  };
}
