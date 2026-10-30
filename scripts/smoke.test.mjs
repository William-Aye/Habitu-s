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
        return Response.json([{ target: { namespace: "android_app", package_name: "fr.habitues.app" } }]);
      return new Response("<html></html>", { headers: SEC });
    }
    if (u.pathname === "/rest/v1/profiles") return Response.json([]);
    if (u.pathname === "/rest/v1/rpc/admin_reports") return Response.json({ code: "42501" }, { status: 403 });
    if (u.pathname === "/auth/v1/token") return Response.json({ code: "validation_failed" }, { status: 400 });
    return new Response("", { status: 404 });
  };
}

const failing = async (env, over) => (await runChecks(env, fakeFetch(over))).filter((r) => !r.ok).map((r) => r.name);

test("a correct site passes every check", async () => {
  const res = await runChecks(ENV, fakeFetch());
  assert.deepEqual(res.filter((r) => !r.ok), []);
  assert.ok(res.length >= 9);
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

test("password sign-in answering 200 fails auth-password", async () => {
  const f = await failing(ENV, { "POST sb:/auth/v1/token": () => Response.json({}) });
  assert.deepEqual(f, ["auth-password"]);
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
