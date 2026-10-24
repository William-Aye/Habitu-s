# Habitués web

Public pages (server-rendered) and the interactive web app (under `/app/`).

## Layout

- `functions/` : Cloudflare Pages Functions. Routes only wire `onRequestGet` to handlers.
- `functions/_lib/` : all logic in plain TypeScript, no Cloudflare types, tested with Deno. French copy is in `copy.ts`.
- `functions/_lib/slug_fixtures.json` : slug cases shared with the app tests.

## Settings (environment variables)

| Name | Meaning |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL (local: `http://127.0.0.1:55321`) |
| `SUPABASE_ANON_KEY` | anon key |
| `WEB_BASE_URL` | public address, no trailing slash. Defaults to a `*.pages.dev` placeholder until a domain is chosen |
| `PLAY_STORE_URL` | Play Store listing |

For local runs put them in `web/.dev.vars` (git-ignored), one `NAME=value` per line.

## Tests

```
npx --yes deno@2 test web/functions
rm -f deno.lock
```

The handlers take an injectable `deps.rpc`, so no test touches the network.

## Local development

Once the build exists (`web/dist`):

```
npx --yes wrangler@3 pages dev web/dist
```

Start local Supabase first (`npm run db:start`) so the RPCs answer. Without it the pages answer 503 with `Retry-After: 60`, by design.

## Notes

- Public pages carry no script (JSON-LD only) and no inline style: `styles.css` is served from `/styles.css`.
- Sitemaps: `/sitemap.xml` indexes `/sitemaps/a-<n>.xml` (activities) and `/sitemaps/s-<n>.xml` (associations), 50,000 URLs each.
