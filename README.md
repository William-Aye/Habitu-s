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
action needs one: with Google (native Android sign-in) or with an 8-digit code sent by e-mail.
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
   sends a nonce Supabase cannot check; `supabase/config.toml` already sets it). This is accepted
   (review finding AUTH-6): `@react-native-google-signin/google-signin` 16.1.5 has no nonce option
   (custom nonces exist only in its paid "Universal" edition). A stolen Google ID token could be replayed
   until it expires (about an hour), but Google only issues one for the app's Web client id to an Android
   app registered with the package name and SHA-1 of step 4. Revisit if the Credential Manager API is adopted.
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

`supabase/config.toml` only configures the local stack. The hosted project does not read it, so every
setting below must be set by hand in the dashboard (Authentication) and checked again before launch.

**Sign-in by e-mail code only (review findings AUTH-1, AUTH-2, AUTH-3).** The spec says "Passwords: none",
but GoTrue has no switch that turns passwords off while the e-mail provider is on. Two things carry the
rule instead:

- Migration `20261029000048_auth_hardening.sql` adds a trigger on `auth.users` that empties
  `encrypted_password` on every insert and update. A password can be sent to `/signup` or `PUT /user`, but
  it is never stored, so `grant_type=password` can never succeed and a password registered in advance for
  somebody else's address is gone before that person signs up. It is applied by `supabase db push`, like
  any migration. `node scripts/auth-live.mjs` checks it against a running local stack.
- **Confirm email: ON** (Sign In / Providers, Email). A password sign-up then gets no session, and
  `/signup` answers the same for an address that already has an account (no existence leak).
  **Secure password change: ON** as well.

Then set:

- **Email OTP length: 8**, **Email OTP expiry: 600** seconds (10 minutes). The code is a short secret that
  `/verify` accepts from any IP and that wrong guesses do not invalidate, so a short life and 8 digits keep
  a distributed guess hopeless. The app's code field is 8 digits.
- Email templates, French, no link: BOTH the **Magic Link** template (existing users) and the
  **Confirm signup** template (new users) must contain `{{ .Token }}`. Use the text
  `Votre code Habitués : {{ .Token }}` and no link in either, otherwise new users receive a link
  instead of a code. (`supabase/templates/code.html` does the same locally.)
- **Rate limits** (Authentication, Rate Limits), below the defaults like `config.toml`: token verifications
  **10** per 5 minutes per IP, sign-ups and sign-ins **15**, token refreshes **100**.
  Supabase's e-mail rate limit is **per project per hour**, not per address. Set it to what your SMTP
  provider allows. Per-address throttling is `max_frequency` (**60 s** between two e-mails to the same
  address, already in `config.toml`).
- **Allow new users to sign up: ON** (the e-mail code creates accounts). **Anonymous sign-ins: OFF**.
  **Manual linking: OFF**. **Secure email change: ON** (`double_confirm_changes`). **Phone** provider
  sign-up: OFF, and MFA by phone: OFF. Only the **Google** external provider is on.
