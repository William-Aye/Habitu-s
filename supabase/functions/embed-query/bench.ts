// Usage: deno run -A bench.ts <function-url> <anon-or-user-jwt> [calls=50]
// Prints per-call latency, p50/p95 and error count. Run once for cold calls
// (after >= 15 min idle, calls=1, repeat 10 times) and once for warm (calls=50).
const [url, key, n = '50'] = Deno.args;
if (!url || !key) {
  console.error('usage: deno run -A bench.ts <url> <jwt> [calls]');
  Deno.exit(2);
}
const words = ['coder', 'jeu de go', 'danse bretonne', 'escalade', 'chorale', 'judo', 'théâtre', 'yoga'];
const times: number[] = [];
let errors = 0;
for (let i = 0; i < Number(n); i++) {
  // unique text each call so the cache is bypassed and the model is exercised
  const text = `${words[i % words.length]} ${Date.now()}${i}`.slice(0, 200);
  const t0 = performance.now();
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({ text }),
  });
  const body = await r.text();
  const ms = performance.now() - t0;
  if (!r.ok) {
    errors++;
    console.error(`call ${i}: HTTP ${r.status} ${body.slice(0, 200)}`);
  } else times.push(ms);
  console.log(`call ${i}: ${ms.toFixed(0)} ms`);
}
times.sort((a, b) => a - b);
const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))]?.toFixed(0);
console.log(`ok=${times.length} errors=${errors} p50=${pct(0.5)} ms p95=${pct(0.95)} ms max=${pct(1)} ms`);
