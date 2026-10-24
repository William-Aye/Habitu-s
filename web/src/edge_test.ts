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

Deno.test("query string is not part of the cache key", async () => {
  const { c, store } = fakeCache();
  const x = ctx();
  let n = 0;
  const h = () => (n++, Promise.resolve(new Response("body")));
  await withEdgeCache(new Request("https://h.test/p?cb=1"), x, 300, h, c);
  await x.flush();
  const r = await withEdgeCache(new Request("https://h.test/p?cb=2"), x, 300, h, c);
  assertEquals(await r.text(), "body");
  assertEquals(n, 1);
  assertEquals(store.size, 1);
  assertEquals([...store.keys()], ["https://h.test/p"]);
});

Deno.test("the stored copy keeps the security headers and the content type", async () => {
  const { c, store } = fakeCache();
  const x = ctx();
  const res = new Response("<p>x</p>", {
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'", "Strict-Transport-Security": "max-age=1" },
  });
  await withEdgeCache(req, x, 300, () => Promise.resolve(res), c);
  await x.flush();
  const s = store.get(req.url)!;
  assertEquals(s.headers.get("Content-Type"), "text/html; charset=utf-8");
  assertEquals(s.headers.get("X-Frame-Options"), "DENY");
  assertEquals(s.headers.get("Content-Security-Policy"), "default-src 'none'");
  assertEquals(s.headers.get("Strict-Transport-Security"), "max-age=1");
});

Deno.test("the stored copy keeps the original Cache-Control (max-age) and sets s-maxage", async () => {
  for (const [status, orig, ttl, want] of [
    [200, "public, s-maxage=300, max-age=60", 300, "public, max-age=60, s-maxage=300"],
    [200, "public, max-age=60", 3600, "public, max-age=60, s-maxage=3600"],
    [404, "public, s-maxage=60, max-age=30", 3600, "public, max-age=30, s-maxage=60"],
    [200, "", 300, "public, s-maxage=300"],
  ] as const) {
    const { c, store } = fakeCache();
    const x = ctx();
    const headers: Record<string, string> = orig ? { "Cache-Control": orig } : {};
    await withEdgeCache(req, x, ttl, () => Promise.resolve(new Response("x", { status, headers })), c);
    await x.flush();
    assertEquals(store.get(req.url)!.headers.get("Cache-Control"), want, orig);
  }
});
