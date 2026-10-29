# Security and Launch (Sub-project 9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Habitués ready for a public Google Play release:
- CI runs every test suite and blocks known-vulnerable dependencies and new database security warnings.
- The repository uses GitHub's free security features.
- The code has been through a security review, and the review's findings are fixed.
- The backup restore has a tested script.
- The RGPD paperwork, terms of use (CGU) and store listing are drafted.
- The app has its final name and a release build setup.

**Architecture:** Most of this sub-project is configuration, scripts and documents. There are no new features.
- **Code changes:**
  - CI jobs;
  - a pgTAP test of the database's security rules;
  - one small migration for known follow-ups and the review's fixes;
  - a post-deploy check script;
  - a backup restore script;
  - the app's identity and release build settings;
  - a CGU link at sign-up.
- **Documents:** in `docs/rgpd/`, `docs/security/`, `docs/ops/` and `docs/launch/`, in French where a regulator or Google will read them, and in English otherwise.
- **Steps only the owner can do** (accounts, payments, signatures, hosted settings) are in one ordered checklist, `docs/launch/checklist.md`.

**Tech Stack:** GitHub Actions, Dependabot and CodeQL; Supabase CLI 2.121 (`supabase db advisors`, `supabase db dump`); pgTAP; Node 22 (`node --test`) for the scripts; Deno for the web and Edge Function tests; EAS Build (Android App Bundle); Expo SDK 58.

**Spec:** `docs/specs/2026-10-21-friend-app-design.md`:
- §14 Release 1 item 9;
- §15 Launch and growth;
- §18.4 Protecting the data;
- §18.5 Protecting the service;
- §18.6 Breach plan;
- §18.7 Paperwork.

It builds on every plan in `docs/plans/`.

## Decisions for the owner to confirm

1. **Final app name and Android package.**
   - Display name: **"Habitués"**.
   - Package: **`fr.habitues.app`**. A package name can never change once the app is on Google Play, and today it is still `fr.friendapp.app`.
   - Link scheme: `habitues://`.
   - Changing them now costs nothing. The Google sign-in Android client and the Firebase app will need to be re-created for the new package (README steps).
   - *Owner to confirm, or give another name.*
2. **Release builds with EAS Build (free plan) and Play App Signing.**
   - EAS builds the Android App Bundle in the cloud and keeps the upload key.
   - Google keeps the app signing key. Its SHA-256 fingerprint, shown in Play Console, goes into `ANDROID_SHA256_FINGERPRINTS` for App Links.
   - The free plan gives a limited number of builds per month, enough for launch.
   - *Owner to confirm.*
3. **CI security gates.** A build fails when any of these happens:
   - the Supabase security advisor reports a warning that isn't on a reviewed allowlist (each entry says why it's acceptable);
   - `npm audit --omit=dev --audit-level=high` fails, for the root, `app` or `web`;
   - `pip-audit` finds a vulnerability in the importer.

   Dependabot opens grouped update pull requests once a week, plus security updates straight away. CodeQL scans JavaScript/TypeScript, Python and the workflows.

   *Owner to confirm.*
4. **How changes reach `main` from now on.** Until now, branches were merged on this computer and pushed. With branch protection:
   - `main` refuses force-pushes and deletion;
   - changes arrive through a GitHub pull request, which can be merged only when CI passes.

   I push the branch and open the pull request; you merge it on github.com, which is one click. *Owner to confirm. The alternative is to block only force-push and deletion and keep merging locally.*
5. **Security review: thorough automated and manual checks, no paid pentest at launch.**
   - Five independent reviewers each check one area: database access rules and functions; sign-in and sessions; the web pages and Worker; the Edge Functions; the app.
   - A new database test also checks the rules that must always hold, such as every table having row-level security.
   - Every finding rated high or medium is fixed before launch. Low findings are fixed or listed with a reason.
   - The report is `docs/security/2026-11-review.md`.
   - A paid external review (about €1,500–5,000) can come after launch if the app grows.
   - *Owner to confirm.*
