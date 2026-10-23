import { assertEquals } from 'jsr:@std/assert@1.0.13';
import { createHandler, type Deps, type QueueRow } from './handler.ts';

function rows(n: number, bucket = 'avatars', from = 1): QueueRow[] {
  return Array.from({ length: n }, (_, i) => ({ id: from + i, bucket, path: `u/${from + i}.jpg` }));
}

function setup(queue: QueueRow[], remove: Deps['remove'] = () => Promise.resolve()) {
  const log = { removed: [] as { bucket: string; paths: string[] }[], cleared: [] as number[][] };
  const handler = createHandler({
    serviceKey: 'secret',
    fetchQueue: () => Promise.resolve(queue),
    remove: (bucket, paths) => {
      log.removed.push({ bucket, paths });
      return remove(bucket, paths);
    },
    clear: (ids) => {
      log.cleared.push(ids);
      return Promise.resolve();
    },
  });
  return { handler, log };
}

const post = (auth: string | null = 'Bearer secret', method = 'POST') =>
  new Request('http://x/storage-cleanup', { method, headers: auth ? { authorization: auth } : {} });

Deno.test('rejects other methods and bad credentials', async () => {
  const { handler, log } = setup(rows(1));
  assertEquals((await handler(post('Bearer secret', 'GET'))).status, 405);
  assertEquals((await handler(post(null))).status, 401);
  assertEquals((await handler(post('Bearer nope'))).status, 401);
  assertEquals(log.removed.length, 0);
});

Deno.test('removes files per bucket and clears the queue rows', async () => {
  const { handler, log } = setup([...rows(2, 'avatars'), ...rows(1, 'claim-documents', 10)]);
  const res = await handler(post());
  assertEquals(res.status, 200);
  assertEquals(log.removed, [
    { bucket: 'avatars', paths: ['u/1.jpg', 'u/2.jpg'] },
    { bucket: 'claim-documents', paths: ['u/10.jpg'] },
  ]);
  assertEquals(log.cleared.flat().sort((a, b) => a - b), [1, 2, 10]);
  assertEquals(await res.json(), { processed: 3, removed: 3, failed: 0 });
});

Deno.test('works in batches of 100', async () => {
  const { handler, log } = setup(rows(250));
  await handler(post());
  assertEquals(log.removed.map((r) => r.paths.length), [100, 100, 50]);
  assertEquals(log.cleared.flat().length, 250);
});

Deno.test('a failed batch stays queued; other batches still go', async () => {
  let call = 0;
  const { handler, log } = setup(rows(150), () => (++call === 1 ? Promise.reject(new Error('boom')) : Promise.resolve()));
  const res = await handler(post());
  assertEquals(res.status, 200);
  assertEquals(log.cleared.flat().length, 50);
  assertEquals(await res.json(), { processed: 150, removed: 50, failed: 100 });
});

Deno.test('an empty queue is a no-op', async () => {
  const { handler, log } = setup([]);
  const res = await handler(post());
  assertEquals(await res.json(), { processed: 0, removed: 0, failed: 0 });
  assertEquals(log.removed.length, 0);
  assertEquals(log.cleared.length, 0);
});

Deno.test('a queue fetch failure answers 500', async () => {
  const handler = createHandler({
    serviceKey: 'secret',
    fetchQueue: () => Promise.reject(new Error('db down')),
    remove: () => Promise.resolve(),
    clear: () => Promise.resolve(),
  });
  assertEquals((await handler(post())).status, 500);
});

Deno.test('a clear failure answers 500 and reports it', async () => {
  const handler = createHandler({
    serviceKey: 'secret',
    fetchQueue: () => Promise.resolve(rows(1)),
    remove: () => Promise.resolve(),
    clear: () => Promise.reject(new Error('db down')),
  });
  assertEquals((await handler(post())).status, 500);
});