- **JWT expiry: 3600** seconds or less (it bounds how long a banned person's token keeps working, AUTH-4).
  **Refresh-token rotation: ON**, **reuse interval: 10** seconds.
- **CAPTCHA** (Attack Protection): Turnstile, with the secret key (see section 2). Review finding WEB-8:
  the app sends the Turnstile token with every e-mail code request, but Supabase ignores it unless CAPTCHA
  is switched on here. After deploying, call `POST <SUPABASE_URL>/auth/v1/otp` with the anon key and no
  `captcha_token`, and expect a `captcha` error. Google sign-in and `/verify` are not covered by Turnstile
  (Supabase only checks it on the e-mail code request and password grants). That is accepted (AUTH-7):
  Google limits its own account creation, and `/verify` is bounded by the code rules above and the
  per-IP verification limit.
- **MFA TOTP**: enrolment and verification ON (see "Making the first admin").
- **Redirect URLs**: exact addresses only, no wildcard (see "Web deployment", Supabase Auth).
- Custom SMTP: strongly recommended before launch. Supabase's built-in e-mail sender allows only
  a few e-mails per hour. Choosing the provider is a launch step.

### 4. Local development

- CAPTCHA is **disabled** in `supabase/config.toml` (`[auth.captcha] enabled = false`). If it is
  enabled without a secret, local e-mail sign-in is rejected. Keep `EXPO_PUBLIC_TURNSTILE_SITE_KEY`
  empty locally: the app then skips the challenge and sends an empty token.
- `supabase/config.toml` limits e-mails to `email_sent` per hour for the whole local project. It was
  `2`, which blocks testing after two codes; it is raised to **10** for local use only (never copy
  this value to the hosted project).
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

## Activities and notifications

Activities, sessions, collectifs and push notifications need a few one-time setups. Everything
below is free (Firebase and Expo's push service need no card).

### Firebase and `google-services.json` (Android push)

1. Create a Firebase project (console.firebase.google.com) and add an Android app with the package
   name `fr.friendapp.app`.
2. Download `google-services.json` from the Firebase console into `app/google-services.json`
   before any Android build. The file is **gitignored on purpose**: the repository is public, so it
   is never committed.
3. EAS cloud builds do not see local ignored files. Upload the file as an EAS **file** secret
   (an environment variable of type file) named `GOOGLE_SERVICES_JSON`:

   ```bash
   cd app
   npx eas-cli env:create --name GOOGLE_SERVICES_JSON --type file --visibility secret --environment production --value ./google-services.json
   ```

   (repeat for the `preview`/`development` environments you build). `app/app.config.js` reads
   that variable and falls back to `./google-services.json` for local builds.

### Expo push credentials

```bash
cd app
npx eas-cli init            # creates the EAS project and sets extra.eas.projectId in app config
npx eas-cli credentials     # Android > production > Google Service Account > FCM V1: upload the key
```

The FCM V1 key is a service-account JSON generated in the Firebase console (Project settings >
Service accounts > Generate new private key). Keep it out of the repository. Without
`extra.eas.projectId` the app cannot get a push token; it then simply skips registration.

### Database secrets and the `send-push` function

The `drain-outbox` job wakes the `send-push` Edge Function using two Vault secrets
(see `supabase/migrations/20261023000012_notifications.sql`). While either is missing the job does
nothing, so local runs never fail. Set them in the SQL editor of the hosted project:

```sql
select vault.create_secret('<service-role key>', 'send_push_key');
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/send-push', 'send_push_url');
```

`send_push_key` **must equal the project's service-role key** (the function checks it as the bearer
token). Locally the URL is `http://host.docker.internal:55321/functions/v1/send-push`. To change a
secret later, update the existing Vault row instead of creating a second one.

Deploy the function:

```bash
npx supabase functions deploy send-push
```

### Scheduled jobs (pg_cron)

Created by the migrations; nothing to schedule by hand:

| Job | When | What |
| --- | --- | --- |
| `extend-sessions` | daily 02:30 | extends every non-archived activity's sessions to 8 weeks ahead |
| `enqueue-reminders` | every 15 minutes | queues the day-before reminder (18:00 Paris) |
| `drain-outbox` | every minute | sends queued notifications through `send-push` |
| `prune-outbox` | daily 03:45 | deletes sent or failed notifications older than 30 days |

### Share links

`EXPO_PUBLIC_WEB_BASE_URL` (in `app/.env`, see `app/.env.example`) is the public website address.
Shared links are readable: `EXPO_PUBLIC_WEB_BASE_URL/activites/<slug>-<uuid>` (and `/associations/...`),
built by `app/src/lib/links.ts`. Without it the app falls back to `friendapp://activites/<id>`.
See "Public web pages" below.

### Finding new activities by meaning

New activities and collectifs are found by keywords at once. Their meaning vector is computed by
the `embed-activities` step of the nightly `vocab.yml` GitHub workflow
(`python -m importer embed-activities`, needs the `IMPORTER_DB_URL` secret), so they are found by
meaning from the next morning. To run it by hand:
`uv run --project importer python -m importer embed-activities --db-url "$IMPORTER_DB_URL"`.

### Group chat

Each activity has a text-only discussion for its organiser and members (Messages tab, and the
"Discussion" button on the activity page).

- **Realtime is a signal only.** An open discussion listens to Supabase Realtime for new rows
  (INSERT only), then re-reads through the `chat_messages` RPC, so access and blocks stay enforced
  in the database. Deletions are not subscribed to (a DELETE event cannot be filtered by activity):
  your own deletion disappears at once, other people's on the next re-read (a new message, the
  screen or the app coming back). The channel is closed while the app is in the background, and
  nothing is marked read there. The free tier allows 200 simultaneous connections and 2 million Realtime messages a
  month; past that, live updates stop but the discussion still refreshes when reopened.