6. **RGPD paperwork and the CGU are drafted by me, not by a lawyer.**
   - The documents:
     - the registre des traitements;
     - the AIPD (privacy impact assessment), following the CNIL's PIA structure;
     - the list of processors with their DPA links;
     - the breach procedure and incident log;
     - the CGU.
   - They're a solid first draft that follows CNIL templates, but they are not legal advice. You fill in the publisher identity and accept the processor agreements in each provider's dashboard. A qualified person should read the CGU and the privacy policy before launch.
   - *Owner to confirm.*
7. **Backup restore test.**
   - Supabase Pro keeps a backup every day.
   - The test downloads a dump of the hosted database, restores it into a separate local database, and checks four things: the tables and row counts match, row-level security is still on, the scheduled jobs are present, and a sample query works.
   - A script does all of it, and it's tested locally against a dump of the local database. You run it once against the hosted project before launch and record the date in `docs/ops/backup-restore.md`.
   - *Owner to confirm.*
8. **Launch timing.** Release publicly as soon as the closed test is done: 12 or more testers for 14 days in a row, the Google requirement for new personal developer accounts. Aim for early 2027, rather than waiting for September 2027. Then use the September "Forums des associations" as the first big growth push, with QR codes for associations. *Owner to confirm.*
9. **No ads at launch.**
   - Ads are Release 2, so the store listing doesn't declare "Contient des annonces".
   - The app requests no advertising ID: the `com.google.android.gms.permission.AD_ID` permission is removed.
   - The Play "Data safety" form says no data is used for advertising. It will be updated when ads arrive.
   - *Owner to confirm.*

## Global Constraints

- **Identity:**
  - display name `Habitués`;
  - Android package `fr.habitues.app` (decision 1);
  - scheme `habitues`;
  - first store release `version` `1.0.0` with `android.versionCode` `1`.

  Every old occurrence (`fr.friendapp.app`, `friendapp://`, "Friend App") is replaced: in `app/app.json`, `app/src/lib/links.ts`, `web/src/html.ts` (`DEFAULT_ANDROID_PACKAGE` and the intent URL) and their tests, and in `README.md`.
- **Secrets:** no secret in the repository, in the CI logs or in the documents. The scripts read connection strings only from environment variables (`RESTORE_SOURCE_DB_URL`, `SMOKE_WEB_BASE_URL`, `SMOKE_SUPABASE_URL`, `SMOKE_SUPABASE_ANON_KEY`) and never print them.
- **CI workflow hygiene:**
  - every workflow sets `permissions: contents: read` at the top level and widens it only per job (CodeQL needs `security-events: write`);
  - third-party actions stay on major-version tags, and Dependabot keeps them up to date;
  - no `pull_request_target`.
- **Documents:**
  - French for `docs/rgpd/*`, the CGU, `docs/launch/store-listing.fr.md`, `docs/launch/closed-test.md` (the invitation text the testers receive) and `docs/launch/data-safety.md`;
  - English for `docs/security/*`, `docs/ops/*` and `docs/launch/checklist.md`;
  - no emoji;
  - each document starts with a "Dernière mise à jour / Last updated" date line;
  - each is written in plain language.
- **Store limits:** title at most 30 characters, short description at most 80, full description at most 4,000 (Google Play). The listing never promises something Release 1 doesn't do (no private messages, no badges, no iPhone app).
- **Migrations:** the next number is `20261029000037`. Never edit migrations 1–36. Every new or redefined `security definer` function sets `search_path = public, pg_temp`. Update `app/src/lib/database.types.ts` with `npm run db:types` when the schema changes.
- **Code rules:** i18n for every UI string (fr and en parity). Local Supabase on ports 553xx. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Agents stage explicit paths only.

## Review Focus

1. **The advisor or audit gate is flaky or always red.** A gate that fails on day one gets ignored. The allowlist must start out matching today's database exactly, and `npm audit` runs only on production dependencies. → Task 1: the advisor script is tested against recorded JSON for a clean result, an allowlisted warning, a new warning and a CLI error (where it must fail, not pass silently).
2. **The package rename breaks something the tests don't cover.** That covers share links, the web "Ouvrir dans l'application" intent, assetlinks, Google sign-in and push. → Task 5 tests that links, the intent URL and assetlinks all use the new package and scheme, and the checklist lists re-creating the OAuth and Firebase Android clients.
3. **The restore script reports success on a partial restore,** for example when a dump step failed silently or a table is empty. → Task 7 makes every step `set -euo pipefail`, compares row counts per table, and has a test where one table is truncated after the restore and the check must fail.
4. **The smoke check gives false confidence.** A check that passes against a misconfigured site is worse than none. → Task 6 has tests against a fake server: a missing CSP header, a public page that sets a cookie, an anon read of `profiles` that returns rows, and an `assetlinks.json` with the wrong package must each fail.
5. **A future migration adds a table without row-level security, or a function anyone can call.** → Task 3's invariant test fails on both. It's checked by adding a temporary bad table and function inside the test transaction and seeing the invariant query report them.

