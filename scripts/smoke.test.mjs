import test from "node:test";
import assert from "node:assert/strict";
import { runChecks } from "./smoke.mjs";

const WEB = "https://habitues.example";
const SB = "https://abc.supabase.example";
const ENV = {
  SMOKE_WEB_BASE_URL: WEB,
  SMOKE_SUPABASE_URL: SB,
  SMOKE_SUPABASE_ANON_KEY: "anon-test-key",
};
const SEC = {
  "Content-Security-Policy": "default-src 'none'",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};
const GOOD_LINK = {
  relation: ["delegate_permission/common.handle_all_urls"],
  target: { namespace: "android_app", package_name: "fr.habitues.app", sha256_cert_fingerprints: ["AA:BB"] },
};
const UNKNOWN = "GET /activites/smoke-00000000-0000-4000-8000-000000000000";

// A correct site; `over` maps "METHOD path" (prefixed "sb:" for Supabase) to a replacement handler.
function fakeFetch(over = {}) {
  return async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method ?? "GET"} ${u.origin === WEB ? "" : "sb:"}${u.pathname}`;
    if (over[key]) return over[key](u, init);
    if (u.origin === WEB) {
      if (u.pathname === "/sitemap.xml")
        return new Response('<?xml version="1.0"?>\n<sitemapindex xmlns="x"></sitemapindex>', { headers: SEC });
      if (u.pathname.startsWith("/activites/"))
        return new Response('<meta name="robots" content="noindex">', { status: 404, headers: SEC });
      if (u.pathname === "/.well-known/assetlinks.json")
        return Response.json([GOOD_LINK]);
      return new Response("<html></html>", { headers: SEC });
    }
    if (u.pathname === "/auth/v1/health") return Response.json({ ok: true });
    if (u.pathname === "/rest/v1/profiles") return Response.json([]);
    if (u.pathname === "/rest/v1/rpc/admin_reports") return Response.json({ code: "42501" }, { status: 403 });
    return new Response("", { status: 404 });
  };
}

const failing = async (env, over) => (await runChecks(env, fakeFetch(over))).filter((r) => !r.ok).map((r) => r.name);

test("a correct site passes every check", async () => {
  const res = await runChecks(ENV, fakeFetch());
  assert.deepEqual(res.filter((r) => !r.ok), []);
  assert.ok(res.length >= 10);
});

test("no CSP on / fails headers:/", async () => {
  const rest = { ...SEC };
  delete rest["Content-Security-Policy"];
  const f = await failing(ENV, { "GET /": () => new Response("x", { headers: rest }) });
  assert.deepEqual(f, ["headers:/"]);
});

test("Set-Cookie on a public page fails no-cookies", async () => {
  const f = await failing(ENV, { "GET /": () => new Response("x", { headers: { ...SEC, "Set-Cookie": "a=b" } }) });
  assert.deepEqual(f, ["no-cookies"]);
});

test("non-XML sitemap fails sitemap", async () => {
  const f = await failing(ENV, { "GET /sitemap.xml": () => new Response("<html></html>", { headers: SEC }) });
  assert.deepEqual(f, ["sitemap"]);
});

test("unknown activity answering 200 fails not-found", async () => {
  const f = await failing(ENV, { [UNKNOWN]: () => new Response("ok", { headers: SEC }) });
  assert.deepEqual(f, ["not-found"]);
});

test("404 without noindex fails not-found", async () => {
  const f = await failing(ENV, { [UNKNOWN]: () => new Response("gone", { status: 404, headers: SEC }) });
  assert.deepEqual(f, ["not-found"]);
});

test("assetlinks with another package fails assetlinks", async () => {
  const f = await failing(ENV, {
    "GET /.well-known/assetlinks.json": () =>
      Response.json([{ target: { namespace: "android_app", package_name: "fr.other.app" } }]),
  });
  assert.deepEqual(f, ["assetlinks"]);
});

test("SMOKE_ANDROID_PACKAGE overrides the expected package", async () => {
  const f = await failing({ ...ENV, SMOKE_ANDROID_PACKAGE: "fr.other.app" });
  assert.deepEqual(f, ["assetlinks"]);
});

test("anon profiles returning rows fails anon-profiles", async () => {
  const f = await failing(ENV, { "GET sb:/rest/v1/profiles": () => Response.json([{ id: "1" }]) });
  assert.deepEqual(f, ["anon-profiles"]);
});

test("anon admin_reports succeeding fails anon-admin", async () => {
  const f = await failing(ENV, { "POST sb:/rest/v1/rpc/admin_reports": () => Response.json([]) });
  assert.deepEqual(f, ["anon-admin"]);
});

test("anon admin_reports answering 404 or 500 fails anon-admin", async () => {
  for (const status of [404, 500]) {
    const f = await failing(ENV, { "POST sb:/rest/v1/rpc/admin_reports": () => Response.json({ code: "PGRST202" }, { status }) });
    assert.deepEqual(f, ["anon-admin"]);
  }
});

test("anon profiles answering 401 passes, 404 or 500 fails", async () => {
  assert.deepEqual(await failing(ENV, { "GET sb:/rest/v1/profiles": () => new Response("", { status: 401 }) }), []);
  for (const status of [404, 500]) {
    const f = await failing(ENV, { "GET sb:/rest/v1/profiles": () => new Response("", { status }) });
    assert.deepEqual(f, ["anon-profiles"]);
  }
});

test("a wrong Supabase URL fails supabase-reachable", async () => {
  const f = await failing(ENV, { "GET sb:/auth/v1/health": () => new Response("", { status: 404 }) });
  assert.deepEqual(f, ["supabase-reachable"]);
});

test("a Supabase redirect fails and the key is not forwarded", async () => {
  const seen = [];
  const inner = fakeFetch();
  const res = await runChecks(ENV, async (url, init = {}) => {
    if (new URL(url).origin === SB) {
      seen.push(init.redirect);
      if (new URL(url).pathname === "/rest/v1/profiles")
        return new Response("", { status: 302, headers: { Location: "https://evil.example/" } });
    }
    return inner(url, init);
  });
  assert.deepEqual(res.filter((r) => !r.ok).map((r) => r.name), ["anon-profiles"]);
  assert.ok(seen.length > 0 && seen.every((r) => r === "manual"));
});

test("a non-HTTPS Supabase URL fails https", async () => {
  const f = await failing({ ...ENV, SMOKE_SUPABASE_URL: "http://abc.supabase.example" });
  assert.ok(f.includes("https"));
});

test("assetlinks without fingerprints or relation fails", async () => {
  for (const link of [
    { ...GOOD_LINK, target: { ...GOOD_LINK.target, sha256_cert_fingerprints: [] } },
    { ...GOOD_LINK, relation: [] },
  ]) {
    const f = await failing(ENV, { "GET /.well-known/assetlinks.json": () => Response.json([link]) });
    assert.deepEqual(f, ["assetlinks"]);
  }
});

test("a thrown fetch error fails with a reason", async () => {
  const res = await runChecks(ENV, async () => {
    throw new DOMException("timed out", "TimeoutError");
  });
  const bad = res.filter((r) => !r.ok);
  assert.ok(bad.length >= 8 && bad.every((r) => r.reason));
});

test("an empty-body sitemap fails", async () => {
  const f = await failing(ENV, { "GET /sitemap.xml": () => new Response("", { headers: SEC }) });
  assert.deepEqual(f, ["sitemap"]);
});

test("missing Supabase variables fail the three Supabase checks", async () => {
  const f = await failing({ SMOKE_WEB_BASE_URL: WEB });
  assert.deepEqual(f, ["supabase-reachable", "anon-profiles", "anon-admin"]);
});

test("a non-HTTPS base URL fails https", async () => {
  const f = await runChecks({ ...ENV, SMOKE_WEB_BASE_URL: "http://habitues.example" }, async () => new Response(""));
  assert.equal(f.find((r) => r.name === "https").ok, false);
});

test("local http is accepted only with SMOKE_ALLOW_HTTP=1", async () => {
  const local = "http://127.0.0.1:8788";
  const off = await runChecks({ ...ENV, SMOKE_WEB_BASE_URL: local }, async () => new Response(""));
  assert.equal(off[0].ok, false);
  const on = await runChecks({ ...ENV, SMOKE_WEB_BASE_URL: local, SMOKE_ALLOW_HTTP: "1" }, async () => new Response(""));
  assert.equal(on[0].ok, true);
});

test("the anon key never goes to the web host", async () => {
  const seen = [];
  const inner = fakeFetch();
  await runChecks(ENV, async (url, init = {}) => {
    if (new URL(url).origin === WEB) seen.push(JSON.stringify(init.headers ?? {}));
    return inner(url, init);
  });
  assert.ok(seen.every((h) => !h.includes("anon-test-key")));
});
