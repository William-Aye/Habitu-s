// AUTH-1/2/3 (pre-launch security review): the local Auth settings that harden sign-in. The hosted
// project does not read config.toml; README "Supabase Auth settings" lists the same values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const toml = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
function value(section, key) {
  const body = toml.split(/^\[/m).find((s) => s.startsWith(section + ']'));
  assert.ok(body, `[${section}] exists`);
  const m = new RegExp(String.raw`^${key}\s*=\s*(.+?)\s*(#.*)?$`, 'm').exec(body);
  assert.ok(m, `${section}.${key} is set`);
  return m[1].replace(/^"|"$/g, '');
}

test('the email code is 8 digits and expires after 10 minutes (AUTH-3)', () => {
  assert.equal(value('auth.email', 'otp_length'), '8');
  assert.equal(value('auth.email', 'otp_expiry'), '600');
});

test('verification and sign-in rate limits sit below the Supabase defaults (AUTH-3)', () => {
  assert.ok(Number(value('auth.rate_limit', 'token_verifications')) <= 10);
  assert.ok(Number(value('auth.rate_limit', 'sign_in_sign_ups')) <= 15);
  assert.ok(Number(value('auth.rate_limit', 'token_refresh')) < 150);
});

test('sign-up needs a confirmed address and a password change needs a recent sign-in (AUTH-1)', () => {
  assert.equal(value('auth.email', 'enable_confirmations'), 'true');
  assert.equal(value('auth.email', 'secure_password_change'), 'true');
});

test('the code templates carry the code and no link', () => {
  for (const name of ['confirmation', 'magic_link']) {
    const path = value(`auth.email.template.${name}`, 'content_path');
    const html = readFileSync(new URL(`../${path.replace(/^\.\//, '')}`, import.meta.url), 'utf8');
    assert.match(html, /\{\{ \.Token \}\}/);
    assert.doesNotMatch(html, /ConfirmationURL|href=/);
  }
});
