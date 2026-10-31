// Backup restore check (docs/ops/backup-restore.md). Needs local Supabase running and RESTORE_TEST=1;
// otherwise it skips, which is how it runs in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const enabled = process.env.RESTORE_TEST === '1';
const skip = enabled ? false : 'RESTORE_TEST=1 not set (needs local Supabase running)';
if (!enabled) console.log('restore-check: skipped, set RESTORE_TEST=1 with local Supabase running to run it');

const script = fileURLToPath(new URL('./restore-check.sh', import.meta.url));
const root = fileURLToPath(new URL('..', import.meta.url));
const base = process.env.RESTORE_TEST_BASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322';
const source = `${base}/postgres`;
const target = `${base}/restore_test`;
const container = process.env.RESTORE_PSQL_CONTAINER;

// Never echo a connection string or its password.
function leakFree(out) {
  for (const needle of [source, target, 'postgres:postgres', '@127.0.0.1:55322']) {
    assert.ok(!out.includes(needle), 'output must not contain the connection string');
  }
}

function bash(args, env = {}) {
  const r = spawnSync('bash', [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, RESTORE_SOURCE_DB_URL: source, RESTORE_TARGET_DB_URL: target, ...env },
    timeout: 8 * 60 * 1000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// Admin SQL on the local server, through the host psql or the Supabase DB container.
function admin(sql, db = 'postgres') {
  const host = spawnSync('psql', [`${base}/${db}`, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  if (!host.error) return host;
  const name =
    container ??
    spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' })
      .stdout.split(/\r?\n/)
      .find((n) => n.startsWith('supabase_db_'));
  assert.ok(name, 'no psql and no supabase_db_* container: is local Supabase running?');
  return spawnSync('docker', ['exec', '-i', name, 'psql', '-U', 'postgres', '-d', db, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
}

test('restore into a scratch database matches; a truncated table is caught', { skip }, (t) => {
  const dropIt = () => admin('drop database if exists restore_test with (force)');
  t.after(dropIt);
  dropIt();
  const created = admin('create database restore_test');
  assert.equal(created.status, 0, `create database: ${created.stderr}`);

  const ok = bash([]);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /restore-check: OK/);

  leakFree(ok.out);

  // Break the copy: empty one table, then only compare.
  const cut = admin('truncate table public.categories cascade', 'restore_test');
  assert.equal(cut.status, 0, `truncate: ${cut.stderr}`);
  const bad = bash(['--compare-only']);
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /public\.categories/);
  assert.match(bad.out, /MISMATCH/);
  leakFree(bad.out);
});

test('refuses a target that is not a scratch database', { skip }, () => {
  const r = bash([], { RESTORE_TARGET_DB_URL: `${base}/other_db` });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /scratch/);
});

test('a bogus source fails with exit 2 and leaks nothing', { skip }, () => {
  const r = bash(['--compare-only'], { RESTORE_SOURCE_DB_URL: `${base}/restore_nope`, RESTORE_TARGET_DB_URL: `${base}/restore_other` });
  assert.equal(r.code, 2, r.out);
  leakFree(r.out);
  assert.ok(!r.out.includes(`${base}/restore_nope`));
});
