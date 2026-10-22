# Friend App

Une application francaise pour se faire des amis grace a des activites recurrentes (Expo Android + Supabase).

## Prerequisites

- Node 22 LTS or newer
- Docker Desktop (running)
- Android Studio with an emulator (API 34+)
- Git

Directory import runbook: [importer/README.md](importer/README.md)

## Local database

```bash
npm install
npm run db:start   # start local Supabase
npm run db:reset   # apply migrations
npm run db:test    # run pgTAP tests
npm run db:types   # generate TypeScript types
```

## Local ports

The local Supabase stack uses ports in the 553xx range instead of the 543xx defaults, because Windows reserves TCP 54190-54589 (Hyper-V/WSL) and `supabase start` fails to bind there.

| Service | Port |
| --- | --- |
| API (use `http://127.0.0.1:55321`) | 55321 |
| Database | 55322 |
| Studio | 55323 |
| Inbucket (mail) | 55324 |
| Analytics | 55327 |
| Pooler | 55329 |
| Shadow database | 55320 |

## Accounts

Browsing, searching and choosing interests need no account. People sign in only when an
action needs one: with Google (native Android sign-in) or with a 6-digit code sent by e-mail.
Sign-up asks for a first name and an 18+ confirmation, nothing else.

### Environment variables

| Name | Where | Value |
| --- | --- | --- |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | `app/.env` (copy from `app/.env.example`) | Google OAuth **Web** client id |
| `EXPO_PUBLIC_TURNSTILE_SITE_KEY` | `app/.env` | Cloudflare Turnstile site key |
| `GOOGLE_WEB_CLIENT_ID` | environment read by `supabase/config.toml` (`env(...)`) | same Web client id |
| `GOOGLE_WEB_CLIENT_SECRET` | environment read by `supabase/config.toml` (`env(...)`) | Web client secret |
| Turnstile secret key | Supabase dashboard only, never in the repo | Cloudflare Turnstile secret key |

### 1. Google sign-in (free, no billing account)

1. Create a Google Cloud project.
2. Configure the OAuth consent screen: app name "Habitués", support e-mail set to yours.
3. Create a **Web** OAuth client id. In Supabase, go to Authentication → Providers → Google and
   enter this client id and its secret. Turn on **Skip nonce check** (the native Android sign-in
   sends a nonce Supabase cannot check; `supabase/config.toml` already sets it).
4. Create an **Android** OAuth client id with package name `fr.friendapp.app` and the SHA-1
   fingerprint of the signing key. For local builds, run `npx expo prebuild` in `app/`, then
   `cd android && ./gradlew signingReport` and copy the SHA-1 of the debug variant. Add the
   Google Play signing SHA-1 as well before release.
5. Put the Web client id in `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (`app/.env`).
6. Before any iOS build, replace the placeholder
   `com.googleusercontent.apps.REPLACE_WITH_IOS_CLIENT_ID` in `app/app.json` (the
   `iosUrlScheme` of the google-signin plugin) with the real iOS client's reversed id.

### 2. Cloudflare Turnstile (free)

1. In the Cloudflare dashboard, open Turnstile and add a widget. Choose the widget mode
   **Invisible** (this is a property of the site key, not a code option).
2. Allowed domains: add your app domain (`habitues.app`, or the domain you chose) and
   `challenges.cloudflare.com`. The app's Turnstile WebView loads its page from
   `https://challenges.cloudflare.com` (`BASE_URL` in `app/src/features/account/Turnstile.tsx`),
   and the code expects that hostname to be allowed for the site key.
3. Put the site key in `EXPO_PUBLIC_TURNSTILE_SITE_KEY` (`app/.env`).
4. Put the secret key in the Supabase dashboard: Authentication → Attack protection → CAPTCHA,
   provider Turnstile. The secret never goes in the repo or in the app.

### 3. Supabase Auth settings (dashboard)

- Email OTP: length **6**, expiry **3600** seconds.
- Email template, French, no link: subject and body containing `Votre code Habitués : {{ .Token }}`.
- Rate limit: **4 e-mails per hour per address**.
- Refresh-token rotation: **on**.
- Custom SMTP: strongly recommended before launch. Supabase's built-in e-mail sender allows only
  a few e-mails per hour. Choosing the provider is a launch step.

### 4. Local development

- CAPTCHA is **disabled** in `supabase/config.toml` (`[auth.captcha] enabled = false`). If it is
  enabled without a secret, local e-mail sign-in is rejected. Keep `EXPO_PUBLIC_TURNSTILE_SITE_KEY`
  empty locally: the app then skips the challenge and sends an empty token.
- Local e-mail codes do not leave your machine. Open the local mail viewer (Inbucket) at
  `http://127.0.0.1:55324` to read them.
