import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-npm-audit.mjs', import.meta.url));
const fx = (name) => fileURLToPath(new URL(`./fixtures/npm-audit/${name}`, import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'audit-'));

function allowlist(entries) {
  const p = join(dir, `al-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(entries));
  return p;
}
const entry = (over = {}) => ({
  id: 'GHSA-mrhx-c7xc-m3w5',
  package: 'zod',
  reason: 'Build-time CLI only.',
  review_by: '2027-01-29',
  ...over,
});

function run(audit, list, today = '2026-10-29') {
  const r = spawnSync(process.execPath, [script, fx(audit), list], {
    encoding: 'utf8',
    env: { ...process.env, AUDIT_TODAY: today },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('clean audit passes', () => {
  assert.equal(run('clean.json', allowlist([])).code, 0);
});

test('an allowlisted high advisory passes', () => {
  assert.equal(run('zod-high.json', allowlist([entry()])).code, 0);
});

test('a high advisory that is not listed fails and is named', () => {
  const r = run('zod-high.json', allowlist([]));
  assert.equal(r.code, 1);
  assert.match(r.out, /GHSA-mrhx-c7xc-m3w5/);
});

test('an expired allowlist entry fails', () => {
  const r = run('zod-high.json', allowlist([entry()]), '2027-01-30');
  assert.equal(r.code, 1);
  assert.match(r.out, /expired/);
});

test('an entry with an empty reason exits 2', () => {
  assert.equal(run('zod-high.json', allowlist([entry({ reason: ' ' })])).code, 2);
});

test('input that is not an audit report exits 2', () => {
  assert.equal(run('not-audit.json', allowlist([])).code, 2);
});
