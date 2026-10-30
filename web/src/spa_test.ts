import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { appCsp, handleApp } from "./spa.ts";

const SB = "https://abc.supabase.co";

function assets(map: Record<string, { status?: number; body?: string; headers?: Record<string, string> }> = {}) {
  const seen: string[] = [];
  return {
    seen,
    ASSETS: {
      fetch: (input: Request | URL | string) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        seen.push(url.pathname);
        const m = map[url.pathname] ?? { status: 404, body: "nf" };
        return Promise.resolve(new Response(m.body ?? "", { status: m.status ?? 200, headers: m.headers }));
      },
    },
  };
}
const env = (a: ReturnType<typeof assets>, url = SB) => ({ SUPABASE_URL: url, ASSETS: a.ASSETS });
const get = (p: string, method = "GET") => new Request("https://site.test" + p, { method });

Deno.test("csp is built from SUPABASE_URL: https gives wss, http gives ws", () => {
  const s = appCsp("https://abc.supabase.co/");
  assertStringIncludes(s, "connect-src 'self' https://abc.supabase.co wss://abc.supabase.co;");
  assertStringIncludes(s, "img-src 'self' data: blob: https://abc.supabase.co;");
  assertStringIncludes(s, "script-src 'self' https://challenges.cloudflare.com;");
  assertStringIncludes(s, "frame-src https://challenges.cloudflare.com;");
  assertStringIncludes(s, "frame-ancestors 'none'");
  const l = appCsp("http://127.0.0.1:55321");
  assertStringIncludes(l, "connect-src 'self' http://127.0.0.1:55321 ws://127.0.0.1:55321;");
  assert(!l.includes("wss://"));
});

Deno.test("csp with a missing or invalid SUPABASE_URL names no backend", () => {
  for (const v of ["", "nope", undefined]) {
    const s = appCsp(v as string);
    assertStringIncludes(s, "connect-src 'self';");
    assert(!s.includes("undefined"));
  }
});

