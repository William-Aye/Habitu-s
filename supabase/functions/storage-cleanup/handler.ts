import { bearerMatches } from '../_shared/bearer.ts';
export const BATCH_SIZE = 100;
export const FETCH_LIMIT = 1000;

export interface QueueRow {
  id: number;
  bucket: string;
  path: string;
}

export interface Deps {
  /** The service-role key; only callers presenting it as a bearer token are served. */
  serviceKey: string;
  /** Oldest queued deletions first. */
  fetchQueue(limit: number): Promise<QueueRow[]>;
  /** Removes the files through the Storage API (object and backing file); throws on failure. */
  remove(bucket: string, paths: string[]): Promise<void>;
  /** Drops queue rows once their files are gone. */
  clear(ids: number[]): Promise<void>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!(await bearerMatches(req.headers.get('authorization'), deps.serviceKey))) {
      return json({ error: 'unauthorized' }, 401);
    }

    let queue: QueueRow[];
    try {
      queue = await deps.fetchQueue(FETCH_LIMIT);
    } catch (e) {
      console.error('fetch queue failed', e);
      return json({ error: 'fetch_failed' }, 500);
    }

    const byBucket = new Map<string, QueueRow[]>();
    for (const r of queue) byBucket.set(r.bucket, [...(byBucket.get(r.bucket) ?? []), r]);

    let removed = 0;
    let failed = 0;
    let clearFailed = false;
    for (const [bucket, items] of byBucket) {
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        try {
          await deps.remove(bucket, batch.map((r) => r.path));
        } catch (e) {
          // Left in the queue; the next run retries.
          console.error('storage remove failed', bucket, e);
          failed += batch.length;
          continue;
        }
        try {
          await deps.clear(batch.map((r) => r.id));
          removed += batch.length;
        } catch (e) {
          // Removing a missing file is harmless, so the retry is safe.
          console.error('clear queue failed', e);
          failed += batch.length;
          clearFailed = true;
        }
      }
    }
    if (clearFailed) return json({ error: 'clear_failed', processed: queue.length, removed, failed }, 500);
    return json({ processed: queue.length, removed, failed });
  };
}