- **Retention:** messages are kept 12 months. The nightly pg_cron job `prune-messages` (04:10)
  deletes older ones.
- **Rate limit:** 30 messages per user per rolling minute (admins exempt); beyond it the send is
  refused with `limit_reached`. It counts the insert-only `chat_send_log` table, so deleting
  messages does not free any; `prune_messages` clears log rows older than an hour. pg_cron runs in
  UTC: the 04:10 prune is 05:10 or 06:10 in Paris.
- **Notifications** are discreet ("Nouveau message", no names or text): at most one per
  discussion every 15 minutes per person, none if the discussion was read in the last 2 minutes,
  and none when the person muted it ("Couper les notifications"). A tap opens the discussion.
- **Offline outbox:** unsent messages are kept on the phone under the sender's account, sent in
  order when the network returns (also after a restart), and marked as failed, not retried
  forever, if refused for good. Each message has a client-made id, so a retry never duplicates it.
- **TODO (device check):** the composer adds the bottom safe-area inset to its padding. Check the
  keyboard behaviour on a real Android device (edge-to-edge), where the inset and the keyboard
  height may both apply.

## Safety and moderation

Reporting, blocking, moderation decisions, the word filter, feedback, association claims, retention
and the admin area. Admin rights need a second factor (see below); everything else works for any
signed-in person.

Moderation and the web cache: a public page that moderation removes can stay visible for up to 5 minutes
(the edge cache, `s-maxage=300`); this delay is accepted.

### Making the first admin

There is no sign-up path to the admin role. Promote an account in the SQL editor (the person must
have signed up first):

```sql
update public.profiles set role = 'admin' where id = '<user id>';
```

Review finding AUTH-9 (accepted, with a procedure): the app only offers the authenticator enrolment inside
Administration, so it can only happen after the promotion. Until the first factor is verified, anyone holding
that person's session (a stolen e-mail code, a shared phone) could enrol their own authenticator. Keep the
window to minutes: promote while the future admin is ready with their phone, have them enrol straight away,
then check in the SQL editor that exactly one factor exists and that it is theirs
(`select user_id, friendly_name, status, created_at from auth.mfa_factors where user_id = '<user id>';`).
If anything unexpected shows, delete the factor and set `role = 'user'` again. Once a factor is verified,
GoTrue refuses a second enrolment, or removing it, from a session that has not passed the second factor.

Then open the app, Profil, Administration. Without a second factor the screen asks for
enrolment ("Activer la double authentification"): scan the QR code in an authenticator app (TOTP)
and enter the 6-digit code. Until a code has been entered in the current session `is_admin()` is
false (the token must be `aal2`), so every admin right stays off and the app shows no admin data.
Admins cannot ban other admins; demote first with the same update (`role = 'user'`).

**Two-factor sign-in in the hosted project.** `supabase/config.toml` enables TOTP for the local stack
(`[auth.mfa.totp]`). In the hosted dashboard (Authentication, Multi-Factor, or Sign In / Providers),
check that TOTP enrolment and verification are enabled before promoting anyone: with TOTP off, no
admin can ever reach `aal2` and the admin area stays locked. Enrol the authenticator app right after
being promoted to admin (the first sign-in to Administration asks for it).

### Deploying the functions and their secrets

```bash
npx supabase functions deploy submit-feedback
npx supabase functions deploy storage-cleanup
```

