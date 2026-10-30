import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  ACTIVITY_BUCKETS,
  ASSOCIATION_BUCKETS,
  entityCacheOpts,
  handleActivity,
  handleAssociation,
  handleHome,
  handleHomeHead,
  handleRobots,
  handleSitemap,
  handleSitemapIndex,
} from "./pages.ts";
import type { Deps, Env } from "./pages.ts";
import { ACT_ID, activityFixture, ASSO_ID, associationFixture, EVIL } from "./fixtures.ts";

const env: Env = { SUPABASE_URL: "http://sb", SUPABASE_ANON_KEY: "k", WEB_BASE_URL: "https://habitues.test/", PLAY_STORE_URL: "https://play.google.com/store/apps/details?id=x" };
const CANON_A = `/activites/jeu-de-go-${ACT_ID}`;
const CANON_S = `/associations/club-de-go-lyon-${ASSO_ID}`;

type Fn = (args: Record<string, unknown>) => unknown;
function deps(map: Record<string, Fn>, calls?: { name: string; args: Record<string, unknown> }[]): Deps {
  return {
    rpc: (name, args) => {
      calls?.push({ name, args: args ?? {} });
      return Promise.resolve().then(() => map[name](args ?? {}));
    },
  };
}
const req = (path: string) => new Request("https://habitues.test" + path);

function assertSecurity(r: Response) {
  assertEquals(r.headers.get("Strict-Transport-Security"), "max-age=31536000; includeSubDomains");
  assertEquals(r.headers.get("X-Content-Type-Options"), "nosniff");
  assertEquals(r.headers.get("X-Frame-Options"), "DENY");
  assertEquals(r.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assertEquals(r.headers.get("Permissions-Policy"), "camera=(), microphone=(), geolocation=()");
  assertEquals(
    r.headers.get("Content-Security-Policy"),
    "default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
}

const actPage = (status = "ok", activity: unknown = activityFixture()) =>
  deps({ web_activity_page: () => ({ status, activity: status === "ok" ? activity : null }) });

Deno.test("activity ok: 200, one RPC, canonical, OG, count, no names, cache, security", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const d = deps({ web_activity_page: () => ({ status: "ok", activity: activityFixture() }) }, calls);
  const r = await handleActivity(req(CANON_A), env, d);
  assertEquals(r.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0], { name: "web_activity_page", args: { p_id: ACT_ID } });
  const body = await r.text();
  assertStringIncludes(body, `<link rel="canonical" href="https://habitues.test${CANON_A}">`);
  assertStringIncludes(body, 'property="og:title"');
  assertStringIncludes(body, "3 confirmés");
  assertStringIncludes(body, "Prochaine séance : mardi 27 octobre à 19:00");
  assert(!body.includes("Alice") && !body.includes("Bob"));
  assertEquals(r.headers.get("Cache-Control"), "public, s-maxage=300, max-age=60");
  assertEquals(r.headers.get("Content-Type"), "text/html; charset=utf-8");
  assertEquals(r.headers.has("Set-Cookie"), false);
  assertSecurity(r);
});

Deno.test("activity wrong slug and bare uuid: 301 to canonical", async () => {
  for (const p of [`/activites/mauvais-slug-${ACT_ID}`, `/activites/${ACT_ID}`]) {
    const r = await handleActivity(req(p + "?utm=1"), env, actPage());
    assertEquals(r.status, 301);
    assertEquals(r.headers.get("Location"), `https://habitues.test${CANON_A}`);
    assertSecurity(r);
  }
});

Deno.test("activity removed 410, missing 404, garbage 404, all noindex", async () => {
  for (const [status, code] of [["removed", 410], ["missing", 404]] as const) {
    const r = await handleActivity(req(CANON_A), env, actPage(status));
    assertEquals(r.status, code);
    assertStringIncludes(await r.text(), '<meta name="robots" content="noindex">');
    assertEquals(r.headers.get("Cache-Control"), "public, s-maxage=60");
    assertSecurity(r);
  }
  const g = await handleActivity(req("/activites/garbage"), env, deps({}));
  assertEquals(g.status, 404);
});

Deno.test("activity: ok status with null activity is a 404", async () => {
  const r = await handleActivity(req(CANON_A), env, deps({ web_activity_page: () => ({ status: "ok", activity: null }) }));
  assertEquals(r.status, 404);
});

