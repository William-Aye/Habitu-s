import { assertEquals } from 'jsr:@std/assert@1.0.13';
import { createHandler } from './handler.ts';
import { normaliseQuery } from './normalise.ts';
import cases from './normalise_cases.json' with { type: 'json' };

const vec = () => Array.from({ length: 384 }, (_, i) => i / 384);

function post(body: unknown): Request {
  return new Request('http://x/embed-query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

Deno.test('embeds normalised text, then serves from cache', async () => {
  const calls: string[] = [];
  const store = new Map<string, number[]>();
  const handler = createHandler({
    embed: (t) => {
      calls.push(t);
      return Promise.resolve(vec());
    },
    cacheGet: (_m, q) => Promise.resolve(store.get(q) ?? null),
    cachePut: (_m, q, v) => {
      store.set(q, v);
      return Promise.resolve();
    },
  });
  const r1 = await handler(post({ text: '  Jeu  de GO ' }));
  const b1 = await r1.json();
  assertEquals(r1.status, 200);
  assertEquals(calls, ['jeu de go']);
  assertEquals(b1.embedding.length, 384);
  assertEquals(b1.cached, false);
  assertEquals(b1.model, 'multilingual-e5-small-q8-v1');
  const r2 = await handler(post({ text: 'jeu de go' }));
  const b2 = await r2.json();
  assertEquals(calls.length, 1);
  assertEquals(b2.cached, true);
  assertEquals(b2.embedding.length, 384);
});

Deno.test('rejects empty and over-long text', async () => {
  const handler = createHandler({
    embed: () => Promise.resolve(vec()),
    cacheGet: () => Promise.resolve(null),
    cachePut: () => Promise.resolve(),
  });
  for (const text of ['', '   ', 'a'.repeat(201)]) {
    const r = await handler(post({ text }));
    assertEquals(r.status, 400);
    assertEquals((await r.json()).error, 'invalid_text');
  }
});

Deno.test('rejects non-POST with 405', async () => {
  const handler = createHandler({
    embed: () => Promise.resolve(vec()),
    cacheGet: () => Promise.resolve(null),
    cachePut: () => Promise.resolve(),
  });
  const r = await handler(new Request('http://x/embed-query', { method: 'GET' }));
  assertEquals(r.status, 405);
});

Deno.test('cachePut failure still returns 200', async () => {
  const handler = createHandler({
    embed: () => Promise.resolve(vec()),
    cacheGet: () => Promise.resolve(null),
    cachePut: () => Promise.reject(new Error('db down')),
  });
  const r = await handler(post({ text: 'escalade' }));
  assertEquals(r.status, 200);
  assertEquals((await r.json()).cached, false);
});

Deno.test('embed rejection returns 502 embed_failed', async () => {
  const handler = createHandler({
    embed: () => Promise.reject(new Error('oom')),
    cacheGet: () => Promise.resolve(null),
    cachePut: () => Promise.resolve(),
  });
  const r = await handler(post({ text: 'judo' }));
  assertEquals(r.status, 502);
  assertEquals((await r.json()).error, 'embed_failed');
});

Deno.test('invalid cache hit falls through to embed', async () => {
  let embedded = 0;
  const handler = createHandler({
    embed: () => {
      embedded++;
      return Promise.resolve(vec());
    },
    cacheGet: () => Promise.resolve([1, 2, 3]),
    cachePut: () => Promise.resolve(),
  });
  const r = await handler(post({ text: 'judo' }));
  assertEquals(r.status, 200);
  assertEquals(embedded, 1);
  assertEquals((await r.json()).cached, false);
});

Deno.test('invalid model output returns 500 embed_failed', async () => {
  for (const bad of [[1, 2], Array(384).fill(NaN)]) {
    const handler = createHandler({
      embed: () => Promise.resolve(bad as number[]),
      cacheGet: () => Promise.resolve(null),
      cachePut: () => Promise.resolve(),
    });
    const r = await handler(post({ text: 'judo' }));
    assertEquals(r.status, 500);
    assertEquals((await r.json()).error, 'embed_failed');
  }
});

Deno.test('length limit counts code points', async () => {
  const handler = createHandler({
    embed: () => Promise.resolve(vec()),
    cacheGet: () => Promise.resolve(null),
    cachePut: () => Promise.resolve(),
  });
  assertEquals((await handler(post({ text: '\u{1F600}'.repeat(200) }))).status, 200);
  assertEquals((await handler(post({ text: '\u{1F600}'.repeat(201) }))).status, 400);
});

Deno.test('normaliseQuery matches shared cases', () => {
  for (const c of cases) assertEquals(normaliseQuery(c.input), c.expected);
});
