import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { handleActivity, handleAssociation, handleHome, handleRobots, handleSitemap, handleSitemapIndex } from "./pages.ts";
import type { Deps, Env } from "./pages.ts";
import { ACT_ID, activityFixture, ASSO_ID, associationFixture, EVIL } from "./fixtures.ts";

const env: Env = { SUPABASE_URL: "http://sb", SUPABASE_ANON_KEY: "k", WEB_BASE_URL: "https://habitues.test/", PLAY_STORE_URL: "https://play.google.com/store/apps/details?id=x" };
const CANON_A = `/activites/jeu-de-go-${ACT_ID}`;
const CANON_S = `/associations/club-de-go-lyon-${ASSO_ID}`;

function deps(map: Record<string, (args: Record<string, unknown>) => unknown>): Deps {
  return { rpc: (name, args) => Promise.resolve().then(() => map[name](args ?? {})) };
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

const okActivity = (status = "ok") =>
  deps({ web_activity_status: () => status, get_activity: () => activityFixture() });

Deno.test("activity ok: 200, canonical, OG, count, no names, cache, security", async () => {
  const r = await handleActivity(req(CANON_A), env, okActivity());
  assertEquals(r.status, 200);
  const body = await r.text();
  assertStringIncludes(body, `<link rel="canonical" href="https://habitues.test${CANON_A}">`);
  assertStringIncludes(body, 'property="og:title"');
  assertStringIncludes(body, "3 confirmés");
  assert(!body.includes("Alice") && !body.includes("Bob"));
  assertEquals(r.headers.get("Cache-Control"), "public, s-maxage=300, max-age=60");
  assertEquals(r.headers.get("Content-Type"), "text/html; charset=utf-8");
  assertEquals(r.headers.has("Set-Cookie"), false);
  assertSecurity(r);
});

Deno.test("activity wrong slug and bare uuid: 301 to canonical", async () => {
  for (const p of [`/activites/mauvais-slug-${ACT_ID}`, `/activites/${ACT_ID}`]) {
    const r = await handleActivity(req(p + "?utm=1"), env, okActivity());
    assertEquals(r.status, 301);
    assertEquals(r.headers.get("Location"), `https://habitues.test${CANON_A}`);
    assertSecurity(r);
  }
});

Deno.test("activity removed 410, missing 404, garbage 404, all noindex", async () => {
  for (const [status, code] of [["removed", 410], ["missing", 404]] as const) {
    const r = await handleActivity(req(CANON_A), env, deps({ web_activity_status: () => status }));
    assertEquals(r.status, code);
    assertStringIncludes(await r.text(), '<meta name="robots" content="noindex">');
    assertEquals(r.headers.get("Cache-Control"), "public, s-maxage=60");
    assertSecurity(r);
  }
  const g = await handleActivity(req("/activites/garbage"), env, deps({}));
  assertEquals(g.status, 404);
});

Deno.test("activity: get_activity null after ok status is a 404", async () => {
  const r = await handleActivity(req(CANON_A), env, deps({ web_activity_status: () => "ok", get_activity: () => null }));
  assertEquals(r.status, 404);
});

Deno.test("activity: evil title does not break out", async () => {
  const d = deps({ web_activity_status: () => "ok", get_activity: () => activityFixture({ title: EVIL }) });
  const r = await handleActivity(req(`/activites/x-${ACT_ID}`), env, d);
  assertEquals(r.status, 301);
  const r2 = await handleActivity(req(r.headers.get("Location")!.replace("https://habitues.test", "")), env, d);
  assertEquals(r2.status, 200);
  assert(!(await r2.text()).includes("<script>alert(1)"));
});

Deno.test("RPC throwing gives 503 with Retry-After and no error text", async () => {
  const r = await handleActivity(req(CANON_A), env, { rpc: () => Promise.reject(new Error("secret db password")) });
  assertEquals(r.status, 503);
  assertEquals(r.headers.get("Retry-After"), "60");
  assert(!(await r.text()).includes("secret"));
  assertSecurity(r);
});

Deno.test("RPC hanging gives 503 after the timeout", async () => {
  const r = await handleActivity(req(CANON_A), env, { rpc: () => new Promise(() => {}), timeoutMs: 30 });
  assertEquals(r.status, 503);
  assertEquals(r.headers.get("Retry-After"), "60");
});

Deno.test("association: ok shows city only; hidden 404; removed 410; redirect", async () => {
  const ok = deps({ web_association_status: () => "ok", get_association: () => associationFixture() });
  const r = await handleAssociation(req(CANON_S), env, ok);
  assertEquals(r.status, 200);
  const body = await r.text();
  assertStringIncludes(body, "Lyon");
  assert(!body.includes("Secrète"));
  assertStringIncludes(body, `<link rel="canonical" href="https://habitues.test${CANON_S}">`);
  assertSecurity(r);

  const red = await handleAssociation(req(`/associations/${ASSO_ID}`), env, ok);
  assertEquals(red.status, 301);
  assertEquals(red.headers.get("Location"), `https://habitues.test${CANON_S}`);

  const hidden = await handleAssociation(req(CANON_S), env, deps({ web_association_status: () => "hidden" }));
  assertEquals(hidden.status, 404);
  assertStringIncludes(await hidden.text(), "noindex");
  const gone = await handleAssociation(req(CANON_S), env, deps({ web_association_status: () => "removed" }));
  assertEquals(gone.status, 410);
  const bad = await handleAssociation(req(CANON_S), env, { rpc: () => Promise.reject(new Error("x")) });
  assertEquals(bad.status, 503);
});

// ---- sitemaps ----
function uuid(i: number) {
  return `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
}
function sitemapDeps(total: number, fn: "web_sitemap_associations" | "web_sitemap_activities") {
  const d: Deps = {
    rpc: (name, args) => {
      if (name !== fn) return Promise.resolve([]);
      const after = args?.p_after as string | null | undefined;
      const limit = args?.p_limit as number;
      const start = after ? parseInt(after.slice(-12), 16) : 0;
      const rows = [];
      for (let i = start + 1; i <= Math.min(total, start + limit); i++) {
        rows.push({ id: uuid(i), name: `Asso ${i}`, title: `Act ${i}`, city: "Lyon", updated_at: "2026-10-01T10:00:00Z" });
      }
      return Promise.resolve(rows);
    },
  };
  return { d };
}

Deno.test("sitemap index: 120001 associations make 3 child sitemaps", async () => {
  const { d } = sitemapDeps(120001, "web_sitemap_associations");
  const r = await handleSitemapIndex(req("/sitemap.xml"), env, d);
  assertEquals(r.status, 200);
  assertStringIncludes(r.headers.get("Content-Type")!, "xml");
  const xml = await r.text();
  assertEquals((xml.match(/<sitemap>/g) ?? []).length, 3);
  assertStringIncludes(xml, "https://habitues.test/sitemaps/s-1.xml");
  assertStringIncludes(xml, "https://habitues.test/sitemaps/s-3.xml");
  assert(!xml.includes("s-4.xml"));
  assert(!xml.includes("a-1.xml"));
  assertSecurity(r);
});

Deno.test("child sitemap holds ok rows with lastmod, capped at 50000", async () => {
  const { d } = sitemapDeps(120001, "web_sitemap_associations");
  const r = await handleSitemap(req("/sitemaps/s-3.xml"), env, d, "s-3.xml");
  const xml = await r.text();
  assertEquals((xml.match(/<url>/g) ?? []).length, 20001);
  assertStringIncludes(xml, "<lastmod>2026-10-01T10:00:00.000Z</lastmod>");
  assertStringIncludes(xml, `https://habitues.test/associations/asso-100001-lyon-${uuid(100001)}`);
  const first = await handleSitemap(req("/sitemaps/s-1.xml"), env, d, "s-1.xml");
  assertEquals(((await first.text()).match(/<url>/g) ?? []).length, 50000);
  const none = await handleSitemap(req("/sitemaps/s-4.xml"), env, d, "s-4.xml");
  assertEquals(none.status, 404);
  const junk = await handleSitemap(req("/sitemaps/zzz.xml"), env, d, "zzz.xml");
  assertEquals(junk.status, 404);
});

Deno.test("activity sitemap uses activity urls", async () => {
  const { d } = sitemapDeps(2, "web_sitemap_activities");
  const xml = await (await handleSitemap(req("/sitemaps/a-1.xml"), env, d, "a-1.xml")).text();
  assertStringIncludes(xml, `https://habitues.test/activites/act-1-${uuid(1)}`);
});

Deno.test("sitemap RPC failure gives 503", async () => {
  const r = await handleSitemapIndex(req("/sitemap.xml"), env, { rpc: () => Promise.reject(new Error("x")) });
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