Deno.test("activity: evil title does not break out", async () => {
  const d = actPage("ok", activityFixture({ title: EVIL }));
  const r = await handleActivity(req(`/activites/x-${ACT_ID}`), env, d);
  assertEquals(r.status, 301);
  const r2 = await handleActivity(req(r.headers.get("Location")!.replace("https://habitues.test", "")), env, d);
  assertEquals(r2.status, 200);
  assert(!(await r2.text()).includes("<script>alert(1)"));
});

Deno.test("RPC throwing gives 503, Retry-After, no error text, logs only route/rpc/code", async () => {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.join(" "));
  try {
    const r = await handleActivity(req(CANON_A), env, { rpc: () => Promise.reject(new Error("secret db password")) });
    assertEquals(r.status, 503);
    assertEquals(r.headers.get("Retry-After"), "60");
    assert(!(await r.text()).includes("secret"));
    assertSecurity(r);
  } finally {
    console.error = orig;
  }
  assertEquals(logged.length, 1);
  assertEquals(Object.keys(JSON.parse(logged[0])).sort(), ["code", "route", "rpc"]);
  assert(!logged[0].includes("secret") && !logged[0].includes("habitues.test"));
});

Deno.test("RPC hanging gives 503 within the deadline and aborts the signal", async () => {
  let signal: AbortSignal | undefined;
  const t0 = performance.now();
  const r = await handleActivity(req(CANON_A), env, {
    rpc: (_n, _a, s) => {
      signal = s;
      return new Promise(() => {});
    },
    timeoutMs: 30,
  });
  assertEquals(r.status, 503);
  assertEquals(r.headers.get("Retry-After"), "60");
  assert(performance.now() - t0 < 1000);
  assertEquals(signal?.aborted, true);
});

Deno.test("association: ok shows city only; hidden 404; removed 410; redirect; 503", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const ok = deps({ web_association_page: () => ({ status: "ok", association: associationFixture() }) }, calls);
  const r = await handleAssociation(req(CANON_S), env, ok);
  assertEquals(r.status, 200);
  assertEquals(calls.length, 1);
  const body = await r.text();
  assertStringIncludes(body, "Lyon");
  assert(!body.includes("Secrète"));
  assertStringIncludes(body, `<link rel="canonical" href="https://habitues.test${CANON_S}">`);
  assertSecurity(r);

  const red = await handleAssociation(req(`/associations/${ASSO_ID}`), env, ok);
  assertEquals(red.status, 301);
  assertEquals(red.headers.get("Location"), `https://habitues.test${CANON_S}`);

  for (const [status, code] of [["hidden", 404], ["missing", 404], ["removed", 410]] as const) {
    const d = deps({ web_association_page: () => ({ status, association: null }) });
    const x = await handleAssociation(req(CANON_S), env, d);
    assertEquals(x.status, code);
    assertStringIncludes(await x.text(), "noindex");
  }
  const bad = await handleAssociation(req(CANON_S), env, { rpc: () => Promise.reject(new Error("x")) });
  assertEquals(bad.status, 503);
});

Deno.test("base URL falls back to the request origin, never a hard-coded host", async () => {
  const noBase: Env = { SUPABASE_URL: "http://sb", SUPABASE_ANON_KEY: "k" };
  const r = await handleActivity(new Request(`https://example.org${CANON_A}`), noBase, actPage());
  assertStringIncludes(await r.text(), `href="https://example.org${CANON_A}"`);
  const wrong = await handleActivity(new Request(`https://example.org/activites/zz-${ACT_ID}`), noBase, actPage());
  assertEquals(wrong.headers.get("Location"), `https://example.org${CANON_A}`);
  const robots = await handleRobots(new Request("https://example.org/robots.txt"), noBase).text();
  assertStringIncludes(robots, "Sitemap: https://example.org/sitemap.xml");
  assert(!robots.includes("pages.dev"));
});

Deno.test("javascript: website is dropped; cancelled first session is skipped", async () => {
  const x = associationFixture({ website: "javascript:alert(1)" });
  const r = await handleAssociation(req(CANON_S), env, deps({ web_association_page: () => ({ status: "ok", association: x }) }));
  const body = await r.text();
  assert(!body.includes("javascript:"));
  const a = activityFixture({
    next_sessions: [
      { id: "s0", starts_at: "2026-10-20T18:00:00Z", status: "cancelled", confirmed_count: 9 },
      { id: "s1", starts_at: "2026-10-27T18:00:00Z", status: "scheduled", confirmed_count: 2 },
    ],
  });
  const t = await (await handleActivity(req(CANON_A), env, actPage("ok", a))).text();
  assertStringIncludes(t, "2 confirmés");
  assert(!t.includes("9 confirmés"));
});