- **`submit-feedback`** (anonymous feedback). Set `TURNSTILE_SECRET` (the Cloudflare Turnstile
  secret key of the widget used by the app) as a function secret:
  `npx supabase secrets set TURNSTILE_SECRET=<secret>`. Without it the function refuses every
  anonymous send. The Turnstile widget in the app must be rendered with the action `feedback`; a
  token minted for another action is rejected. Signed-in senders do not need Turnstile.
- **`storage-cleanup`** (deletes files queued in `storage_deletions`). The pg_cron job
  `storage-cleanup` calls it every 10 minutes through pg_net, using two Vault secrets (the first is
  shared with `send-push`, see above):

  ```sql
  select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/storage-cleanup', 'storage_cleanup_url');
  ```

  Until `storage_cleanup_url` exists the job does nothing, so queued files stay in Storage; locally
  nothing needs setting.
- **Keys and `verify_jwt`.** `send-push` and `storage-cleanup` are called by the database jobs with the
  Vault key (`send_push_key`, the service-role key) as bearer token, and compare it with the
  `SUPABASE_SERVICE_ROLE_KEY` that Supabase injects into every function. `submit-feedback` is called
  by the app with the public (anon/publishable) key, optionally with the user's session token, and
  uses `SUPABASE_SERVICE_ROLE_KEY` only to write the row. If the project uses the new
  `sb_secret_...` API keys, those are not JWTs: test the cron calls (`send-push`, `storage-cleanup`)
  and an anonymous and a signed-in call to `submit-feedback` after deploying, and, if the gateway
  answers 401 to the cron calls, deploy those two with `--no-verify-jwt` (they check their own
  credentials).

### Storage buckets

Created by the migrations, all private except avatars:

| Bucket | Content | Rules |
| --- | --- | --- |
| `avatars` | profile photos | public read, owner writes into their own folder |
| `claim-documents` | proof for association claims (PDF, JPEG, PNG, 10 MB) | owner uploads into their own folder, only admins read |
| `feedback-screenshots` | screenshots attached to feedback (JPEG, PNG, WebP, 5 MB) | signed-in senders only, only admins read |

Files are only ever removed through the Storage API: SQL queues them in `storage_deletions` and
`storage-cleanup` deletes them (account deletion, retention, claim decisions, orphan uploads).

### Retention schedule

Nightly pg_cron jobs, in UTC (Paris is one or two hours ahead).

| Data | Kept | Job |
| --- | --- | --- |
| Group messages | 12 months | `prune-messages` 04:10 |
| Notifications outbox | 30 days | `prune-outbox` 03:45 |
| Reports and their snapshots, decisions | 3 years after `decided_at` (after `created_at` while open) | `retention` 03:20 |
| Admin audit log | 3 years | `retention` |
| Feedback and its screenshot | 2 years | `retention` |
| Raw post-session feedback | 6 months | `retention` |
| Claim documents | deleted 1 year after the decision (after submission if never decided); the approved claim itself stays while the association is verified | `retention` |
| Inactive accounts | notice at 35 months without a visit, deletion at 36 months plus 30 days if still inactive | `inactive-accounts` 03:40 |
| Rate-limit log (`limit_log`) | 1 day | `hourly-limits` (every hour at :05) |
| Queued storage deletions | drained every 10 minutes | `storage-cleanup` |

The inactivity notice is a push notification and a notice in the app (no email yet), so it only
reaches people who enabled notifications; opening the app clears it. Admins are never deleted for
inactivity.

### Managing banned words

Admin, Administration, "Mots interdits": add or remove a word (3 to 50 characters; matched without
accents or case, on whole words). A chat message, activity, collectif or community club containing
one is refused with "Ce texte contient un mot interdit.". Text that looks like spam (more than 3
links, or the same text 3 times in 10 minutes) is accepted but goes into the reports queue as an
automatic report. The same change from SQL, as an admin session only:
`select public.admin_set_banned_word('<mot>', true);` (use `false` to remove).

### Before launch

