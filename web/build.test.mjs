import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const build = path.join(here, "build.mjs");

function setup(files = { "index.html": "<html></html>", "_expo/static/js/app.js": "console.log(1)" }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webbuild-"));
  const fake = path.join(dir, "fake-export");
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(fake, f)), { recursive: true });
    fs.writeFileSync(path.join(fake, f), c);
  }
  return { dir, fake, out: path.join(dir, "dist") };
}
function run({ fake, out }, env = {}) {
  const e = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env };
  return spawnSync(process.execPath, [build, "--skip-export", "--export-dir", fake, "--out", out], { env: e, encoding: "utf8" });
}
const base = { SUPABASE_URL: "https://abc.supabase.co" };

test("fills _headers and copies the export under app/", () => {
  const s = setup();
  const r = run(s, base);
  assert.equal(r.status, 0, r.stderr);
  const h = fs.readFileSync(path.join(s.out, "_headers"), "utf8");
  assert.ok(h.includes("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co"));
  assert.ok(!h.includes("{{"));
  assert.ok(fs.existsSync(path.join(s.out, "app", "index.html")));
  assert.ok(fs.existsSync(path.join(s.out, "styles.css")));
  assert.ok(fs.existsSync(path.join(s.out, "_redirects")));
  assert.ok(!fs.existsSync(path.join(s.out, ".well-known", "assetlinks.json.template")));
});

test("assetlinks.json is generated from env vars", () => {
  const s = setup();
  const r = run(s, { ...base, ANDROID_PACKAGE: "fr.x.app", ANDROID_SHA256_CERT: "AA:BB" });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(fs.readFileSync(path.join(s.out, ".well-known", "assetlinks.json"), "utf8"));
  assert.equal(j[0].target.package_name, "fr.x.app");
  assert.deepEqual(j[0].target.sha256_cert_fingerprints, ["AA:BB"]);
});

test("assetlinks.json is skipped with a warning when env is missing", () => {
  const s = setup();
  const r = run(s, base);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(s.out, ".well-known", "assetlinks.json")));
  assert.match(r.stderr + r.stdout, /assetlinks/i);
});

test("build fails when SUPABASE_URL is missing", () => {
  const r = run(setup(), {});
  assert.notEqual(r.status, 0);
});

test("secret check fails the build", () => {
  for (const bad of ["SUPABASE_SERVICE_ROLE_KEY", "sb_secret_abcdefghijklmnop1234", "service-role-key"]) {
    const s = setup({ "index.html": "x", "_expo/static/js/app.js": `var k="${bad}";` });
    const r = run(s, base);
    assert.notEqual(r.status, 0, bad);
    assert.match(r.stderr, /secret/i);
  }
});

test("the bare sb_secret_ prefix (supabase-js internals) is not a secret", () => {
  const s = setup({ "index.html": "x", "a.js": 'e.startsWith("sb_secret_")' });
  assert.equal(run(s, base).status, 0);
});
