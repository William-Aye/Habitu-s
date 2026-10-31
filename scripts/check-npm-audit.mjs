// Fails when `npm audit --omit=dev --json` reports a high or critical advisory that is not on the
// reviewed allowlist, or when an allowlist entry is past its review date.
// Usage: node scripts/check-npm-audit.mjs <audit.json> <audit-allowlist.json>
// Exit codes: 0 ok, 1 unexpected or expired advisory, 2 unusable input.
// AUDIT_TODAY (YYYY-MM-DD) overrides today's date (used by the tests).
import { readFileSync } from 'node:fs';

function fail(message) {
  console.error(message);
  process.exit(2);
}

function readJson(path, label) {
  let text;
  try {
    text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  } catch (e) {
    fail(`Cannot read ${label} (${path}): ${e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON (${path}).`);
  }
}

const [auditPath, allowlistPath] = process.argv.slice(2);
if (!auditPath || !allowlistPath) fail('Usage: node scripts/check-npm-audit.mjs <audit.json> <audit-allowlist.json>');

const audit = readJson(auditPath, 'npm audit output');
if (audit?.error) fail(`npm audit failed: ${audit.error.summary ?? JSON.stringify(audit.error)}`);
if (!audit || typeof audit.vulnerabilities !== 'object' || audit.vulnerabilities === null) {
  fail('Unexpected npm audit output: no "vulnerabilities" object.');
}

const allowlist = readJson(allowlistPath, 'audit allowlist');
if (!Array.isArray(allowlist)) fail('The audit allowlist must be a JSON list.');
const ok = (v) => typeof v === 'string' && v.trim() !== '';
for (const [i, e] of allowlist.entries()) {
  if (!ok(e?.id) || !ok(e?.package)) fail(`Audit allowlist entry ${i} needs an id and a package.`);
  if (!ok(e.reason)) fail(`Audit allowlist entry ${i} (${e.id}) has no reason: every exception must be explained.`);
  if (!ok(e.review_by) || !/^\d{4}-\d{2}-\d{2}$/.test(e.review_by) || Number.isNaN(Date.parse(e.review_by))) {
    fail(`Audit allowlist entry ${i} (${e.id}) needs a review_by date (YYYY-MM-DD).`);
  }
}

const today = process.env.AUDIT_TODAY ?? new Date().toISOString().slice(0, 10);

// Advisories are the object entries of "via"; string entries only point at another package.
const advisories = new Map();
for (const v of Object.values(audit.vulnerabilities)) {
  for (const via of v.via ?? []) {
    if (typeof via !== 'object' || !['high', 'critical'].includes(via.severity)) continue;
    const id = String(via.url ?? '').split('/').pop() || String(via.source);
    advisories.set(`${id}|${via.name}`, { id, name: via.name, title: via.title, url: via.url });
  }
}

let bad = 0;
for (const a of advisories.values()) {
  const entry = allowlist.find((e) => e.id === a.id && e.package === a.name);
  if (!entry) {
    console.log(`${a.name}: ${a.id} ${a.title ?? ''} ${a.url ?? ''}`.trim());
    bad++;
  } else if (entry.review_by < today) {
    console.log(`${a.name}: ${a.id} allowlist entry expired on ${entry.review_by}, review it`);
    bad++;
  }
}
if (bad > 0) {
  console.log(`${bad} high or critical advisory(ies) not accepted.`);
  process.exit(1);
}
console.log(`npm audit OK (${advisories.size} allowlisted high/critical advisory(ies)).`);
