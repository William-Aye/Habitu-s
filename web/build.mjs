// Builds web/dist: the Expo web export under /app, the static files from web/public, assetlinks.json.
// Env: SUPABASE_URL (required), ANDROID_PACKAGE and ANDROID_SHA256_CERT (optional: assetlinks.json).
// Test flags: --skip-export --export-dir <dir> (use a ready export), --out <dir>.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

const out = path.resolve(opt("--out") ?? path.join(here, "dist"));
const appOut = path.join(out, "app");
const fail = (m) => {
  console.error(`web build failed: ${m}`);
  process.exit(1);
};

const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
if (!/^https?:\/\/[^\s/]+/.test(supabaseUrl)) fail("SUPABASE_URL is missing or not an http(s) URL");
// The /app CSP is built at runtime from SUPABASE_URL (functions/app/[[path]].ts). The app export reads
// EXPO_PUBLIC_SUPABASE_URL: both must name the same origin, or the app would talk to a blocked host.
const exposed = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").trim();
if (exposed && new URL(exposed).origin !== new URL(supabaseUrl).origin) {
  fail("SUPABASE_URL and EXPO_PUBLIC_SUPABASE_URL must have the same origin");
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 1. The Expo web export, under /app.
if (opt("--export-dir")) {
  fs.cpSync(path.resolve(opt("--export-dir")), appOut, { recursive: true });
} else if (!flag("--skip-export")) {
  const r = spawnSync("npx", ["expo", "export", "--platform", "web", "--output-dir", appOut], {
    cwd: path.join(here, "..", "app"),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) fail("expo export failed");
} else {
  fs.mkdirSync(appOut, { recursive: true });
}

// 2. Static files.
const pub = path.join(here, "public");
fs.cpSync(pub, out, { recursive: true, filter: (src) => !src.endsWith(".template") });

// 3. Templates.
const fill = (s, vars) => s.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
const pkg = process.env.ANDROID_PACKAGE || "fr.habitues.app", cert = process.env.ANDROID_SHA256_CERT;
if (pkg && cert) {
  const tpl = fs.readFileSync(path.join(pub, ".well-known", "assetlinks.json.template"), "utf8");
  const json = JSON.parse(fill(tpl, { ANDROID_PACKAGE: pkg, ANDROID_SHA256_CERT: "__CERT__" }));
  json[0].target.sha256_cert_fingerprints = cert.split(",").map((c) => c.trim()).filter(Boolean);
  fs.mkdirSync(path.join(out, ".well-known"), { recursive: true });
  fs.writeFileSync(path.join(out, ".well-known", "assetlinks.json"), JSON.stringify(json, null, 2) + "\n");
} else {
  console.warn("warning: ANDROID_SHA256_CERT not set: assetlinks.json skipped");
}

// 4. No secret in the output.
// A bare "sb_secret_" prefix check exists inside supabase-js itself, so only a key-shaped value counts.
const SECRET = /service[_-]?role[_-]?key|sb_secret_[A-Za-z0-9_-]{16,}/i;
// A legacy service-role key is a JWT whose payload says role=service_role, and a private key has a PEM header (WEB-5).
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const JWT = /eyJ[A-Za-z0-9_-]{5,}\.(eyJ[A-Za-z0-9_-]{5,})\.[A-Za-z0-9_-]*/g;
const privilegedJwt = (text) => {
  for (const m of text.matchAll(JWT)) {
    try {
      const role = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")).role;
      if (role !== undefined && role !== "anon") return true;
    } catch { /* not a JWT */ }
  }
  return false;
};
const hits = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else {
      const text = fs.readFileSync(p, "latin1");
      if (SECRET.test(text) || PRIVATE_KEY.test(text) || privilegedJwt(text)) hits.push(path.relative(out, p));
    }
  }
})(out);
if (hits.length) fail(`secret-like string found in: ${hits.join(", ")}`);

console.log(`web build ok: ${out}`);