// ---- sitemaps ----
Deno.test("bucket counts are the ones web_sitemap_range accepts (migration 43)", () => {
  assertEquals(ACTIVITY_BUCKETS, 16);
  assertEquals(ASSOCIATION_BUCKETS, 256);
});

Deno.test("sitemap index is static: no RPC, lists s-0..s-255 and a-0..a-15", async () => {
  const r = await handleSitemapIndex(req("/sitemap.xml"), env);
  assertEquals(r.status, 200);
  assertStringIncludes(r.headers.get("Content-Type")!, "xml");
  const xml = await r.text();
  assertEquals((xml.match(/<sitemap>/g) ?? []).length, 272);
  assertStringIncludes(xml, "https://habitues.test/sitemaps/s-0.xml");
  assertStringIncludes(xml, "https://habitues.test/sitemaps/s-255.xml");
  assertStringIncludes(xml, "https://habitues.test/sitemaps/a-0.xml");
  assertStringIncludes(xml, "https://habitues.test/sitemaps/a-15.xml");
  assert(!xml.includes("s-256.xml") && !xml.includes("a-16.xml"));
  assertSecurity(r);
});

Deno.test("child sitemap: exactly one RPC with the bucket number (the database computes the bounds), ok rows with lastmod", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const d = deps({
    web_sitemap_range: () => [
      { id: ASSO_ID, name: "Club de go", city: "Lyon", updated_at: "2026-10-01T10:00:00Z" },
    ],
  }, calls);
  const r = await handleSitemap(req("/sitemaps/s-5.xml"), env, d, "s-5.xml");
  assertEquals(r.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0], { name: "web_sitemap_range", args: { p_kind: "associations", p_bucket: 5 } });
  const xml = await r.text();
  assertStringIncludes(xml, `<loc>https://habitues.test${CANON_S}</loc>`);
  assertStringIncludes(xml, "<lastmod>2026-10-01T10:00:00.000Z</lastmod>");

  const calls2: { name: string; args: Record<string, unknown> }[] = [];
  const d2 = deps({ web_sitemap_range: () => [{ id: ACT_ID, title: "Jeu de go", updated_at: "2026-10-01T10:00:00Z" }] }, calls2);
  const xa = await (await handleSitemap(req("/sitemaps/a-15.xml"), env, d2, "a-15.xml")).text();
  assertEquals(calls2.length, 1);
  assertEquals(calls2[0].args, { p_kind: "activities", p_bucket: 15 });
  assertStringIncludes(xa, `https://habitues.test${CANON_A}`);
});

Deno.test("empty bucket is a valid empty urlset with 200", async () => {
  const r = await handleSitemap(req("/sitemaps/a-3.xml"), env, deps({ web_sitemap_range: () => [] }), "a-3.xml");
  assertEquals(r.status, 200);
  const xml = await r.text();
  assertStringIncludes(xml, "<urlset");
  assertEquals((xml.match(/<url>/g) ?? []).length, 0);
});

Deno.test("out-of-range or malformed bucket is 404 with no RPC", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const d = deps({ web_sitemap_range: () => [] }, calls);
  for (const f of ["s-256.xml", "s-1000.xml", "a-16.xml", "a-01.xml", "x-1.xml", "s-1.txt", "s--1.xml", "zzz.xml"]) {
    assertEquals((await handleSitemap(req("/sitemaps/" + f), env, d, f)).status, 404, f);
  }
  assertEquals(calls.length, 0);
});

Deno.test("sitemap RPC failure gives 503", async () => {
  const r = await handleSitemap(req("/sitemaps/s-1.xml"), env, { rpc: () => Promise.reject(new Error("x")) }, "s-1.xml");
  assertEquals(r.status, 503);
});

Deno.test("robots.txt", async () => {
  const r = handleRobots(req("/robots.txt"), env);
  const t = await r.text();
  assertStringIncludes(t, "Disallow: /app/");
  assertStringIncludes(t, "Sitemap: https://habitues.test/sitemap.xml");
  assertEquals(r.headers.get("Content-Type"), "text/plain; charset=utf-8");
  assertSecurity(r);
});

Deno.test("home page", async () => {
  const r = handleHome(req("/"), env);
  const t = await r.text();
  assertStringIncludes(t, "Habitués");
  assertStringIncludes(t, "Des activités régulières près de chez vous");
  assertStringIncludes(t, "https://play.google.com/store/apps/details?id=x");
  assertStringIncludes(t, "Mentions légales");
  assertSecurity(r);
});

