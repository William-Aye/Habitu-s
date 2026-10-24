# Public Web Pages (Sub-project 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every activity and association has a fast public web page with a readable address. Search engines index it, and WhatsApp/Instagram show a preview card for it. From a page, a visitor without the app can sign up lightly and say "Je serai là" in the browser. Shared links open the Android app when it's installed.

**Architecture:** Everything is hosted on **Cloudflare Pages**, which is free.
- **Public pages** (`/activites/<slug>`, `/associations/<slug>`, sitemaps, legal pages): server-rendered as small HTML pages by a **Pages Function** (a Cloudflare Worker, free up to 100,000 requests a day). It reads the existing public database functions with the public key. These pages need no JavaScript to read, and carry Open Graph tags and structured data.
- **The interactive part:** a **web build of the existing app** served under `/app/`, limited to a few screens: the activity page (join, "Je serai là", guest), the association page, sign-up and sign-in, and "Mes données". Native-only features get web versions or are hidden.
- **Security:** a `_headers` file sets the security headers from §18.5.
- **Android:** the app declares App Links, so `https://<domaine>/activites/…` opens it directly.

**Tech Stack:** Cloudflare Pages and Pages Functions (TypeScript, Workers runtime; tested with Deno); Expo Router web export (`react-native-web`); Supabase (existing public functions plus two new sitemap functions); Cloudflare Turnstile (web widget); Supabase Auth (email code and Google OAuth redirect on the web); pgTAP, Deno test, Jest.

**Spec:** `docs/specs/2026-10-21-friend-app-design.md`:
- §17 "Public web pages";
- §8 "Activity page" (shared links carry a preview card; opening without the app shows a web page);
- §8 "Club / association page";
- §14 Release 1 item 8;
- §18.5 (Cloudflare Pages, WAF, Bot Fight Mode, security headers);
- §18.7 (legal pages published on the website).

It builds on every plan in `docs/plans/`.

## Decisions for the owner to confirm

1. **A domain name.** Search engines and Android App Links need a stable address, for example `habitues.fr` if it's free (about €8–12 a year). Until it's bought, everything works on the free `*.pages.dev` address. The domain is one setting, `WEB_BASE_URL`. *Owner to confirm, and to pick the name.*
2. **Two parts, both free.** The fast public pages are server-rendered by a small Cloudflare Worker. The interactive part (sign up, "Je serai là") is the app's own web build under `/app/`. *Owner to confirm.*
3. **Web scope for this release.** The web has the activity page, association page, sign-up and sign-in, and "Mes données" (export, delete). There's no Explore, map search, chat, activity creation or admin on the web; those screens say "Disponible dans l'application" with a Play Store link. *Owner to confirm.*
4. **What the page shows.**
   - Activities: title, description, category, meeting-place label and town, recurrence, next session date, "{{n}} confirmés", and the organiser's first name. Participants' names and photos are never shown on the web pages.
   - Associations: name, purpose, **town only** (no street address, as the spec says for the web), website, the source label, and their activities.
   - Instead of an embedded map, a "Voir sur la carte" link opens OpenStreetMap. That's cheaper, and it adds no third-party script.
   - *Owner to confirm.*
5. **"Ajouter à mon agenda" on the web** downloads an `.ics` calendar file. *Owner to confirm.*
6. **What search engines see.**
   - Sitemaps list active activities and associations that are neither hidden (confidence < 20), dormant nor removed.
   - Every other page answers "not found" with `noindex`. Removed content answers "gone" (410).
   - Activity pages with an organiser-chosen "since joining" chat history are no different, since chat is never on the web.
   - *Owner to confirm.*
7. **Mentions légales.** French law (LCEN) requires the publisher's name and a way to contact them, plus the host (Cloudflare and Supabase). The page ships with placeholders that you fill in before launch. The CGU (terms of use) page also ships as a placeholder text for you, or a lawyer, to complete. *Owner to confirm.*
8. **Preview image.** All shared links use one generic Habitués image. There are no per-activity images and no image-generation cost. *Owner to confirm.*

## Global Constraints

