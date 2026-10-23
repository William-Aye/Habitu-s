export const BATCH_SIZE = 100;
export const MAX_ATTEMPTS = 5;
export const RETRY_STEP_MS = 5 * 60 * 1000;

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

    // Flatten to one message per token, remembering which row it belongs to.
    const messages: { rowIdx: number; msg: ExpoMessage }[] = [];
    const noToken: number[] = [];
    rows.forEach((r, rowIdx) => {
      if (r.tokens.length === 0) noToken.push(r.id);
      for (const to of r.tokens) {
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

    // One ticket per message; a failed request gives every message of its batch an error ticket.
    const tickets: ExpoTicket[] = [];
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      try {
        const res = await deps.expoSend(batch.map((m) => m.msg));
        if (!Array.isArray(res) || res.length !== batch.length) throw new Error('unexpected Expo response');
        tickets.push(...res);
      } catch (e) {
        console.error('expo send failed', e);
        const message = errText(e);
        for (let k = 0; k < batch.length; k++) tickets.push({ status: 'error', message });
      }
    }

    const toSend = [...noToken];
    const dead: string[] = [];
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
      if (r.tokens.length === 0) continue;
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