---

### Task 1: CI runs every suite, plus the security gates

**Files:**
- Modify: `.github/workflows/ci.yml` and `.github/workflows/import.yml`, `vocab.yml` (top-level `permissions` only)
- Create: `scripts/check-advisors.mjs`, `scripts/check-advisors.test.mjs`, `scripts/fixtures/advisors/*.json`, `supabase/advisors-allowlist.json`
- Modify: root `package.json` (scripts `ci:advisors`, `scripts:test`)

**Interfaces:**
- Produces:
  - `node scripts/check-advisors.mjs <advisors.json> <allowlist.json>` exits 0 when every warn/error issue matches an allowlist entry, and 1 otherwise, printing each unexpected issue as `name: detail`.
  - Allowlist entries are `{ "name": string, "match": string, "reason": string }`. `match` is a substring of the issue's `detail`.
  - A CLI error object (`{"_tag":"Error"}`) or input that isn't JSON exits 2.
  - `npm run scripts:test` runs `node --test scripts/`.

- [ ] **Step 1: Failing tests** `scripts/check-advisors.test.mjs`:
  - `clean.json` → 0;
  - `allowlisted.json` → 0;
  - `new-warning.json` → 1, and the output names the issue;
  - `cli-error.json` → 2;
  - an allowlist entry with an empty `reason` → 2 (every exception must be explained).
- [ ] **Step 2: Run** `node --test scripts/`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `check-advisors.mjs`, then build the real allowlist:
  - Run `npx supabase start`, then `npx supabase db advisors --local --type security --level warn --output-format json > advisors.json`.
  - For each current issue, either fix it in Task 3's migration (note it in the ledger for Task 3) or add an allowlist entry with a real reason.
  - Expected entries are things like extensions kept in `public` because earlier migrations need them there. The PR description lists each entry.
- [ ] **Step 4: CI jobs** in `ci.yml`:
  - **database job:** after the tests, run `npx supabase db advisors --local --type security --level warn --output-format json > advisors.json` and `node scripts/check-advisors.mjs advisors.json supabase/advisors-allowlist.json`;
  - new **web** job: `npm ci && npm ci --prefix app && npm run web:test && npm run web:build`;
  - new **functions** job: `npx --yes deno@2 test supabase/functions` (with the flags the README uses);
  - new **audit** job: `npm audit --omit=dev --audit-level=high` in the root, `app` and `web` (if `web` has its own lockfile), and `uvx pip-audit` in `importer` against `uv export --no-dev` output;
  - new **scripts** job: `npm run scripts:test`;
  - top-level `permissions: contents: read` on all three workflows.

  If `npm audit` fails today, fix the dependency where a patched version exists. Otherwise record it in the PR and the ledger with the advisory id; don't weaken the level.
- [ ] **Step 5: Verify:**
  - `node --test scripts/` passes;
  - the four new commands each succeed locally;
  - `npx --yes @action-validator/cli .github/workflows/ci.yml` (or `actionlint` if available) reports nothing.
- [ ] **Step 6: Commit** `ci: run web, function and script tests; advisor, npm and pip audit gates`

### Task 2: GitHub security configuration

**Files:**
- Create: `.github/dependabot.yml`, `.github/workflows/codeql.yml`, `SECURITY.md`, `docs/ops/github-settings.md`

**Interfaces:**
- Produces: the files below, plus a settings page the owner follows (decision 4). The checklist in Task 9 links to it.

