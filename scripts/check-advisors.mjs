// Fails when the Supabase security advisor reports a warning or error that is not in the allowlist.
// Usage: node scripts/check-advisors.mjs <advisors.json> <allowlist.json>
// Exit codes: 0 all issues allowed, 1 unexpected issue, 2 unusable input.
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

const [advisorsPath, allowlistPath] = process.argv.slice(2);
if (!advisorsPath || !allowlistPath) {
  fail('Usage: node scripts/check-advisors.mjs <advisors.json> <allowlist.json>');
}

const advisors = readJson(advisorsPath, 'advisors output');
if (advisors && !Array.isArray(advisors) && advisors._tag === 'Error') {
  fail(`The advisor CLI reported an error: ${advisors.message ?? JSON.stringify(advisors)}`);
}
// Real shape of `supabase db advisors --output-format json`: { results: [...], message }.
const issues = advisors?.results;
if (!Array.isArray(issues)) fail('Unexpected advisors output: expected { results: [...] }.');

const allowlist = readJson(allowlistPath, 'allowlist');
if (!Array.isArray(allowlist)) fail('The allowlist must be a JSON list.');
for (const [i, entry] of allowlist.entries()) {
  const ok = (v) => typeof v === 'string' && v.trim() !== '';
  if (!ok(entry?.name) || !ok(entry?.match)) fail(`Allowlist entry ${i} needs a name and a match.`);
  if (!ok(entry.reason)) fail(`Allowlist entry ${i} (${entry.name}) has no reason: every exception must be explained.`);
}

const text = (v) => (Array.isArray(v) ? v.join(' ') : String(v ?? ''));
const blocking = issues.filter((x) => ['WARN', 'ERROR'].includes(String(x?.level).toUpperCase()));
const unexpected = blocking.filter(
  (x) => !allowlist.some((a) => a.name === x.name && text(x.detail).includes(a.match)),
);

for (const x of unexpected) console.log(`${x.name}: ${text(x.detail)}`);
if (unexpected.length > 0) {
  console.log(`${unexpected.length} advisor issue(s) not in the allowlist.`);
  process.exit(1);
}
console.log(`Advisors OK (${blocking.length} allowlisted issue(s)).`);