- **Addresses.**
  - Activity: `/activites/<slug>-<uuid>`, where `slug` = the title, accent-stripped, lower-case, `[a-z0-9]+` joined by `-`, at most 60 characters.
  - Association: `/associations/<slug>-<uuid>`, where `slug` = name plus city, same rules.
  - The id is always the trailing UUID. A wrong or missing slug answers 301 to the canonical address.
  - The interactive app lives under `/app/activites/<uuid>` and `/app/associations/<uuid>`.
- **Indexing.**
  - Pages for archived or moderation-removed activities, and removed associations, answer 410 with `<meta name="robots" content="noindex">`.
  - Unknown ids, and hidden or dormant associations, answer 404 with `noindex`.
  - Everything else answers 200 with `<link rel="canonical">`.
- **Caching:** public pages are sent with `Cache-Control: public, s-maxage=300, max-age=60`. 404 and 410 answers use `s-maxage=60`.
- **Security headers (every response, via `_headers` and the Worker):**
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - **CSP for the public pages:** `default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. These pages carry no script.
  - **CSP for `/app/*`:** `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' <SUPABASE_URL> wss://<SUPABASE_HOST>; img-src 'self' data: blob: <SUPABASE_URL>; style-src 'self' 'unsafe-inline'; font-src 'self' data:; base-uri 'none'; frame-ancestors 'none'`. React Native Web needs inline styles.
- **Privacy:**
  - No third-party scripts or trackers apart from Turnstile on the sign-up forms.
  - No cookies on the public pages.
  - The Worker logs no IP addresses.
  - Participant identities are never on the web pages.
- **Escaping:** every database value is HTML-escaped. Values in JSON-LD are JSON-encoded inside a `<script type="application/ld+json">`, with `<` replaced by `<`. That's the one script-type element allowed; JSON-LD isn't executed, so `script-src 'none'` doesn't affect it.
- **Copy (French source, exact):**
  - Buttons and links: "Ouvrir dans l'application", "Télécharger l'application", "Je serai là", "Rejoindre l'activité", "Voir sur la carte", "Prochaine séance : {{date}}", "{{n}} confirmés", "Organisé par {{prenom}}", "Disponible dans l'application".
  - Not found: "Cette page n'existe pas ou n'est plus disponible."
  - Legal page titles: "Mentions légales", "Conditions d'utilisation", "Confidentialité".
  - Site name "Habitués" and tagline "Des activités régulières près de chez vous".
- **Code rules:** no hard-coded UI text in the app (i18n); the Worker's French copy lives in one `web/functions/_lib/copy.ts`. No emoji. Local Supabase on ports 553xx. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A title or description containing `<script>`, quotes, `</script>` or non-Latin Unicode** renders as text and never breaks the HTML or the JSON-LD. → tests in Task 2.
2. **The database is slow or down.** The Worker answers within 5 s with a plain "temporarily unavailable" page (503, `Retry-After: 60`), never a blank page or a stack trace. → test in Task 2.
3. **A visitor signs up on the web, then installs the app.** Same account, same session rules. The web stores the session in `localStorage` (no secure store on the web), and signing out clears it. → tests in Task 4.
4. **A shared link from an old app version** (`friendapp://activites/<id>` or `/activites/<uuid>` without a slug) still lands on the right page: the 301 to the canonical address, and the app router accepts both forms. → tests in Tasks 2 and 5.
5. **Search engines and preview bots on hidden, dormant, archived or removed content** get 404 or 410 with `noindex`, and the sitemaps never list them. → tests in Tasks 1 and 2.

---

## File Map

```
supabase/migrations/20261024000036_web_pages.sql      web_sitemap_activities, web_sitemap_associations, web_association_status
supabase/tests/30_web_pages.test.sql
web/functions/_lib/{copy.ts,html.ts,slug.ts,supabase.ts,pages.ts}     pure, Deno-tested
web/functions/activites/[[path]].ts, associations/[[path]].ts, sitemap.xml.ts, sitemaps/[n].ts, robots.txt.ts,
  mentions-legales.ts, conditions.ts, confidentialite.ts, index.ts
web/functions/_lib/*_test.ts
web/public/{_headers,_redirects,styles.css,og-default.png,.well-known/assetlinks.json}
web/build.mjs        expo export (web, baseUrl /app) into web/dist/app, then copy web/public
app/src/lib/platform/*.web.ts(x)   web shims; app/app.json (web output single + baseUrl, Android intentFilters)
app/src/features/activities/share.ts (slug links), app/src/lib/links.ts (parse slug or id)
```

---

### Task 1: Database functions for the web (sitemaps and status)

**Files:** Create `supabase/migrations/20261024000036_web_pages.sql` and `supabase/tests/30_web_pages.test.sql`.

**Interfaces:**
- Produces (all `security definer`, `search_path = public, pg_temp`, executable by `anon` and `authenticated`, read-only):
  - **`web_sitemap_activities(p_after uuid default null, p_limit int default 5000) returns table (id uuid, title text, updated_at timestamptz)`**
    - Returns activities that aren't archived and aren't removed by moderation.
    - The organiser must not be banned.
    - Ordered by id. `p_after` is a keyset cursor. `p_limit` is clamped to 1–50,000.
  - **`web_sitemap_associations(p_after uuid default null, p_limit int default 5000) returns table (id uuid, name text, city text, updated_at timestamptz)`**
    - Returns associations that aren't removed, aren't hidden (`search.is_hidden`) and aren't dormant (`search.is_dormant`), using the same arguments as `explore_rows`.
    - Same ordering, cursor and clamp as above.
  - **`web_association_status(p_id uuid) returns text`**
    - Returns `'ok'`, `'hidden'` (hidden or dormant), `'removed'` or `'missing'`.
  - **`web_activity_status(p_id uuid) returns text`**
    - Returns `'ok'`, `'removed'` (archived, moderation-removed, or banned organiser) or `'missing'`.
  - `updated_at`: use the table's column if it exists; otherwise `created_at`. Check the schema.
- [ ] **Step 1: Failing tests** (`30_web_pages`):
  - **Sitemaps:**
    - The activity sitemap lists a normal activity. It excludes an archived activity, a moderation-removed activity, and one whose organiser is banned.
    - The association sitemap excludes hidden, dormant and removed rows and includes a normal one.
    - Keyset paging with `p_after` returns the next rows with no overlap.
    - `p_limit` 0 is clamped to 1, and 100,000 is clamped to 50,000.
  - **Status functions:** each one returns every status value for a matching row.
  - **Access:** anon can execute all four functions. None of them returns any profile data.
- [ ] **Step 2: Run RED** (`npm run db:reset && npm run db:test`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run GREEN**, then `npm run db:types`.
- [ ] **Step 5: Commit** — `feat(db): sitemap and status functions for the public web pages`.

---

### Task 2: Server-rendered public pages (Cloudflare Pages Functions)

**Files:** Create `web/functions/_lib/{copy.ts,html.ts,slug.ts,supabase.ts,pages.ts}` with Deno tests `web/functions/_lib/{html,slug,pages}_test.ts`, plus the route files listed in the File Map, and `web/README.md`.

**Interfaces:**
- **Consumes:** `get_activity(p_id)` and `get_association(p_id)` (existing anon RPCs), plus Task 1's functions. All calls go through `POST <SUPABASE_URL>/rest/v1/rpc/<name>` with the `apikey` header. Env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `WEB_BASE_URL`, `PLAY_STORE_URL`.
- **Produces:**
  - `slugify(text: string, max = 60): string`.
  - `parseSlugId(path: string): { id: string | null; slug: string }`. The id is the trailing UUID; for an old link, the whole segment is a UUID.
  - `escapeHtml(s: string): string` and `jsonLd(obj): string`.
  - `renderActivityPage(a, base): string`, `renderAssociationPage(x, base): string`, `renderNotFound(status: 404 | 410): string`, `renderUnavailable(): string`.
  - `handleActivity(req, env, deps): Promise<Response>` and `handleAssociation(...)`, with `deps.rpc` injectable so tests never touch the network.
  - The route files only wire `onRequestGet` to these handlers.
- **Page content:**
  - **`<head>`:** `<title>` is "<titre> · Habitués"; meta description is the first 155 characters of the description; canonical link; Open Graph `og:title`, `og:description`, `og:url`, `og:image` (`/og-default.png`), `og:type` (`website`) and `og:locale` (`fr_FR`); Twitter summary card; JSON-LD.
    - Activities use an `Event` with `eventSchedule` / `startDate` for the next session, `location.name` = the place label, and `organizer.name` = the organiser's first name, or the association or collectif name.
    - Associations use an `Organization` with `address.addressLocality` = the city only.
  - **Body:** the facts from owner decision 4, then "Je serai là" / "Rejoindre l'activité" linking to `/app/activites/<uuid>`, "Ouvrir dans l'application", "Télécharger l'application" (Play Store) and "Voir sur la carte" (`https://www.openstreetmap.org/?mlat=..&mlon=..#map=17/..`). Activities use their meeting point; associations use the town point, rounded to 3 decimals.
- **Other routes:**
  - `sitemap.xml` is a sitemap index pointing at `sitemaps/a-<n>.xml` and `sitemaps/s-<n>.xml`, each holding at most 50,000 URLs and walked with the keyset.
  - `robots.txt` allows everything except `/app/`, and names the sitemap.
  - `/` is a short static home page: site name, tagline, Play Store link, legal links.
- **Errors:**
  - Any RPC error or timeout (`AbortSignal.timeout(5000)`) answers `renderUnavailable()` with 503 and `Retry-After: 60`.
  - Responses never include the error text.
- [ ] **Step 1: Failing Deno tests.**
  - **`slugify` and `parseSlugId`:**
    - `slugify("Jeu de go — le Mardi à Lyon!")` gives `jeu-de-go-le-mardi-a-lyon`.
    - The slug is capped at 60 characters, with no trailing `-`.
    - `parseSlugId` handles both `slug-<uuid>` and a bare `<uuid>`, and returns `null` for garbage.
  - **Escaping:** a title of `</script><script>alert(1)</script>"'&` appears escaped in `<title>`, in OG content and in the body. The JSON-LD contains `</script`, never `</script`.
  - **Activity handler:**
    - Status `ok`: 200, a canonical link, OG tags, "{{n}} confirmés", no participant name even when the fixture contains attendees, and the cache header.
    - Wrong slug: 301 to the canonical address.
    - Bare uuid: 301.
    - `removed`: 410 with `noindex`. `missing`: 404 with `noindex`.
    - An RPC that throws gives 503 with `Retry-After`. An RPC that hangs gives 503 after the timeout (use a fake timer or a short override).
  - **Association handler:** `hidden` gives 404 with `noindex`. The address shows the city only, never the street.
  - **Sitemaps:** the index lists the right number of child sitemaps for 120,001 associations at 50,000 per file, with the RPC mocked. The child sitemaps hold only `ok` rows, with `<lastmod>`.
  - **Headers:** every response carries the security headers and the public-page CSP.
- [ ] **Step 2: Run RED** (`npx --yes deno@2 test web/functions`).
- [ ] **Step 3: Implement.** Keep the handlers free of Cloudflare-only APIs, so Deno can test them.
- [ ] **Step 4: Run GREEN**, and delete `deno.lock` afterwards.
- [ ] **Step 5: Commit** — `feat(web): server-rendered activity and association pages, sitemaps and robots`.

---

### Task 3: Static assets, security headers, legal pages and the build

**Files:**
- Create:
  - `web/public/_headers`, `web/public/_redirects`, `web/public/styles.css` and `web/public/og-default.png`. The PNG is a 1200×630 plain image: the site name in large text on the accent colour, generated by a small script committed alongside it, or drawn with an SVG converted at build time. No external assets.
  - `web/public/.well-known/assetlinks.json.template`.
  - `web/functions/{mentions-legales,conditions,confidentialite}.ts`, rendering through `pages.ts`.
  - `web/build.mjs`.
- Modify `app/app.json` (web: `"output": "single"`, `experiments.baseUrl: "/app"`) and the root `package.json` (script `web:build`).

**Interfaces:**
- **Consumes:** `app/src/content/privacy.fr.ts`, imported by the Worker to render `/confidentialite`. Check that it's plain data with no React Native imports; if it isn't, extract the data into a shared module.
- **Produces:**
  - **`_headers`:** the security headers for `/*`, plus the `/app/*` CSP. `SUPABASE_URL` is filled in by `build.mjs` from an env var at build time.
  - **`_redirects`:** `/app/*` maps to `/app/index.html` with status 200 (SPA fallback).
  - **Legal pages:**
    - `/mentions-legales` has the publisher placeholders: "Éditeur : [NOM À COMPLÉTER]", "Contact : {{PRIVACY_CONTACT}}", "Hébergeur : Cloudflare, Inc. … ; données : Supabase (région UE)".
    - `/conditions` is a placeholder CGU text marked "[À COMPLÉTER AVANT LANCEMENT]".
    - `/confidentialite` renders the French privacy text.
  - **`assetlinks.json`:** generated by `build.mjs` from the env vars `ANDROID_PACKAGE` and `ANDROID_SHA256_CERT`. If they're missing, the build skips it with a warning.
  - **`web/build.mjs`:**
    1. Runs `npx expo export --platform web --output-dir ../web/dist/app` in `app/`.
    2. Copies `web/public/*` to `web/dist/`.
    3. Fills the templates.
    4. Fails if the export contains any reference to the service-role key name or `sb_secret_`.
- [ ] **Step 1: Failing tests.**
  - A Deno test parses `_headers` and asserts every required header and both CSPs. It also asserts that `/app/*` allows only `challenges.cloudflare.com` as a third-party origin.
  - A Deno test checks each legal page returns 200 with its title and placeholders, and that the privacy page contains the privacy text's first heading.
  - A Node test (`web/build.test.mjs`, run with `node --test`) runs `build.mjs` with a fake export directory and checks that the template filling works and that the secret check fails the build when a secret-like string is present.
- [ ] **Step 2: Run RED**, then **Step 3: Implement**, then **Step 4: Run GREEN**. Also run `npm run web:build` once for real. The export must succeed; it can only succeed once Task 4 is in, so if it fails because of native modules, note that in the report and leave the real build to Task 4.
- [ ] **Step 5: Commit** — `feat(web): security headers, legal pages, preview image and build`.

---

### Task 4: The app on the web (activity, association, sign-up, Mes données)

**Files:** Create web versions of the native modules (`*.web.ts(x)`, next to each native module or under `app/src/lib/platform/`), `app/src/app/+not-found.tsx` (if missing) and `app/__tests__/web-*.test.tsx`. Modify the root layout and tabs for web, `Turnstile` (web version), `auth.ts` (Google on the web), the session storage adapter, `calendar.ts` (web: `.ics` download) and the map components (web: OpenStreetMap link).

**Interfaces:**
- **Produces (new):** `buildIcs(session, activity, publicUrl): string` in `app/src/features/activities/ics.ts`, used by the web calendar shim.
- **Produces** — on `Platform.OS === 'web'`:
  - **Layout and navigation:**
    - The tab bar is hidden.
    - The root layout renders a slim header ("Habitués", a "Télécharger l'application" link) and the current route.
    - Explore, Messages, chat, creating an activity, collectifs and admin routes render a "Disponible dans l'application" screen with the Play Store link.
  - **Session storage:** `localStorage` through the Supabase `storage` option. Signing out clears it.
  - **Turnstile:** the web version loads `https://challenges.cloudflare.com/turnstile/v0/api.js` and renders the widget in a `div`. It keeps the same props and callbacks as the native component, including `action`.
  - **Google sign-in:** on the web it uses `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: <WEB_BASE_URL>/app/auth/callback } })`. A callback route finishes the session and returns to the page the visitor came from (stored in `sessionStorage`). Email code sign-in works unchanged.
  - **Calendar:** "Ajouter à mon agenda" downloads `habitues-<date>.ics` (`text/calendar`). It contains `SUMMARY`, `DTSTART` and `DTEND` (2 h) in UTC, `LOCATION` = the place label, and `URL` = the public page.
  - **Maps:** they render a "Voir sur la carte" link instead of MapLibre.
  - **Notifications:** registration and categories become no-ops. The push permission prompt never shows on the web.
  - **Sharing:** "Partager" uses `navigator.share` when it's available, otherwise it copies the link to the clipboard and shows "Lien copié".
- [ ] **Step 1: Failing Jest tests**, with `Platform.OS` mocked to `'web'` and the web versions resolved through moduleNameMapper or direct import:
  - The activity page renders, and "Je serai là" calls `setAttendance` after sign-in.
  - A signed-out visitor gets the sign-up sheet with the web Turnstile, which emits a token.
  - The `.ics` content is exact for a Paris DST date (UTC conversion).
  - Google on the web calls `signInWithOAuth` with the `redirectTo`.
  - The callback restores the return path.
  - Session storage uses `localStorage`, and signing out clears it.
  - Explore on the web shows "Disponible dans l'application".
  - No notification call happens on the web.
- [ ] **Step 2: Run RED**, then **Step 3: Implement**, then **Step 4: Run GREEN**: the full app suite, `tsc` and lint, then `npm run web:build`, which must succeed. Serve `web/dist` locally with `npx --yes wrangler@3 pages dev web/dist` (or any static server for `/app`), then load `/app/activites/<seeded id>` in the in-app browser and screenshot it. Report what was seen.
- [ ] **Step 5: Commit** — `feat(app): web build for activity and association pages, light sign-up and calendar file`.

---

### Task 5: Shared links, Android App Links and full check

**Files:**
- Create `app/src/lib/links.ts` and `app/__tests__/links.test.ts`.
- Modify `app/src/features/activities/share.ts` and every place that builds a share or public URL (grep `EXPO_PUBLIC_WEB_BASE_URL`), plus `app/app.json` (Android `intentFilters` with `autoVerify: true` for `https://<host>/activites/*` and `/associations/*`, the host taken from `EXPO_PUBLIC_WEB_BASE_URL` through `app.config.js`).
- Modify `README.md`, adding a "Public web pages" section.

**Interfaces:**
- **Produces:**
  - `activityUrl(id, title): string` returns `<WEB_BASE_URL>/activites/<slugify(title)>-<id>`, falling back to `friendapp://activites/<id>` when the env is empty. `associationUrl(id, name, city)` works the same way.
  - `idFromLink(url): {kind: 'activity' | 'association'; id: string} | null`. It accepts both address forms, the `friendapp://` scheme and `/app/...` paths.
  - The app's `slugify` must give exactly the same result as the Worker's. The tests check both against the same fixture list.
  - The expo-router `+native-intent` handler (or the equivalent in SDK 58) maps incoming `https://<host>/activites/<slug>-<uuid>` links to `/activites/<uuid>`.
  - **README "Public web pages":**
    - creating the Cloudflare Pages project and its build command (`npm run web:build`, output `web/dist`);
    - env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `WEB_BASE_URL`, `PLAY_STORE_URL`, `ANDROID_PACKAGE`, `ANDROID_SHA256_CERT`, and `EXPO_PUBLIC_*` for the app export;
    - the custom domain and DNS on Cloudflare, with WAF managed rules, Bot Fight Mode, rate limiting on `/app/*`, DNSSEC and always-HTTPS (§18.5);
    - Supabase Auth: add `<WEB_BASE_URL>/app/auth/callback` to the redirect URLs and the site URL; Google OAuth client for the web;
    - Turnstile: add the web hostname to the widget;
    - submitting the sitemap to Google Search Console;
    - before launch: fill in the mentions légales and CGU placeholders.
- [ ] **Step 1: Failing tests.**
  - The share URL uses the slug.
  - `idFromLink` handles all forms, and returns null for others.
  - The slug fixtures are identical between the app and the Worker: the Jest test reads the same JSON fixture as the Deno test.
  - The `app.config.js` intent filters are present when the env is set, checked with `npx expo config --json` in a test or a script assertion.
- [ ] **Step 2: Run RED**, then **Step 3: Implement**, then **Step 4: Run GREEN**.
- [ ] **Step 5: Run all suites:**
  - `npm run db:reset && npm run db:test`
  - `npx --yes deno@2 test supabase/functions web/functions` (delete `deno.lock` afterwards)
  - `cd importer && uv run pytest`
  - `cd app && npm test && npm run lint && npx tsc --noEmit`
  - `npm run web:build`
- [ ] **Step 6: Commit** — `feat(app): readable shared links, Android App Links; web setup guide`.

---

## Out of scope (owned elsewhere)

- Explore, map search, chat, activity creation and admin on the web: later, after launch.
- The iOS app and Universal Links: Release 2 item 16.
- Cloudflare account settings themselves (done by the owner from the README), the security review and the store listing: sub-project 9.