- [ ] **Step 1: `dependabot.yml`:**
  - ecosystems `npm` (`/`, `/app`), `pip` (`/importer`, which reads `pyproject.toml`) and `github-actions` (`/`);
  - weekly, Monday, `Europe/Paris`;
  - one group for minor and patch updates per ecosystem;
  - `open-pull-requests-limit: 5`.
- [ ] **Step 2: `codeql.yml`:**
  - triggers: push to `main`, pull requests and a weekly schedule;
  - matrix `javascript-typescript`, `python` and `actions` with `build-mode: none`;
  - `permissions: security-events: write, contents: read`.
- [ ] **Step 3: `SECURITY.md`:**
  - report vulnerabilities privately through GitHub "Report a vulnerability" (private vulnerability reporting), or by email to the `PRIVACY_CONTACT` address;
  - expect an answer within 7 days;
  - no testing against other people's accounts or data.
- [ ] **Step 4: `docs/ops/github-settings.md`:** exact clicks for:
  - Settings → Code security: Dependabot alerts and security updates, secret scanning, push protection, private vulnerability reporting, CodeQL (the advanced setup that uses this workflow);
  - a branch ruleset on `main` per decision 4: block force pushes and deletion; require a pull request with 0 approvals and the status checks `Database (pgTAP)`, `App (Jest, lint, typecheck)`, `Importer (pytest)`, `Web`, `Functions`, `Audit`, `Scripts`, `CodeQL`;
  - an account check that 2FA is on with a passkey or an authenticator app.
- [ ] **Step 5: Verify:** `actionlint` (or the validator from Task 1) on `codeql.yml`, and `npx --yes yaml-lint .github/dependabot.yml` passes.
- [ ] **Step 6: Commit** `chore(security): Dependabot, CodeQL, security policy and repository settings guide`

### Task 3: Database security invariants and known follow-ups

**Files:**
- Create: `supabase/tests/40_security_invariants.test.sql`, `supabase/migrations/20261029000037_launch_hardening.sql`
- Modify: `app/src/features/admin/api.ts` and the reports queue screen (pagination), `app/src/lib/database.types.ts`, with tests in `app/__tests__/`

**Interfaces:**
- Produces:
  - `public.admin_reports_queue(p_before timestamptz default null)`: the same row shape as today, 50 per page, ordered by `created_at desc`, only rows older than `p_before` when it's given.
  - `public.is_banned(uuid)` is no longer executable by `authenticated` or `anon`. Only policies, triggers and security definer functions use it.