Deno.test("HEAD / answers 200 cheaply, with the security headers and no body", async () => {
  const r = handleHomeHead();
  assertEquals(r.status, 200);
  assertEquals(await r.text(), "");
  assertSecurity(r);
});

Deno.test("activity response: the organiser's first name is absent from the whole body", async () => {
  const first = "Zéphyrine-Qxv";
  const d = deps({ web_activity_page: () => ({ status: "ok", activity: activityFixture({ organiser: { id: "u9", first_name: first, photo_url: "https://x/zephyr-qxv.jpg" } }) }) });
  const r = await handleActivity(req(CANON_A), env, d);
  assertEquals(r.status, 200);
  const body = await r.text();
  assert(!body.includes("Zéphyrine") && !body.includes("zephyr-qxv"));
  assertStringIncludes(body, "Organisé par un membre");
});

// ---- WEB-1: path variants share one cache entry; junk paths cost no RPC ----

import { withEdgeCache } from "./edge.ts";
import type { CacheLike } from "./edge.ts";

function memCache() {
  const store = new Map<string, Response>();
  const c: CacheLike = {
    match: (r) => Promise.resolve(store.get(r.url)?.clone()),
    put: (r, res) => (store.set(r.url, res), Promise.resolve()),
  };
  return { c, store };
}
async function viaEdge(path: string, c: CacheLike, d: Deps) {
  const pending: Promise<unknown>[] = [];
  const request = req(path);
  const r = await withEdgeCache(
    request,
    { waitUntil: (p) => void pending.push(p) },
    300,
    () => handleActivity(request, env, d, true),
    c,
    entityCacheOpts("/activites/", env, request),
  );
  await Promise.all(pending);
  return r;
}

Deno.test("WEB-1: slug, case, trailing slash and query variants cost one RPC in total", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const d = deps({ web_activity_page: () => ({ status: "ok", activity: activityFixture() }) }, calls);
  const { c, store } = memCache();
  const first = await viaEdge(CANON_A, c, d);
  assertEquals(first.status, 200);
  assertEquals(first.headers.has("X-Canonical-Path"), false);
  const variants = [
    `/activites/${ACT_ID}`,
    `/activites/mauvais-${ACT_ID.toUpperCase()}`,
    `/activites/x${calls.length}-${ACT_ID}/`,
  ];
  for (const p of variants) {
    const r = await viaEdge(p, c, d);
    assertEquals(r.status, 301, p);
    assertEquals(r.headers.get("Location"), `https://habitues.test${CANON_A}`, p);
    assertEquals(r.headers.has("X-Canonical-Path"), false);
    assertSecurity(r);
  }
  const again = await viaEdge(CANON_A + "?z=1", c, d);
  assertEquals(again.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(store.size, 1);
});

Deno.test("WEB-1: a wrong-slug request first fills the cache and is redirected; the canonical one then hits", async () => {
  const calls: unknown[] = [];
  const d = deps({ web_activity_page: () => ({ status: "ok", activity: activityFixture() }) }, calls as never);
  const { c } = memCache();
  assertEquals((await viaEdge(`/activites/junk-${ACT_ID}`, c, d)).status, 301);
  assertEquals((await viaEdge(CANON_A, c, d)).status, 200);
  assertEquals(calls.length, 1);
});

Deno.test("WEB-1: a missing page is cached by id, whatever the slug", async () => {
  const calls: unknown[] = [];
  const d = deps({ web_activity_page: () => ({ status: "missing", activity: null }) }, calls as never);
  const { c } = memCache();
  for (const p of [`/activites/a-${ACT_ID}`, `/activites/b-${ACT_ID}`, `/activites/${ACT_ID}/`]) {
    assertEquals((await viaEdge(p, c, d)).status, 404);
  }
  assertEquals(calls.length, 1);
});

Deno.test("WEB-1: paths that name no id never reach the cache or the database", async () => {
  const calls: unknown[] = [];
  const d = deps({ web_activity_page: () => ({ status: "ok", activity: activityFixture() }) }, calls as never);
  const { c, store } = memCache();
  const junk = [
    "/activites/",
    "/activites/not-a-uuid",
    `/activites/${ACT_ID}/extra`,
    `/activites/${"a".repeat(200)}-${ACT_ID}`,
    `/activites/%E0%A4%A-${ACT_ID}`,
  ];
  for (const p of junk) assertEquals((await viaEdge(p, c, d)).status, 404, p);
  assertEquals(calls.length, 0);
  assertEquals(store.size, 0);
});
