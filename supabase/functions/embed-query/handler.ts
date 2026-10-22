import { codePointLength, MAX_QUERY_CHARS, normaliseQuery } from './normalise.ts';

export const MODEL_ID = 'multilingual-e5-small-q8-v1';

const DIM = 384;

function isValidVector(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === DIM && v.every((x) => typeof x === 'number' && Number.isFinite(x));
}

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
    if (typeof text !== 'string' || codePointLength(text) > MAX_QUERY_CHARS) {
      return json({ error: 'invalid_text' }, 400);
    }
    const q = normaliseQuery(text);
    if (q === '') return json({ error: 'invalid_text' }, 400);

    const hit = await deps.cacheGet(MODEL_ID, q).catch((e) => {
      console.error('cache read failed', e);
      return null;
    });
    if (isValidVector(hit)) return json({ embedding: hit, model: MODEL_ID, cached: true });

    let embedding: number[];
    try {
      embedding = await deps.embed(q);
    } catch (e) {
      console.error('embed failed', e);
      return json({ error: 'embed_failed' }, 502);
    }
    if (!isValidVector(embedding)) {
      console.error('embed returned an invalid vector');
      return json({ error: 'embed_failed' }, 500);
    }
    try {
      await deps.cachePut(MODEL_ID, q, embedding);
    } catch (e) {
      console.error('cache write failed', e);
    }
    return json({ embedding, model: MODEL_ID, cached: false });
  };
}
