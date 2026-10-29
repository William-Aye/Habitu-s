// AUTH-1/2/3 (pre-launch security review): checks the running LOCAL stack (`npx supabase start`).
// Passwords must be unusable, an email code is 8 digits, and a password sign-up gets no session and
// no "already registered" answer. Run: node scripts/auth-live.mjs  (CI runs it after supabase start.)
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';

const env = Object.fromEntries(
  execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n')
    .map((l) => /^([A-Z_]+)="(.*)"$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const API = env.API_URL;
const MAIL = env.INBUCKET_URL ?? env.MAILPIT_URL;
const anon = { apikey: env.ANON_KEY, 'content-type': 'application/json' };
const admin = { apikey: env.SERVICE_ROLE_KEY, authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, 'content-type': 'application/json' };
const post = (path, body, headers = anon) =>
  fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

const stamp = Date.now();
const pw = 'Correct-horse-9';

// 1. Password sign-up: no session, and the same answer for a new and an existing address.
const mail1 = `live-${stamp}-a@test.local`;
const s1 = await post('/auth/v1/signup', { email: mail1, password: pw });
assert.equal(s1.status, 200, 'sign-up answers 200');
assert.equal(s1.body.access_token, undefined, 'AUTH-1: a password sign-up gets no session');
const s2 = await post('/auth/v1/signup', { email: mail1, password: pw });
assert.notEqual(s2.body.error_code, 'user_already_exists', 'AUTH-1: no account-existence leak on /signup');
assert.equal(s2.body.access_token, undefined);

// 2. Even once the address is confirmed (as the real owner would by email code), the attacker's
//    password does not work (AUTH-2).
const id = s1.body.id ?? s1.body.user?.id;
assert.ok(id, 'the sign-up returned a user id');
const up = await fetch(`${API}/auth/v1/admin/users/${id}`, { method: 'PUT', headers: admin, body: JSON.stringify({ email_confirm: true, password: pw }) });
assert.equal(up.status, 200);
const login = await post('/auth/v1/token?grant_type=password', { email: mail1, password: pw });
assert.equal(login.status, 400, 'AUTH-2: grant_type=password fails for a password set at sign-up or by admin');
assert.equal(login.body.error_code, 'invalid_credentials');

// 3. Email code: 8 digits, and it gives a session; setting a password from that session changes nothing.
const mail2 = `live-${stamp}-b@test.local`;
const otp = await post('/auth/v1/otp', { email: mail2, create_user: true });
assert.equal(otp.status, 200);
let code;
for (let i = 0; i < 20 && !code; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const list = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + mail2)}`).then((r) => r.json());
  const m = list.messages?.[0];
  if (m) {
    const full = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((r) => r.json());
    code = /(\d{6,})/.exec(full.Text ?? '')?.[1];
  }
}
assert.ok(code, 'a code mail arrived');
assert.equal(code.length, 8, 'AUTH-3: the email code has 8 digits');
const ver = await post('/auth/v1/verify', { type: 'email', email: mail2, token: code });
assert.equal(ver.status, 200, 'the code signs the person in');
const set = await fetch(`${API}/auth/v1/user`, { method: 'PUT', headers: { ...anon, authorization: `Bearer ${ver.body.access_token}` }, body: JSON.stringify({ password: pw }) });
void set; // whether GoTrue answers 200 or refuses does not matter: the hash is dropped.
const login2 = await post('/auth/v1/token?grant_type=password', { email: mail2, password: pw });
assert.equal(login2.status, 400, 'AUTH-1: a password set from a live session cannot be used to sign in');

// Clean up.
for (const uid of [id, ver.body.user?.id].filter(Boolean)) await fetch(`${API}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: admin });
console.log('auth-live: ok');
