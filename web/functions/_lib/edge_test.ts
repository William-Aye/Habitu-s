import { assertEquals } from "jsr:@std/assert@1";
import { withEdgeCache } from "./edge.ts";
import type { CacheLike } from "./edge.ts";

function fakeCache() {
  const store = new Map<string, Response>();
  const c: CacheLike = {
    match: (r) => Promise.resolve(store.get(r.url)?.clone()),
    put: (r, res) => {
      store.set(r.url, res);
      return Promise.resolve();
    },
  };
  return { c, store };
}
function ctx() {
  const pending: Promise<unknown>[] = [];
  return { waitUntil: (p: Promise<unknown>) => void pending.push(p), flush: () => Promise.all(pending) };
}
const req = new Request("https://h.test/activites/x");

Deno.test("miss runs handler and stores; hit skips handler", async () => {
  const { c, store } = fakeCache();
  const x = ctx();
  let n = 0;
  const h = () => Promise.resolve(new Response("body", { status: 200 }));
  const r1 = await withEdgeCache(req, x, 300, () => (n++, h()), c);
  await x.flush();
  assertEquals(await r1.text(), "body");
  assertEquals(store.size, 1);
  assertEquals(store.get(req.url)!.headers.get("Cache-Control"), "public, s-maxage=300");
  const r2 = await withEdgeCache(req, x, 300, () => (n++, h()), c);
  assertEquals(await r2.text(), "body");
  assertEquals(n, 1);
});

Deno.test("only 200, 301, 404, 410 are stored; 404 and 410 use 60 s", async () => {
  for (const [status, stored, ttl] of [[200, true, 3600], [301, true, 3600], [404, true, 60], [410, true, 60], [503, false, 0], [500, false, 0]] as const) {
    const { c, store } = fakeCache();
    const x = ctx();
    await withEdgeCache(req, x, 3600, () => Promise.resolve(new Response("x", { status })), c);
    await x.flush();
    assertEquals(store.size === 1, stored, String(status));
    if (stored) assertEquals(store.get(req.url)!.headers.get("Cache-Control"), `public, s-maxage=${ttl}`);
  }
});

Deno.test("no cache available runs the handler", async () => {
  const r = await withEdgeCache(req, ctx(), 300, () => Promise.resolve(new Response("ok")), undefined);
  assertEquals(await r.text(), "ok");
});