- Replace the placeholder `PRIVACY_CONTACT` in `app/src/content/contact.ts`
  (`confidentialite@<domaine>`) with a real mailbox. It is the address for privacy requests and for
  contesting a moderation decision (shown to suspended people too).
- Have the privacy texts (`app/src/content/privacy.fr.ts`, `privacy.en.ts`) reviewed by a qualified
  person.

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

## Public web pages

The website has two parts, both on Cloudflare Pages (free plan):

- the public pages (`/`, `/activites/...`, `/associations/...`, sitemaps, legal pages), rendered by
  the Pages Functions in `web/functions` (see `web/README.md`);
- the interactive app (sign up, "Je serai là", "Mes données"), the Expo web export served under `/app/`.

### 1. Create the Cloudflare Pages project

1. Cloudflare dashboard, Workers & Pages, Create, Pages, connect the Git repository.
2. Project settings:
   - Root directory: `web`.
   - Build command: `cd .. && npm ci && npm ci --prefix app && npm run web:build` (the repo root and `app/` each have a `package-lock.json`; `web:build` writes `web/dist`).
   - Build output directory: `dist`. The Functions are read from `web/functions` (next to the root directory).
3. Set the variables below under Settings, Environment variables (Production and Preview), including `NODE_VERSION=22` (pins the Node version of the Pages build).

| Variable | Meaning |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL. Read at build time and at runtime: the Function `web/functions/app/[[path]].ts` builds the CSP of `/app/*` from it. The build fails if `EXPO_PUBLIC_SUPABASE_URL` is set to another origin |
| `SUPABASE_ANON_KEY` | anon key, read by the Worker |
| `WEB_BASE_URL` | public address without trailing slash (canonical links, sitemaps). Until a domain is bought, the `*.pages.dev` address |
| `PLAY_STORE_URL` | Play Store listing, used by the Worker pages |
| `ANDROID_PACKAGE` | Android package (`fr.friendapp.app`), used for `/.well-known/assetlinks.json` |
| `ANDROID_SHA256_CERT` | SHA-256 fingerprint of the app signing certificate (Play Console, App integrity). Without it `assetlinks.json` is skipped and Android App Links are not verified |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | read by the app export |
| `EXPO_PUBLIC_WEB_BASE_URL` | same value as `WEB_BASE_URL`; also adds the Android App Links intent filters (`app/app.config.js`) |
| `EXPO_PUBLIC_PLAY_STORE_URL` | **required**: the "Disponible dans l'application" screens and the header link need it |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_TURNSTILE_SITE_KEY` | Google sign-in and the sign-up CAPTCHA on the web |

Android App Links: the same `EXPO_PUBLIC_WEB_BASE_URL` must be set when building the Android app
(EAS), so the `https://<host>/activites/*` and `/associations/*` links open in the app. Check with
`npx expo config --json` in `app/`.

### 2. Domain and Cloudflare settings (spec 18.5)

1. Buy a domain (or keep the free `*.pages.dev` address) and add it under the Pages project, Custom domains.
   DNS is managed on Cloudflare.
2. SSL/TLS: Always Use HTTPS on; enable DNSSEC and add the DS record at the registrar.
3. Security: turn on the WAF managed rules and add the rate-limiting rule below. Do not use a challenge on the public pages: WhatsApp, Instagram and Google fetch them without a browser.

   Rate-limiting rule (review finding WEB-1). Every request to the site, cached or not, is one Pages Functions
   invocation (100,000 a day on the free plan), and a request for a made-up id costs one database call. In
   Security, Security rules, Rate limiting rules, create:
   - Expression: `(http.request.uri.path wildcard "/activites/*") or (http.request.uri.path wildcard "/associations/*") or (http.request.uri.path wildcard "/sitemaps/*") or (http.request.uri.path wildcard "/app/*")`
   - Characteristic: IP. Limit: 60 requests per 10 seconds (the free plan allows one period, so use the longest it offers).
   - Action: Block for 10 minutes (not a challenge, for the reason above; crawlers stay far below this rate).
   The code already limits what a junk path can do: the edge cache is keyed on the page id (slug, case, trailing
   slash and query string do not change the key), and a path with no valid id is answered with no cache lookup and
   no database call. Also set the Pages project's Functions failure mode to "Fail open" so the static files keep
   being served if the daily quota is ever exhausted. The Cache API does nothing on `*.pages.dev` hosts, so every
   request there reaches the database: put the site on a custom domain before launch.