- [ ] **Step 1: Failing tests** `40_security_invariants.test.sql`:
  - **row-level security:** no table in `public` without RLS enabled (`is_empty` on the `pg_class` query);
  - **search_path:** no `security definer` function in `public` without a `search_path` setting in `proconfig`;
  - **anon functions:** `anon` can execute no `public` function outside the explicit list in the test (today's anon RPCs: `search_*`, `get_activity`, `get_association`, `get_collectif`, `web_*` and the others found by querying `has_function_privilege`; the implementer writes the list from the current database and checks each one is meant to be public);
  - **anon tables:** `anon` holds no INSERT, UPDATE or DELETE privilege on any `public` table;
  - **storage:** no storage bucket is `public` except the ones listed;
  - **is_banned:** `authenticated` can't execute `is_banned`;
  - **the invariant queries work:** inside the test, create a table without RLS and a security definer function without `search_path`, and check that the invariant queries return them (`isnt_empty`). This proves the checks catch real cases.
  - **pagination:** `admin_reports_queue(p_before)` returns the next 50.
- [ ] **Step 2: Run** `npx supabase test db`. Expected: the new test fails on `is_banned`, the pagination and any advisor items Task 1 sent here.
- [ ] **Step 3: Migration 37:**
  - revoke `is_banned` from `public, anon, authenticated`, and check nothing calls it as `authenticated` outside security definer code;
  - redefine `admin_reports_queue` from its latest version with `p_before`;
  - fix the advisor items noted in Task 1's ledger.

  App: a "Voir plus" button at the end of the reports queue loads the next page (i18n `admin.reports.more`: "Voir plus" / "Show more"), with a jest test.
- [ ] **Step 4: Verify:** `npx supabase db reset && npx supabase test db` all pass; `npm run db:types`; `cd app && npm test && npm run lint && npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(security): database invariant tests, is_banned private, reports queue pages`

### Task 4: Pre-launch security review and fixes

**Files:**
- Create: `docs/security/2026-11-review.md`
- Modify: whatever the findings require. Each fix comes with a test and, where it touches the schema, a new migration (`…038` onwards).

**Interfaces:**
- Consumes: Tasks 1–3 merged into the branch, so the review sees the invariant test and the gates.
- Produces: the report, with one row per finding: id, area, severity (high, medium, low), what an attacker could do, the fix commit or the reason it's accepted.

- [ ] **Step 1: Five reviewers in parallel** (opus, read-only). Each gets one area and a list of concrete questions:
  1. **Database:**
     - every RLS policy and grant;
     - every security definer function: who can call it, whether arguments let a caller act for another user, `search_path`, whether it leaks private columns;
     - the write limits;
     - views.
  2. **Sign-in and sessions:**
     - Supabase Auth settings in `supabase/config.toml` versus spec §18.5: link expiry, refresh-token rotation, rate limits, no account-existence leaks;
     - admin `aal2` enforcement;
     - ban handling;
     - session storage in the app;
     - the web OAuth PKCE flow and its callback.
  3. **Web:**
     - HTML and JSON-LD escaping;
     - headers and CSP on every route, including errors and `/app`;
     - open redirects in the slug redirect or the callback;
     - cache poisoning (whether any request-controlled value is in the cache key or the body);
     - the sitemap cost.
  4. **Edge Functions:** `send-push`, `storage-cleanup` and `submit-feedback`: authentication of the caller, Turnstile verification, input size limits, secrets in logs, behaviour when called directly from the internet.
  5. **App and supply chain:**
     - secrets in the bundle (`grep` the web build output for keys other than the anon key);
     - Android permissions in the merged manifest;
     - deep-link handling (`+native-intent`) with hostile URLs;
     - upload checks (type, size, EXIF);
     - dependencies flagged by the audit.

  Each reviewer must show a concrete exploit path or test for every finding. A finding without one is "to verify", not high.
- [ ] **Step 2: Triage:** verify each finding yourself and assign its severity. Write the report.
- [ ] **Step 3: Fix** every high and medium finding: a failing test first (pgTAP, Deno, Jest or a script test), then the fix, then green, with one commit per finding: `fix(security): <finding id> <short description>`.
- [ ] **Step 4: Verify:** every suite passes (pgTAP, `npm run web:test`, functions, jest, lint, tsc, pytest, `npm run scripts:test`), and the advisor gate passes.
- [ ] **Step 5: Commit** the report: `docs(security): pre-launch security review`

### Task 5: App identity and release build

**Files:**
- Modify: `app/app.json`, `app/app.config.js`, `app/src/lib/links.ts`, `web/src/html.ts`, `web/src/html_test.ts`, `README.md`, `app/src/content/privacy.fr.ts`, `privacy.en.ts`
- Create: `app/eas.json`, `app/__tests__/app-config.test.ts`

**Interfaces:**
- Produces:
  - EAS profiles:
    - `production`: `android.buildType: "app-bundle"`, `autoIncrement: true`, `distribution: "store"`;
    - `preview`: `buildType: "apk"`, `distribution: "internal"`;
    - `cli.appVersionSource: "remote"`.
  - The merged config has the name, package and scheme from Global Constraints, and `android.blockedPermissions: ["android.permission.RECORD_AUDIO", "com.google.android.gms.permission.AD_ID"]`. The implementer adds any other permission found in the merged manifest that the app doesn't use, and lists it in the commit.
- [ ] **Step 1: Failing tests:**
  - `app-config.test.ts` loads `app.config.js` with `app.json` and checks: name `Habitués`, package `fr.habitues.app`, scheme `habitues`, `versionCode` 1, the blocked permissions, and App Links still added when `EXPO_PUBLIC_WEB_BASE_URL` is set;
  - the links test: without a base URL, links are `habitues://activites/<id>`;
  - `html_test.ts`: the intent URL contains `scheme=habitues;package=fr.habitues.app`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the renames and `eas.json`. In the README, replace the old package everywhere and add a "Release build" section:
  - `npx eas-cli build -p android --profile production` from `app/`;
  - the EAS environment variables;
  - where to find the SHA-256 in Play Console (Test and release → App integrity).

  Privacy texts: delete, don't keep with a marker, every sentence still marked "(dès que cette fonctionnalité sera disponible)" whose feature isn't in Release 1 (phone number, private messages, post-session feedback), in both languages. The marker rule in the README then says to add the sentence back when the feature ships.
- [ ] **Step 4: Verify:**
  - the new tests pass, plus `cd app && npm test && npm run lint && npx tsc --noEmit` and `npm run web:test`;
  - `cd app && npx expo config --type public` shows the new identity;
  - if `npx expo prebuild -p android --no-install` runs within 10 minutes, check `android/app/src/main/AndroidManifest.xml` for the permissions, then delete the generated `android/` folder; don't commit it.
- [ ] **Step 5: Commit** `feat(app): final name Habitués, package fr.habitues.app, release build profiles`

### Task 6: Post-deploy smoke check

**Files:**
- Create: `scripts/smoke.mjs`, `scripts/smoke.test.mjs`
- Modify: root `package.json` (script `smoke`), README "Public web pages" → "After the first deploy"

**Interfaces:**
- Produces:
  - `npm run smoke` reads the `SMOKE_*` variables and prints one line per check, `ok` or `FAIL <reason>`.
  - It exits 1 if any check fails.
  - `export async function runChecks(env, fetchImpl): Promise<{name: string, ok: boolean, reason?: string}[]>`, so the tests can inject a fake fetch.

- [ ] **Step 1: Failing tests:** against a fake fetch that serves a correct site, every check is `ok`. Each of the following must produce the named failure:
  - no `Content-Security-Policy` on `/` → `headers:/`;
  - a `Set-Cookie` on a public page → `no-cookies`;
  - `/sitemap.xml` not XML → `sitemap`;
  - an unknown activity id answering 200 → `not-found`;
  - a 404 without `noindex` → `not-found`;
  - `/.well-known/assetlinks.json` with another package → `assetlinks`;
  - an anon `GET /rest/v1/profiles?select=id&limit=1` returning rows → `anon-profiles`;
  - an anon call to `rpc/admin_reports_queue` that doesn't fail → `anon-admin`;
  - a non-HTTPS base URL → `https`.
- [ ] **Step 2: Run** `node --test scripts/`. Expected: FAIL.
- [ ] **Step 3: Implement** with global `fetch`, a 10-second timeout per request, and no retries. The anon key is sent only to `SMOKE_SUPABASE_URL`.
- [ ] **Step 4: Run** `node --test scripts/`. Expected: PASS. Then run `npm run smoke` against the local site (`npm run web:build` and `npx wrangler pages dev`, plus local Supabase) and check that it passes.
- [ ] **Step 5: Commit** `feat(ops): post-deploy smoke check for headers, indexing, App Links and anon access`

### Task 7: Backup restore test

**Files:**
- Create: `scripts/restore-check.sh`, `scripts/restore-check.sql`, `scripts/restore-check.test.mjs`, `docs/ops/backup-restore.md`

**Interfaces:**
- Produces: `scripts/restore-check.sh`, which reads `RESTORE_SOURCE_DB_URL` (hosted, or local for the test) and `RESTORE_TARGET_DB_URL` (an empty scratch database), then:
  1. dumps roles, schema and data with `npx supabase db dump --db-url` (three files, in a temporary folder removed on exit);
  2. restores them into the target with `psql -v ON_ERROR_STOP=1`;
  3. runs `restore-check.sql` on both databases;
  4. compares the outputs.

  It exits 0 only if they match. `restore-check.sql` prints:
  - the exact row count per `public` table, sorted;
  - the number of tables with RLS;
  - the names of the `cron.job` entries;
  - the installed extensions;
  - the result of `select count(*) from public.categories`.
- [ ] **Step 1: Failing test** `restore-check.test.mjs`:
  - skipped unless `RESTORE_TEST=1` and local Supabase is running;
  - it creates a scratch database `restore_test` on the local server and runs the script from local to `restore_test`, expecting exit 0;
  - it then truncates one table in `restore_test`, reruns only the check-and-compare step (the `--compare-only` flag), and expects exit 1 with the table named in the output;
  - it drops `restore_test` at the end.
- [ ] **Step 2: Run** it with `RESTORE_TEST=1`. Expected: FAIL.
- [ ] **Step 3: Implement** with `set -euo pipefail` and `trap` cleanup. Connection strings are never echoed.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Write** `docs/ops/backup-restore.md`:
  - where Supabase Pro's daily backups are and how long they're kept;
  - how to restore one in the dashboard (and that restoring replaces the live database);
  - how to run the script against the hosted project into a local scratch database;
  - a table "Restore tests" with columns date, who and result, which the owner fills in.
- [ ] **Step 6: Commit** `feat(ops): backup restore check script and runbook`

### Task 8: RGPD paperwork and terms of use

**Files:**
- Create:
  - `docs/rgpd/registre-des-traitements.md`;
  - `docs/rgpd/aipd.md`;
  - `docs/rgpd/sous-traitants.md`;
  - `docs/rgpd/violation-de-donnees.md`;
  - `docs/rgpd/journal-des-incidents.md`.
- Modify: `web/src/legal.ts` (CGU text) with `web/src/legal_test.ts`, the sign-up screen in `app/src/features/account/` with its test, and the i18n files.

**Interfaces:**
- Consumes: retention periods, data lists and legal bases exactly as in spec §18.1–18.3 and the privacy texts. The documents must not contradict `app/src/content/privacy.fr.ts`. Where they differ, the code is the truth: check the migration, and report any mismatch.
- Produces: the CGU at `/conditions-utilisation` (the existing route) and a sign-up line "En continuant, vous acceptez les conditions d'utilisation et la politique de confidentialité." with both links (i18n `auth.legalNotice`; English "By continuing, you accept the terms of use and the privacy policy.").

- [ ] **Step 1: Failing tests:**
  - `legal_test.ts`: the CGU page contains the headings "Objet", "Accès au service", "Règles de conduite", "Contenus des utilisateurs", "Signalement et modération", "Suspension et suppression du compte", "Responsabilité", "Données personnelles", "Modification des conditions" and "Droit applicable", and no "à compléter" placeholder;
  - the app sign-up test: the legal notice and both links are present.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Write the CGU.** It covers:
  - 18+ only;
  - the meeting-safety reminder;
  - the moderation and appeal process (DSA statement of reasons, contesting a decision by email);
  - the account deletion rules.

  It mirrors the conduct rules the reports already use. Then add the sign-up notice.
- [ ] **Step 4: Write the RGPD documents:**
  - **registre:** one section per purpose (accounts, activities and sessions, group chat, safety and moderation, public directory import, website and security logs, notifications). Each has: purpose, legal basis, categories of people and data, recipients, processors, transfers, retention and security measures;
  - **AIPD:** in CNIL PIA order (context, fundamental principles, risks: illegitimate access, unwanted change, disappearance), likelihood and severity for each, and the measures already in place with file references;
  - **sous-traitants:** Supabase, Cloudflare, Google (sign-in, Firebase Cloud Messaging), Expo, GitHub. For each: role, data, region, transfer basis (the EU–US Data Privacy Framework or standard contractual clauses) and where to accept its DPA;
  - **violation de données:** the §18.6 steps, with the CNIL online notification address (`notifications.cnil.fr`), a template user message in French, and who decides;
  - **journal des incidents:** an empty table plus one example row marked as an example.
- [ ] **Step 5: Verify:** the tests pass; `npm run web:test`; `cd app && npm test && npm run lint`; and every retention period in the documents matches `20261024000032_retention.sql` and `27_chat.sql`.
- [ ] **Step 6: Commit** `docs(rgpd): registre, AIPD, processors, breach procedure; CGU and sign-up notice`

### Task 9: Store listing, closed test and launch checklist

**Files:**
- Create:
  - `docs/launch/store-listing.fr.md`;
  - `docs/launch/data-safety.md`;
  - `docs/launch/content-rating.md`;
  - `docs/launch/closed-test.md`;
  - `docs/launch/checklist.md`;
  - `web/scripts/make-feature-graphic.mjs`;
  - `docs/launch/feature-graphic.png`.
- Modify: `README.md` (link to `docs/launch/checklist.md` from "Before launch" sections)

**Interfaces:**
- Consumes: decisions 1, 8 and 9; every README "before launch" item; Tasks 2, 6 and 7's documents.

- [ ] **Step 1: Store listing (French):**
  - title, at most 30 characters, e.g. "Habitués : activités près de vous";
  - short description, at most 80 characters;
  - full description, at most 4,000 characters, built on the spec §15 positioning (recurring groups, the nationwide association directory, safety);
  - category "Social";
  - contact email field `PRIVACY_CONTACT`;
  - privacy policy URL `<WEB_BASE_URL>/confidentialite`;
  - account deletion URL `<WEB_BASE_URL>/app/mes-donnees`, or the real route, checked in `app/src/app`;
  - a list of 6 screenshots to take (which screen, which sample data).

  A test-free check: a short Node one-liner in the doc's verification step counts the characters.
- [ ] **Step 2: `data-safety.md`:** the exact answers for the Play "Data safety" form, taken from the code:
  - collected: email, name (first name), approximate location (town), photos, messages (group chat), app interactions, user content (activities), crash logs (none, unless Expo adds them; check);
  - shared: none;
  - encrypted in transit: yes;
  - deletion: yes, in the app and on the web.

  `content-rating.md`: the IARC questionnaire answers (users can interact and meet; user content is moderated; no gambling or violence).
- [ ] **Step 3: `closed-test.md`:**
  - how to create the closed track;
  - the 12-tester, 14-day rule and how to count days;
  - the French invitation message;
  - the French tester instructions (what to try each week);
  - how feedback arrives (the in-app "Une idée ? Un problème ?").
- [ ] **Step 4: `checklist.md`:** one ordered list of owner steps, each with a link to the README or document section:
  1. domain;
  2. Supabase Pro in the Paris region;
  3. `supabase db push`;
  4. Vault secrets and cron;
  5. Edge Functions and their secrets;
  6. Auth settings and TOTP;
  7. the Google OAuth web and Android clients (new package);
  8. Firebase (new package);
  9. Cloudflare Pages, DNS, DNSSEC, WAF and rate limits;
  10. Turnstile hostnames;
  11. GitHub settings;
  12. the processor DPAs;
  13. the publisher identity in the mentions légales, and `PRIVACY_CONTACT`;
  14. legal review;
  15. the Play developer account (one-time $25, identity verification);
  16. the EAS build;
  17. the SHA-256 into `ANDROID_SHA256_FINGERPRINTS`, then redeploy;
  18. `npm run smoke`;
  19. the restore test;
  20. the closed test for 14 days;
  21. the production release;
  22. a Search Console sitemap.

  It ends with a "Rollback" section: halt a staged rollout in Play Console, redeploy the previous Pages deployment, and restore a backup as a last resort.
- [ ] **Step 5: Feature graphic:** `make-feature-graphic.mjs` produces a 1024×500 PNG in the same way as `make-og.mjs` (name, tagline, accent colour). Run it and commit the PNG.
- [ ] **Step 6: Verify:**
  - the character counts meet the limits;
  - every link in `checklist.md` points to an existing file and heading (`grep` each anchor);
  - the PNG is 1024×500.
- [ ] **Step 7: Commit** `docs(launch): store listing, Data safety, content rating, closed test and launch checklist`

---

## Owner-only steps (not code; all in `docs/launch/checklist.md`)

Buying the domain and Supabase Pro, creating the Google Play developer account and verifying your identity, accepting each processor agreement, filling in the publisher identity, the legal review, applying the GitHub settings, running the hosted restore test, recruiting 12 or more testers, and pressing "Publish". None of this blocks the code tasks.

## Execution order

Tasks 1 → 2 → 3 → 4 run in order: the review needs the gates and the invariant test in place. Tasks 5, 6, 7 and 8 are independent of each other and can follow in any order. Task 9 comes last, because its checklist links to everything else.

## Not in this sub-project

- A paid external penetration test (decision 5; after launch if the app grows).
- Ads and UMP consent (Release 2, item 15).
- SMS phone verification (unchanged from sub-project 5: `can_organise()`).
- An iOS app.
- Restoring a banned person's activities when their ban is lifted. Moderators handle that by hand. It's a known limitation, listed in the security review report.