- Google sign-in does not work locally until `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and the Supabase
  Google secrets are set. The e-mail code path works without them.

### 5. Before publication

- Privacy policy (`app/src/content/privacy.fr.ts` and `privacy.en.ts`):
  - Remove the "(dès que cette fonctionnalité sera disponible)" marker from a sentence only when the
    feature it describes is built. Those sentences describe features that do not exist yet.
  - Replace the placeholder `confidentialite@<domaine>` with the real contact address.
  - Have a qualified person check the text before it is published.

## Search

Search combines keyword matching with semantic ranking. The semantic side needs an
embedding for the user's query; the database finds it in the query vocabulary
(`search.query_vocab`) instead of calling an embedding service at request time.

### How a query gets its meaning

`search.resolve_query` normalises the query and tries, in order (first match wins):

1. **exact**: the query's tokens joined by single spaces are a vocabulary phrase
   ("cours d'escalade" is stored and matched as "cours d escalade").
2. **fuzzy**: typo tolerance. Only for queries of at least 4 characters with at least one
   non-stop-word that is not a vocabulary word (a likely typo: "cours de jazz" stays itself
   rather than becoming "cours de judo"); among the 5 phrases closest by trigram, the most
   similar one (at least 0.5) with the same number of words ("escalde" finds "escalade").
3. **words**: the single most specific known phrase inside the query (most tokens, then the
   rarest), used only if the known words cover at least 50 % of the query's non-stop-word
   tokens. Averaging vectors was dropped: e5 vectors share a large common component.
4. **none**: keyword-only search, as before.

The response field `query_match` says which one applied. A `p_query_embedding` passed by a
caller wins over all of these.

### Vocabulary builds

Both jobs run `python -m importer vocab` and use the same model as documents
(`intfloat/multilingual-e5-small`, rows tagged `e5-small-v1`). The build commits only at the
end, so a failure leaves the previous vocabulary in place (and fails the job).

- **Monthly** (`import.yml`, 5th, after the association import): full build from all
  associations (names, categories, words) plus user requests. Estimate: 30-60 minutes on a 4 vCPU
  runner (public repositories); a private repository's standard runner has 2 vCPU and 7 GB, so
  expect roughly twice that, 60-120 minutes. The build is a separate job (`vocab`, needs
  `import`, 180 minute limit; a full build started by hand from `vocab.yml` has the same limit). If it fails, the monthly import run is marked failed although the imported data is
  committed; the previous vocabulary stays in place.
- **Nightly** (`vocab.yml`, 02:17 UTC): `--requests-only`, adds the anonymised phrases users
  searched that the vocabulary did not already understand (exact and fuzzy matches are not
  logged). A phrase is learned only after it was searched on at least two different days
  (`vocab_request_min_hits`; repeats on the same day count once). A phrase with 6 or more digits
  in total is never stored. At most 2,000 requests are promoted per run (most days, then most
  recently seen); the rest wait for a later night. Promoted requests count against the
  150,000-phrase cap right after the curated phrases; a full build removes one that no
  association text contains once it is a year old. Estimate: about 3 minutes (mostly setup).
- **Manual**: Actions, "Query vocabulary", Run workflow; tick `full` for a full build.
  `vocab.yml` shares the `import` concurrency group, so it never runs alongside an import.

Measured on 150,000 synthetic associations with the fake embedder: counting 21.7 s, first
build 79.8 s, rebuild 23.5 s, peak memory 123 MB, temporary disk 138 MB (about 1.4 GB at
1.5 M associations, an extrapolation). The real e5 model embeds roughly 5 times slower than the fake
one (an estimate). All timings here assume a 4 vCPU runner; on 2 vCPU expect about double.

### Coverage report and adding a phrase

The command prints a JSON build report whose `coverage` gives the `resolve_query` method of
every phrase of `importer/importer/data/vocab_watchlist.txt`. Watch-list phrases are always
stored, so each should resolve `exact`: the report is a canary for drift between the builder's
normalisation (`importer/importer/vocab.py`, `embed.py`) and the database's
(`search.normalise_query`, `search.tokens`, `search.resolve_query`). Any other method is
printed as a warning on stderr in the job log; compare `vocab.unit_phrase(phrase)` with
`select array_to_string(search.tokens(search.normalise_query(phrase)), ' ')` and run the
shared normalisation tests (`shared/normalise_cases.json`).

To make sure a phrase is always in the vocabulary, append it to `vocab_watchlist.txt` (one per
line), merge, then run `vocab.yml` by hand (a nightly run also picks it up).

Size check (expected about 262 MB at the 150,000 cap):

```sql
select pg_size_pretty(pg_total_relation_size('search.query_vocab'));
```

### Costs

EUR 0 extra: no new account, card or secret. Supabase Pro is already paid (the vocabulary
fits in it). GitHub Actions minutes: private repositories get 2,000 free minutes a month
(on 2 vCPU runners; public repositories are not billed). The vocabulary uses about 90 a month
for the nightly runs (about 3 minutes each, estimate) and 60-120 for the monthly build on 2 vCPU
(estimate). The same budget also pays for the monthly association import (`import.yml`, up to
its 350 minute limit) and every CI run, including the search ranking job (up to 45 minutes per
push or pull request): check the repository's usage page if pushes are frequent, as these, not
the vocabulary, decide whether the free tier holds.

Upgrade path: a live embedding service can be added later and pass `p_query_embedding`; no
database change is needed.

### First run

After deploying migrations 007 and 008 to the hosted project, trigger `import.yml` once (it
builds the vocabulary after the import), or run `vocab.yml` with `full` ticked to build it
without an import. Until then queries fall back to keyword-only search.

### Ranking rule

Change `search.params()` only together with a green ranking run:

```bash
cd importer && RANKING_REPORT=1 uv run pytest -m ranking -s
```

`RANKING_REPORT=1` prints per-query diagnostics (ranks and scores) so a parameter change
can be judged, not just pass/fail. CI runs the same job (`ranking`).

### Checks

- Perf (local only, not in CI): `cd importer && uv run pytest -m perf -s` (150k associations
  near Paris, document vectors clustered around cosine 0.8 to the query direction; target p95
  < 1.5 s). Last measured on a local PG16 (4 cores), 2026-10-22: radius 50 with an unrelated
  query p95 971 ms; radius 10 with the widen count over 50 km p95 895 ms.

### Hosted migration note

Adding the stored generated columns rewrites the `associations` table (about 1.5M rows)
under an ACCESS EXCLUSIVE lock. Apply that migration outside import runs.

### Map attribution

The map uses the OpenFreeMap style (`https://tiles.openfreemap.org/styles/liberty`).
Keep its attribution (OpenMapTiles, OpenStreetMap contributors) visible on every map.
