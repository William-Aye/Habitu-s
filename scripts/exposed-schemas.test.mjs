// FN-6 (pre-launch security review): pg_net, vault and pg_cron keep grants to anon and authenticated
// that a migration cannot revoke (they belong to supabase_admin). They stay out of reach only while
// their schemas are never exposed through the Data API. This guards the local config; the hosted
// project's "Exposed schemas" setting must match it (launch checklist).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the Data API exposes public and graphql_public only', () => {
  const toml = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const api = toml.split(/^\[/m).find((s) => s.startsWith('api]'));
  assert.ok(api, 'an [api] section exists');
  const m = /^schemas\s*=\s*\[([^\]]*)\]/m.exec(api);
  assert.ok(m, 'api.schemas is set');
  const schemas = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual(schemas, ['graphql_public', 'public']);
});
