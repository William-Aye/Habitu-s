import { assertEquals } from 'jsr:@std/assert@1.0.13';
import { createHandler, type Deps, type OutboxRow } from './handler.ts';

function row(id: number, tokens: string[], attempts = 0, kind = 'new_member'): OutboxRow {
  return { id, user_id: `u${id}`, kind, title: `t${id}`, body: `b${id}`, data: { n: id }, attempts, tokens };
}

interface Log {
  sent: number[];
  retries: { id: number; err: string; attempts: number; failed: boolean; sendAfterMs: number | null }[];
  dropped: string[];
  expo: { to: string; categoryId?: string }[][];
}

function setup(rows: OutboxRow[], expo: Deps['expoSend']) {
  const log: Log = { sent: [], retries: [], dropped: [], expo: [] };
  const now = new Date('2026-10-23T10:00:00Z');
  const handler = createHandler({
    serviceKey: 'secret',
    now: () => now,
    fetchOutbox: () => Promise.resolve(rows),
    markSent: (ids) => {
      log.sent.push(...ids);
      return Promise.resolve();
    },
    markRetry: (id, err, next) => {
      log.retries.push({ id, err, attempts: next.attempts, failed: next.failed, sendAfterMs: next.sendAfter ? next.sendAfter.getTime() - now.getTime() : null });
      return Promise.resolve();
    },
    dropToken: (t) => {
      log.dropped.push(t);
      return Promise.resolve();
    },
    expoSend: (m) => {
      log.expo.push(m.map((x) => ({ to: x.to, categoryId: x.categoryId })));
      return expo(m);
    },
  });
  return { handler, log };
}

const post = (auth: string | null = 'Bearer secret') =>
  new Request('http://x/send-push', { method: 'POST', body: '{}', headers: auth ? { authorization: auth } : {} });
const ok = (n: number) => Promise.resolve(Array.from({ length: n }, () => ({ status: 'ok' as const })));

Deno.test('sends due rows and marks them sent', async () => {
  const { handler, log } = setup([row(1, ['T1', 'T2']), row(2, ['T3'], 0, 'session_reminder')], (m) => ok(m.length));
  const res = await handler(post());
  assertEquals(res.status, 200);
  assertEquals(log.sent, [1, 2]);
  assertEquals(log.expo.length, 1);
  assertEquals(log.expo[0].map((m) => m.to), ['T1', 'T2', 'T3']);
  assertEquals(log.expo[0][2].categoryId, 'session_reminder');
  assertEquals(log.expo[0][0].categoryId, undefined);
});

Deno.test('rows without any token are marked sent and not sent to Expo', async () => {
  const { handler, log } = setup([row(1, [])], (m) => ok(m.length));
  await handler(post());
  assertEquals(log.sent, [1]);
  assertEquals(log.expo.length, 0);
});

Deno.test('sends in batches of 100', async () => {
  const tokens = Array.from({ length: 250 }, (_, i) => `T${i}`);
  const { handler, log } = setup([row(1, tokens)], (m) => ok(m.length));
  await handler(post());
  assertEquals(log.expo.map((b) => b.length), [100, 100, 50]);
  assertEquals(log.sent, [1]);
});

Deno.test('DeviceNotRegistered deletes the token; the row is sent when another token worked', async () => {
  const { handler, log } = setup([row(1, ['GOOD', 'DEAD'])], () =>
    Promise.resolve([{ status: 'ok' as const }, { status: 'error' as const, details: { error: 'DeviceNotRegistered' } }]));
  await handler(post());
  assertEquals(log.dropped, ['DEAD']);
  assertEquals(log.sent, [1]);
  assertEquals(log.retries, []);
});

Deno.test('a row whose only token is dead is sent (nothing left to deliver)', async () => {
  const { handler, log } = setup([row(1, ['DEAD'])], () =>
    Promise.resolve([{ status: 'error' as const, details: { error: 'DeviceNotRegistered' } }]));
  await handler(post());
  assertEquals(log.dropped, ['DEAD']);
  assertEquals(log.sent, [1]);
});

Deno.test('other errors retry with 5 minutes x attempts', async () => {
  const { handler, log } = setup([row(1, ['T1'], 2)], () =>
    Promise.resolve([{ status: 'error' as const, message: 'MessageRateExceeded', details: { error: 'MessageRateExceeded' } }]));
  await handler(post());
  assertEquals(log.sent, []);
  assertEquals(log.retries.length, 1);
  assertEquals(log.retries[0].attempts, 3);
  assertEquals(log.retries[0].failed, false);
  assertEquals(log.retries[0].sendAfterMs, 15 * 60 * 1000);
});

Deno.test('after 5 attempts the row fails for good', async () => {
  const { handler, log } = setup([row(1, ['T1'], 4)], () =>
    Promise.resolve([{ status: 'error' as const, message: 'boom' }]));
  await handler(post());
  assertEquals(log.retries[0].attempts, 5);
  assertEquals(log.retries[0].failed, true);
  assertEquals(log.retries[0].sendAfterMs, null);
});

Deno.test('an Expo failure never throws: rows are retried', async () => {
  const { handler, log } = setup([row(1, ['T1']), row(2, ['T2'])], () => Promise.reject(new Error('Expo 500')));
  const res = await handler(post());
  assertEquals(res.status, 200);
  assertEquals(log.sent, []);
  assertEquals(log.retries.map((r) => r.id), [1, 2]);
});

Deno.test('a failure of the database read answers 500 without throwing', async () => {
  const handler = createHandler({
    serviceKey: 'secret',
    now: () => new Date(),
    fetchOutbox: () => Promise.reject(new Error('db down')),
    markSent: () => Promise.resolve(),
    markRetry: () => Promise.resolve(),
    dropToken: () => Promise.resolve(),
    expoSend: (m) => ok(m.length),
  });
  const res = await handler(post());
  assertEquals(res.status, 500);
});

Deno.test('only POST is accepted', async () => {
  const { handler } = setup([], (m) => ok(m.length));
  const res = await handler(new Request('http://x/send-push', { method: 'GET', headers: { authorization: 'Bearer secret' } }));
  assertEquals(res.status, 405);
});

Deno.test('calls without the service-role key are refused and nothing is read', async () => {
  let fetched = false;
  const handler = createHandler({
    serviceKey: 'secret',
    now: () => new Date(),
    fetchOutbox: () => {
      fetched = true;
      return Promise.resolve([]);
    },
    markSent: () => Promise.resolve(),
    markRetry: () => Promise.resolve(),
    dropToken: () => Promise.resolve(),
    expoSend: (m) => ok(m.length),
  });
  for (const auth of [null, 'Bearer nope', 'secret', 'Bearer secret2']) {
    const res = await handler(post(auth));
    assertEquals(res.status, 401);
  }
  assertEquals(fetched, false);
});

Deno.test('the error text is passed to markRetry', async () => {
  const errs: string[] = [];
  const handler = createHandler({
    serviceKey: 'secret',
    now: () => new Date(),
    fetchOutbox: () => Promise.resolve([row(1, ['T1'])]),
    markSent: () => Promise.resolve(),
    markRetry: (_id, err) => {
      errs.push(err);
      return Promise.resolve();
    },
    dropToken: () => Promise.resolve(),
    expoSend: () => Promise.resolve([{ status: 'error' as const, details: { error: 'MessageRateExceeded' } }]),
  });
  await handler(post());
  assertEquals(errs, ['MessageRateExceeded']);
});
