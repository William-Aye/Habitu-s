# Habitués web

Public pages (server-rendered) and the interactive web app (under `/app/`).

## Layout

- `functions/` : Cloudflare Pages Functions (routes only, nothing test-only). Routes wire the request to handlers.
- `functions/app/[[path]].ts` : the single-page-app shell of `/app/*` (deep links), with its security headers.
- `src/` : all logic in plain TypeScript, no Cloudflare types, tested with Deno (`*_test.ts`). French copy is in `copy.ts`.
- `src/slug_fixtures.json` : slug cases shared with the app tests.
- `public/` : static files: `_headers` (static files), `_routes.json` (which paths run the Functions), `styles.css`, the preview image.

## Settings (environment variables)

| Name | Meaning |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL (local: `http://127.0.0.1:55321`) |
| `SUPABASE_ANON_KEY` | anon key |
| `WEB_BASE_URL` | public address, no trailing slash. Falls back to the request origin when unset |
| `PLAY_STORE_URL` | Play Store listing |
| `ANDROID_PACKAGE` | Android package for the open-in-app link (default `fr.friendapp.app`) |

For local runs put them in `web/.dev.vars` (git-ignored, next to this README), one `NAME=value` per line.

## Tests

```
npx --yes deno@2 test --allow-read=web/public web/src
rm -f deno.lock
```

The handlers take an injectable `deps.rpc`, so no test touches the network.

## Local development

Build first (from the repo root: `CI=1 SUPABASE_URL=http://127.0.0.1:55321 EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321 npm run web:build`, which writes `web/dist`), then:

```
cd web && npx --yes wrangler@4 pages dev dist
```

The site is on `http://127.0.0.1:8788`; set `WEB_BASE_URL=http://127.0.0.1:8788` in `.dev.vars`.

Start local Supabase first (`npm run db:start`) so the RPCs answer. Without it the pages answer 503 with `Retry-After: 60`, by design.

## Notes

- `/app/*`: `functions/app/[[path]].ts` returns the app shell (`/app/`) for any path that is not a file, and the file itself for `/app/_expo/*`, `/app/assets/*` and any path with an extension. It sets the security headers, a CSP built at runtime from `SUPABASE_URL` (`ws` or `wss` follows its scheme), `X-Robots-Tag: noindex` and `Cache-Control: no-cache`. `_routes.json` keeps the static files out of the Function (free plan: 100,000 invocations a day).
- Public pages carry no script (JSON-LD only) and no inline style: `styles.css` is served from `/styles.css`.
- Sitemaps: `/sitemap.xml` is static and lists `/sitemaps/a-0..15.xml` (activities, 16 buckets) and `/sitemaps/s-0..255.xml` (associations, 256 buckets, small files for the 10 ms CPU limit) split on the first bits of the random id; each file is one `web_sitemap_range(kind, bucket)` call; the database computes the bucket's id range and refuses any other bucket.
- Every route is wrapped in `withEdgeCache` (Cache API): 300 s pages, 3600 s sitemaps, 60 s for 404/410, never 503.
