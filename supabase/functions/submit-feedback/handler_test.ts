import { assertEquals } from 'jsr:@std/assert@1.0.13';
import { createHandler, type FeedbackRow } from './handler.ts';

interface Log {
  inserted: FeedbackRow[];
  siteverify: { url: string; body: string }[];
  countSince: Date[];
}

function setup(opts: { turnstileOk?: boolean; recent?: number; fetchFails?: boolean } = {}) {
  const log: Log = { inserted: [], siteverify: [], countSince: [] };
  const now = new Date('2026-10-24T10:00:00Z');
  const handler = createHandler({
    turnstileSecret: 'ts-secret',
    now: () => now,
    fetch: (input, init) => {
      log.siteverify.push({ url: String(input), body: String(init?.body) });
      if (opts.fetchFails) return Promise.reject(new Error('network'));
      return Promise.resolve(new Response(JSON.stringify({ success: opts.turnstileOk ?? true }), { status: 200 }));
    },
    countAnonymousSince: (since) => {
      log.countSince.push(since);
      return Promise.resolve(opts.recent ?? 0);
    },
    insertFeedback: (row) => {
      log.inserted.push(row);
      return Promise.resolve();
    },
  });
  return { handler, log };
}

const valid = { type: 'idea', body: 'Une idee', app_version: '1.2.3', device_model: 'Pixel', turnstile_token: 'tok' };
const post = (body: unknown, method = 'POST') =>
  new Request('http://x/submit-feedback', {
    method,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

Deno.test('a failed Turnstile check returns 403 and inserts nothing', async () => {
  const { handler, log } = setup({ turnstileOk: false });
  const res = await handler(post(valid));
  assertEquals(res.status, 403);
  assertEquals(log.inserted, []);
});

Deno.test('a valid request inserts once as anonymous and verifies with the secret', async () => {
  const { handler, log } = setup();
  const res = await handler(post(valid));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(log.inserted, [{ type: 'idea', body: 'Une idee', app_version: '1.2.3', device_model: 'Pixel', source: 'anonymous', user_id: null }]);
  assertEquals(log.siteverify.length, 1);
  assertEquals(log.siteverify[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  const form = new URLSearchParams(log.siteverify[0].body);
  assertEquals(form.get('secret'), 'ts-secret');
  assertEquals(form.get('response'), 'tok');
});

Deno.test('a missing or invalid body returns 400 and never reaches Turnstile', async () => {
  for (const b of [undefined, 'not json', {}, { ...valid, type: 'nope' }, { ...valid, body: '   ' }, { ...valid, body: 'x'.repeat(5001) },
    { ...valid, turnstile_token: '' }, { ...valid, turnstile_token: undefined }, { ...valid, app_version: 12 }]) {
    const { handler, log } = setup();
    const res = await handler(post(b));
    assertEquals(res.status, 400, JSON.stringify(b));
    assertEquals(log.siteverify, []);
    assertEquals(log.inserted, []);
  }
});

Deno.test('the hourly cap returns 429 and inserts nothing', async () => {
  const { handler, log } = setup({ recent: 20 });
  const res = await handler(post(valid));
  assertEquals(res.status, 429);
  assertEquals(log.inserted, []);
  assertEquals(log.countSince[0].toISOString(), '2026-10-24T09:00:00.000Z');
});

Deno.test('just under the cap is accepted', async () => {
  const { handler, log } = setup({ recent: 19 });
  assertEquals((await handler(post(valid))).status, 200);
  assertEquals(log.inserted.length, 1);
});

Deno.test('a Turnstile outage fails closed without inserting', async () => {
  const { handler, log } = setup({ fetchFails: true });
  const res = await handler(post(valid));
  assertEquals(res.status, 502);
  assertEquals(log.inserted, []);
});

Deno.test('only POST is served', async () => {
  const { handler } = setup();
  assertEquals((await handler(post(undefined, 'GET'))).status, 405);
});
