import { assertEquals } from 'jsr:@std/assert@1.0.13';
import { bearerMatches } from './bearer.ts';

Deno.test('FN-5: only the exact bearer key matches', async () => {
  const key = 'sb_secret_abcdef';
  assertEquals(await bearerMatches(`Bearer ${key}`, key), true);
  for (const h of [null, '', key, `bearer ${key}`, `Bearer ${key}x`, `Bearer ${key.slice(0, -1)}`, 'Bearer ', `Bearer  ${key}`]) {
    assertEquals(await bearerMatches(h, key), false, String(h));
  }
});

Deno.test('FN-5: an empty configured key never matches', async () => {
  assertEquals(await bearerMatches('Bearer ', ''), false);
  assertEquals(await bearerMatches(null, ''), false);
});