Deno.test("deep links get the shell, with headers", async () => {
  const a = assets({ "/app/": { body: "<html>shell</html>", headers: { "Content-Type": "text/html" } } });
  for (const p of ["/app", "/app/", "/app/activites/11111111-1111-4111-8111-111111111111", "/app/auth/callback", "/app/profile/"]) {
    a.seen.length = 0;
    const r = await handleApp(get(p), env(a));
    assertEquals(r.status, 200, p);
    assertEquals(await r.text(), "<html>shell</html>");
    assertEquals(a.seen, ["/app/"], p);
    assertEquals(r.headers.get("X-Robots-Tag"), "noindex");
    assertEquals(r.headers.get("Cache-Control"), "no-cache");
    assertEquals(r.headers.get("X-Frame-Options"), "DENY");
    assertEquals(r.headers.get("X-Content-Type-Options"), "nosniff");
    assertStringIncludes(r.headers.get("Strict-Transport-Security")!, "max-age=");
    assertEquals(r.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
    assertStringIncludes(r.headers.get("Permissions-Policy")!, "camera=()");
    assertStringIncludes(r.headers.get("Content-Security-Policy")!, "connect-src 'self' https://abc.supabase.co wss://abc.supabase.co");
    assertEquals(r.headers.get("Content-Type"), "text/html");
  }
});

Deno.test("the static CSP from _headers on the shell is replaced, not duplicated", async () => {
  const a = assets({ "/app/": { body: "x", headers: { "Content-Security-Policy": "default-src 'none'" } } });
  const r = await handleApp(get("/app/x"), env(a));
  assert(!r.headers.get("Content-Security-Policy")!.includes("default-src 'none'"));
});

Deno.test("expo files, assets and any file extension go to ASSETS as asked", async () => {
  const a = assets({
    "/app/_expo/static/js/web/entry-abc.js": { body: "js" },
    "/app/assets/a/b.png": { body: "png" },
    "/app/favicon.ico": { body: "ico" },
    "/app/some/file.txt": { body: "txt" },
  });
  for (const [p, body] of [
    ["/app/_expo/static/js/web/entry-abc.js", "js"],
    ["/app/assets/a/b.png", "png"],
    ["/app/favicon.ico", "ico"],
    ["/app/some/file.txt", "txt"],
  ]) {
    a.seen.length = 0;
    const r = await handleApp(get(p), env(a));
    assertEquals(await r.text(), body, p);
    assertEquals(a.seen, [p], p);
    assertEquals(r.headers.get("X-Robots-Tag"), null, p);
  }
});

Deno.test("a missing asset stays a 404, never the shell", async () => {
  const a = assets();
  const r = await handleApp(get("/app/_expo/missing.js"), env(a));
  assertEquals(r.status, 404);
  const r2 = await handleApp(get("/app/assets/missing"), env(a));
  assertEquals(r2.status, 404);
});

Deno.test("HEAD works; other methods answer 405", async () => {
  const a = assets({ "/app/": { body: "shell" } });
  const h = await handleApp(get("/app/profile", "HEAD"), env(a));
  assertEquals(h.status, 200);
  assertEquals(h.headers.get("X-Robots-Tag"), "noindex");
  const p = await handleApp(get("/app/profile", "POST"), env(a));
  assertEquals(p.status, 405);
  assertEquals(p.headers.get("Allow"), "GET, HEAD");
});

Deno.test("a failing shell fetch passes its status through", async () => {
  const a = assets({ "/app/": { status: 500, body: "boom" } });
  const r = await handleApp(get("/app/x"), env(a));
  assertEquals(r.status, 500);
});

Deno.test("_routes.json excludes the static paths and includes everything else", async () => {
  const j = JSON.parse(await Deno.readTextFile("web/public/_routes.json"));
  assertEquals(j.version, 1);
  assertEquals(j.include, ["/*"]);
  for (const e of ["/app/_expo/*", "/app/assets/*", "/app/favicon.ico", "/favicon.ico", "/styles.css", "/og-default.png", "/.well-known/*"]) {
    assert(j.exclude.includes(e), e);
  }
  assert(!existsPublic("_redirects"));
});

function existsPublic(f: string): boolean {
  try {
    Deno.statSync("web/public/" + f);
    return true;
  } catch {
    return false;
  }
}

Deno.test("_headers keeps the default security headers for static files and has no /app CSP template", async () => {
  const h = await Deno.readTextFile("web/public/_headers");
  assert(!h.includes("{{"));
  for (const k of ["Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) {
    assertStringIncludes(h, k);
  }
});

Deno.test("web/public/favicon.ico is a valid 16x16 icon", async () => {
  const b = await Deno.readFile("web/public/favicon.ico");
  assert(b.length > 22 && b.length < 4096);
  assertEquals([b[0], b[1], b[2], b[3]], [0, 0, 1, 0]); // ICONDIR, type icon
  assertEquals(b[4], 1); // one image
  assertEquals([b[6], b[7]], [16, 16]);
});

Deno.test("WEB-3: the 405 carries the security headers", async () => {
  const r = await handleApp(get("/app/x", "POST"), env(assets()));
  assertEquals(r.status, 405);
  assertEquals(r.headers.get("Allow"), "GET, HEAD");
  assertEquals(r.headers.get("X-Content-Type-Options"), "nosniff");
  assertEquals(r.headers.get("X-Frame-Options"), "DENY");
  assertStringIncludes(r.headers.get("Strict-Transport-Security") ?? "", "max-age=");
  assertStringIncludes(r.headers.get("Content-Security-Policy") ?? "", "frame-ancestors 'none'");
});

Deno.test("WEB-4: assets and missing assets answered by the Function carry the security headers", async () => {
  const a = assets({ "/app/some/file.txt": { body: "txt", headers: { "Content-Type": "text/plain", "Cache-Control": "max-age=5" } } });
  for (const [p, status] of [["/app/some/file.txt", 200], ["/app/nope.js", 404]] as const) {
    const r = await handleApp(get(p), env(a));
    assertEquals(r.status, status, p);
    assertEquals(r.headers.get("X-Content-Type-Options"), "nosniff", p);
    assertEquals(r.headers.get("X-Frame-Options"), "DENY", p);
    assertStringIncludes(r.headers.get("Strict-Transport-Security") ?? "", "max-age=", p);
    assertStringIncludes(r.headers.get("Content-Security-Policy") ?? "", "default-src", p);
  }
  const ok = await handleApp(get("/app/some/file.txt"), env(a));
  assertEquals(ok.headers.get("Content-Type"), "text/plain");
  assertEquals(ok.headers.get("Cache-Control"), "max-age=5");
});
