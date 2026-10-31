import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-advisors.mjs', import.meta.url));
const fx = (name) => fileURLToPath(new URL(`./fixtures/advisors/${name}`, import.meta.url));

function run(advisors, allowlist = 'allowlist.json') {
  const r = spawnSync(process.execPath, [script, fx(advisors), fx(allowlist)], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('clean advisors pass', () => {
  assert.equal(run('clean.json').code, 0);
});

test('allowlisted warnings pass (INFO ignored)', () => {
  assert.equal(run('allowlisted.json').code, 0);
});

test('a new warning fails and is named', () => {
  const r = run('new-warning.json');
  assert.equal(r.code, 1);
  assert.match(r.out, /rls_disabled_in_public: .*public\.secrets/);
  assert.doesNotMatch(r.out, /extension_in_public/);
});

test('a CLI error object exits 2', () => {
  assert.equal(run('cli-error.json').code, 2);
});

test('input that is not JSON exits 2', () => {
  assert.equal(run('not-json.json').code, 2);
});

test('an allowlist entry with an empty reason exits 2', () => {
  assert.equal(run('clean.json', 'allowlist-empty-reason.json').code, 2);
});
