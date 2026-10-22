import { MAX_QUERY_CHARS, normaliseQuery } from './normalise.ts';

export const MODEL_ID = 'multilingual-e5-small-q8-v1';

export interface Deps {
  embed(text: string): Promise<number[]>;
  cacheGet(model: string, q: string): Promise<number[] | null>;
  cachePut(model: string, q: string, v: number[]): Promise<void>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    let text: unknown;
    try {
      text = (await req.json())?.text;
    } catch {
      return json({ error: 'invalid_text' }, 400);
    }
    if (typeof text !== 'string' || text.length > MAX_QUERY_CHARS) {
      return json({ error: 'invalid_text' }, 400);
    }
    const q = normaliseQuery(text);
    if (q === '') return json({ error: 'invalid_text' }, 400);

    const hit = await deps.cacheGet(MODEL_ID, q).catch((e) => {
      console.error('cache read failed', e);
      return null;
    });
    if (hit) return json({ embedding: hit, model: MODEL_ID, cached: true });

    const embedding = await deps.embed(q);
    try {
      await deps.cachePut(MODEL_ID, q, embedding);
    } catch (e) {
      console.error('cache write failed', e);
    }
    return json({ embedding, model: MODEL_ID, cached: false });
  };
}
