// Post-deploy smoke check: security headers, indexing rules, Android App Links and anonymous access.
// Usage: SMOKE_WEB_BASE_URL=... SMOKE_SUPABASE_URL=... SMOKE_SUPABASE_ANON_KEY=... npm run smoke
// Optional: SMOKE_ANDROID_PACKAGE (default fr.habitues.app), SMOKE_ALLOW_HTTP=1 (local runs only: allows
// http://127.0.0.1 and http://localhost). The anon key is sent only to SMOKE_SUPABASE_URL and is never printed.
import { pathToFileURL } from "node:url";

const TIMEOUT_MS = 10_000;
const DEFAULT_PACKAGE = "fr.habitues.app";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const REQUIRED_HEADERS = [
  "Content-Security-Policy",
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
];
const PUBLIC_PATHS = ["/", "/conditions", "/confidentialite"];

const trimSlash = (s) => (s ?? "").trim().replace(/\/+$/, "");
const isLocalHttp = (u) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(u);

function withTimeout(fetchImpl, url, init = {}) {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

async function check(name, fn) {
  try {
    const reason = await fn();
    return reason ? { name, ok: false, reason } : { name, ok: true };
  } catch (e) {
    return { name, ok: false, reason: `request failed (${e?.name ?? "error"})` };
  }
}

export async function runChecks(env, fetchImpl = globalThis.fetch) {
  const web = trimSlash(env.SMOKE_WEB_BASE_URL);
  const sb = trimSlash(env.SMOKE_SUPABASE_URL);
  const anon = env.SMOKE_SUPABASE_ANON_KEY ?? "";
  const pkg = env.SMOKE_ANDROID_PACKAGE || DEFAULT_PACKAGE;
  const allowHttp = env.SMOKE_ALLOW_HTTP === "1";
  const get = (path) => withTimeout(fetchImpl, web + path, { headers: { Accept: "text/html" } });
  const results = [];

  results.push(
    await check("https", () => {
      if (!web) return "SMOKE_WEB_BASE_URL is not set";
      if (web.startsWith("https://")) return null;
      if (allowHttp && isLocalHttp(web)) return null;
      return "base URL is not HTTPS";
    }),
  );
  if (!web) return results;

  for (const p of PUBLIC_PATHS) {
    results.push(
      await check(`headers:${p}`, async () => {
        const res = await get(p);
        if (res.status !== 200) return `status ${res.status}`;
        const missing = REQUIRED_HEADERS.filter((h) => !res.headers.get(h));
        return missing.length ? `missing ${missing.join(", ")}` : null;
      }),
    );
  }

  results.push(
    await check("no-cookies", async () => {
      for (const p of [...PUBLIC_PATHS, `/activites/smoke-${UNKNOWN_ID}`]) {
        const res = await get(p);
        if (res.headers.get("set-cookie")) return `Set-Cookie on ${p}`;
      }
      return null;
    }),
  );

  results.push(
    await check("sitemap", async () => {
      const res = await get("/sitemap.xml");
      if (res.status !== 200) return `status ${res.status}`;
      const body = await res.text();
      return /^\s*<\?xml[^>]*\?>\s*<(sitemapindex|urlset)[\s>]/.test(body) ? null : "not a sitemap XML document";
    }),
  );

  results.push(
    await check("not-found", async () => {
      const res = await get(`/activites/smoke-${UNKNOWN_ID}`);
      if (res.status !== 404) return `unknown id answered ${res.status}, expected 404`;
      const body = await res.text();
      const noindex =
        /noindex/i.test(res.headers.get("x-robots-tag") ?? "") ||
        /<meta[^>]+name=["']robots["'][^>]*noindex/i.test(body);
      return noindex ? null : "404 page lacks noindex";
    }),
  );

  results.push(
    await check("assetlinks", async () => {
      const res = await withTimeout(fetchImpl, `${web}/.well-known/assetlinks.json`);
      if (res.status !== 200) return `status ${res.status}`;
      const json = await res.json();
      const found =
        Array.isArray(json) &&
        json.some((s) => s?.target?.namespace === "android_app" && s.target.package_name === pkg);
      return found ? null : `package ${pkg} not listed`;
    }),
  );

  if (!sb || !anon) {
    for (const name of ["anon-profiles", "anon-admin", "auth-password"]) {
      results.push({ name, ok: false, reason: "SMOKE_SUPABASE_URL or SMOKE_SUPABASE_ANON_KEY is not set" });
    }
    return results;
  }
  const auth = { apikey: anon, Authorization: `Bearer ${anon}` };

  results.push(
    await check("anon-profiles", async () => {
      const res = await withTimeout(fetchImpl, `${sb}/rest/v1/profiles?select=id&limit=1`, { headers: auth });
      if (!res.ok) return null; // an error (401/403) is the expected, safe answer
      const rows = await res.json().catch(() => null);
      return Array.isArray(rows) && rows.length === 0 ? null : "anonymous read of profiles returned rows";
    }),
  );

  results.push(
    await check("anon-admin", async () => {
      const res = await withTimeout(fetchImpl, `${sb}/rest/v1/rpc/admin_reports`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ p_status: "open", p_before_at: null, p_before_id: null, p_limit: 1 }),
      });
      return res.ok ? `anonymous call to admin_reports answered ${res.status}` : null;
    }),
  );

  results.push(
    await check("auth-password", async () => {
      const email = `smoke-${Math.random().toString(36).slice(2)}@example.invalid`;
      const res = await withTimeout(fetchImpl, `${sb}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: anon, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "smoke-check-not-a-real-password" }),
      });
      return res.status === 400 ? null : `password sign-in answered ${res.status}, expected 400`;
    }),
  );

  return results;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const results = await runChecks(process.env, globalThis.fetch);
  for (const r of results) console.log(`${r.name}: ${r.ok ? "ok" : `FAIL ${r.reason}`}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
