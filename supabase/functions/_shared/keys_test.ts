import { assertEquals } from 'jsr:@std/assert@1.0.13';
import { cronBearer, serverKey } from './keys.ts';

const env = (vars: Record<string, string>) => (name: string) => vars[name];

Deno.test('the default new secret key wins over the legacy key', () => {
  assertEquals(
    serverKey(env({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_a","other":"sb_secret_b"}', SUPABASE_SERVICE_ROLE_KEY: 'legacy' })),
    'sb_secret_a',
  );
});

Deno.test('falls back to the legacy key when the new one is missing or unusable', () => {
  assertEquals(serverKey(env({ SUPABASE_SERVICE_ROLE_KEY: 'legacy' })), 'legacy');
  for (const raw of ['not json', '{}', '{"default":""}', '{"default":42}', '[]']) {
    assertEquals(serverKey(env({ SUPABASE_SECRET_KEYS: raw, SUPABASE_SERVICE_ROLE_KEY: 'legacy' })), 'legacy', raw);
  }
});

Deno.test('no key at all gives an empty string, which never matches a bearer', () => {
  assertEquals(serverKey(env({})), '');
});

Deno.test('TM-6: CRON_SECRET replaces the server key as the cron bearer once it is set', () => {
  const long = 'c'.repeat(40);
  assertEquals(cronBearer(env({ CRON_SECRET: long, SUPABASE_SECRET_KEYS: '{"default":"sb_secret_a"}' })), long);
  assertEquals(cronBearer(env({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_a"}' })), 'sb_secret_a');
  assertEquals(cronBearer(env({ CRON_SECRET: '', SUPABASE_SECRET_KEYS: '{"default":"sb_secret_a"}' })), 'sb_secret_a');
});

Deno.test('TM-6: a short CRON_SECRET refuses every call instead of falling back', () => {
  assertEquals(cronBearer(env({ CRON_SECRET: 'short', SUPABASE_SECRET_KEYS: '{"default":"sb_secret_a"}' })), '');
});