4. Change `WEB_BASE_URL` and `EXPO_PUBLIC_WEB_BASE_URL` to the new domain and redeploy.
5. Pages project, Settings, Access policy: turn on Cloudflare Access for preview deployments (review finding WEB-7), so
   old preview hosts (`<hash>.<project>.pages.dev`, `<branch>.<project>.pages.dev`) are not public. As a second
   layer, `robots.txt` answers `Disallow: /` on any host other than the one in `WEB_BASE_URL`; this only works
   once `WEB_BASE_URL` is set for the Preview environment too.
6. Takedowns (review finding WEB-6, accepted): a page removed by moderation can still be served from the edge cache
   for up to 5 minutes and from a browser for 1 minute. Nothing purges it. If an urgent takedown is needed, purge the
   URL in Cloudflare, Caching, Configuration, Purge Cache, Custom purge.

### 3. Supabase Auth

- Authentication, URL Configuration: set the Site URL to `<WEB_BASE_URL>` and add
  `<WEB_BASE_URL>/app/auth/callback` to the Redirect URLs. Google sign-in redirects to the origin the page is
  served from. Do not add a wildcard such as `https://*.<project>.pages.dev/...` (review finding AUTH-9): every
  old branch preview would then receive production sign-in codes. To test sign-in on a Cloudflare preview, add
  that one preview address exactly, and remove it afterwards. Locally, `http://127.0.0.1:8788/app/auth/callback` is in
  `supabase/config.toml`.
- Google sign-in on the web needs an OAuth client of type "Web application" whose authorised redirect URI
  is the Supabase callback (`https://<project>.supabase.co/auth/v1/callback`); its client id goes in
  `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.

### 4. Turnstile

In the Cloudflare Turnstile widget, add the web hostname (the domain, or the `*.pages.dev` host) to the
widget's hostnames, next to `challenges.cloudflare.com`.

### 5. Search engines

Submit `<WEB_BASE_URL>/sitemap.xml` in Google Search Console (add the domain property first).

### 5b. After the first deploy

- Link preview: paste an activity link (`<WEB_BASE_URL>/activites/<slug>-<id>`) in a WhatsApp chat with yourself and check that
  the card shows the title, description and the Habitués image. If it does not, the WAF or a challenge rule is blocking the crawler.
- Android App Links: open
  `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=<WEB_BASE_URL>&relation=delegate_permission/common.handle_all_urls`
  and check that the answer lists your package (`fr.friendapp.app`) and the SHA-256 of the signing certificate.

### 6. Before launch

Fill in the placeholders in the "Mentions légales" (publisher name and contact, hosts) and "Conditions
d'utilisation" pages (`web/src/legal.ts`).

### Tests and local checks

- `npm run web:test` runs the Deno tests (`deno test --allow-read=web/public web/src`, the flag is
  needed to read `_headers` and `_routes.json`) and the Node build tests. Delete the `deno.lock` it leaves behind (git-ignored).
- `CI=1 SUPABASE_URL=http://127.0.0.1:55321 EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321 npm run web:build` builds `web/dist`.
- Local run of the whole site: put `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `WEB_BASE_URL=http://127.0.0.1:8788` in `web/.dev.vars`
  (git-ignored), then `cd web && npx --yes wrangler@4 pages dev dist`.
- The interactive app is a single-page app under `/app/`. `web/functions/app/[[path]].ts` serves the app shell for every
  route that is not a file, so a new route under `app/src/app` needs nothing else. `web/public/_routes.json` keeps the static
  files (`/app/_expo/*`, `/app/assets/*`, the favicon, `styles.css`, the preview image, `/.well-known/*`) out of the Function.
- Slugs: `app/src/lib/links.ts` and `web/src/slug.ts` must give the same result; both are
  tested against `web/src/slug_fixtures.json`.
