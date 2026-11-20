# Improvement plan: security, speed, SEO and UI

Date: 2026-11-19. Owner: the project owner. Status: proposed.

This plan uses the Claude skills installed for this project (local scope) to improve Habituer in four areas, in
order of priority: **security first**, then speed, SEO and UI. It builds on the pre-launch security review
([docs/security/2026-11-review.md](../security/2026-11-review.md)): 37 findings, nearly all fixed or accepted.
The new passes look for what that review did not cover, not to redo it.

## Rules for every phase

- **Never test against production.** Live tests (API, rate limits, sign-in) run on the local stack
  (`npx supabase start`) or a separate test project, with test accounts. The production project
  (`etsiuopdklrpqxasjrjp`) and `habituer.org` are only read, never attacked.
- **Measure before changing.** Each speed, SEO or UI change starts from a measured baseline and ends with the same
  measurement.
- **One area per branch and pull request.** CI must pass; security fixes get a `differential-review` before merge.
- **Findings use the review's format**: an id (DB-, AUTH-, WEB-, FN-, APP-, new: SC- for supply chain, CI- for
  workflows), a one-line attack scenario, a severity, and a status (fixed in `<commit>`, accepted with a reason).
- **Usage budget.** Run audits one area at a time and at a low effort level first; widen only where something turns up.

## Phase 0: finish the hosted security settings (owner, before anything else)

The review's "Owner actions on the hosted project" are the highest-value security work left, because the code
already depends on them. Check each off in [docs/launch/checklist.md](../launch/checklist.md):

| # | Action | Status |
|---|---|---|
| 0.1 | Supabase Auth settings (checklist step 6): confirm e-mail, OTP 8 digits / 600 s, code-only templates, rate limits, CAPTCHA with Turnstile, anonymous OFF, JWT 3600 s, refresh rotation, exact redirect URLs | to do |
| 0.2 | Custom SMTP provider and sender on `habituer.org` | to do |
| 0.3 | Post-deploy checks: OTP without captcha token gives a `captcha` error; password grant gives `400` | to do |
| 0.4 | Cloudflare: rate-limit rule (WEB-1), WAF managed rules, Always Use HTTPS, DNSSEC, Access on preview deployments | partly done |
| 0.5 | GitHub: CodeQL, secret scanning with push protection, Dependabot alerts (`docs/ops/github-settings.md`) | check |
| 0.6 | Migrations, Edge Functions, function secrets, Vault secrets and cron jobs on the hosted project | done 2026-11-19 |

## Phase 1: security (code)

Each step produces findings in the review format, appended to a new section of the security review, then fixes on
their own branch.

| Step | Skill | Target | What it adds |
|---|---|---|---|
| 1.1 | `performing-threat-modeling-with-owasp-threat-dragon` (STRIDE + LINDDUN) | whole system | A written threat model in `docs/security/threat-model.md`: data flows (app, web, Supabase, Edge Functions, importer, Cloudflare, Google, Expo push), trust boundaries, and privacy threats for the RGPD. Gives the later steps their list of targets. |
| 1.2 | `insecure-defaults:audit` | `supabase/`, `web/`, `app/src/`, `importer/` | Fallback secrets, fail-open switches, permissive defaults. |
| 1.3 | `sharp-edges:sharp-edges` | `security definer` SQL functions, RLS helpers, `_shared/` function code | Error-prone designs that make the next change insecure. |
| 1.4 | `testing-api-security-with-owasp-top-10` (method only, local stack) | PostgREST + RLS, RPC functions, Edge Functions | Object-level access (API1/BOLA) and property-level access (API3) turned into **pgTAP tests** in `supabase/tests`, not live attacks. |
| 1.5 | `static-analysis:semgrep` ("important only") | whole repository | Injection, XSS in the HTML builder, unsafe redirects. CodeQL already runs on GitHub (0.5). |
| 1.6 | `supply-chain-risk-auditor` | root, `app/`, `web/`, `importer/` lockfiles | Abandoned packages, install scripts, publisher concentration; complements `npm audit` and the allowlist. |
| 1.7 | `agentic-actions-auditor` + a manual workflow review | `.github/workflows/` | Workflow permissions, secret exposure, pinned actions. |
| 1.8 | `differential-review` | every future pull request touching `supabase/`, `web/functions/` or auth code | Ongoing check, not a one-off. |

Optional, if usage allows: Anthropic's `claude-security` plugin for a deep scan of `supabase/` before launch.

**Done when:** the threat model is written, every new finding is fixed or accepted with a reason, and the new pgTAP
tests run in CI.

## Phase 2: speed

| Step | Skill | Target | Baseline and action |
|---|---|---|---|
| 2.1 | `react-native-best-practices` | app lists | About 20 screens use `FlatList`/`ScrollView` and none uses FlashList: measure scrolling on a low-end Android release build, then move the long lists (explore results, chat, members) where it helps. |
| 2.2 | `react-native-best-practices` | startup and bundle | Measure time to interactive on a cold start and the bundle with Expo Atlas; lazy-load heavy screens (map, chat), trim unused imports. |
| 2.3 | `react-native-best-practices` | re-renders | React DevTools profiler on explore and chat; memoise where profiling shows waste. |
| 2.4 | `web-quality-skills:core-web-vitals`, `performance` | public pages (`/activites/*`, `/associations/*`) and `/app` | Lighthouse baseline (LCP, INP, CLS) on the deployed site; then caching headers, CSS size, font loading. |
| 2.5 | Supabase dashboard (Query Performance, index advisor) | database | Slowest queries after real traffic; check the search functions and the importer on the Micro compute size. |

**Done when:** each measured number is recorded before and after, with no regression.

## Phase 3: SEO

The public pages already have canonical URLs, Open Graph tags, sitemaps and JSON-LD (`Event` for activities,
`Organization` for associations). The work is validation and growth, mostly after the site is deployed.

| Step | Skill | Target | Action |
|---|---|---|---|
| 3.1 | `claude-seo:seo-technical`, `seo-sitemap` | robots, sitemaps, canonicals, headers, rendering | Technical audit of the deployed site. |
| 3.2 | `claude-seo:seo-schema` | `web/src/html.ts` | Validate the `Event` and `Organization` markup against Google's rich-result rules; add missing fields (address, geo, image, offers if free), `BreadcrumbList`, and `WebSite` on the home page. |
| 3.3 | `claude-seo:seo-local`, `seo-programmatic` | city and activity pages | Decide whether to add "activities in <city>" landing pages, with safeguards against thin pages and index bloat. |
| 3.4 | `claude-seo:seo-content`, `seo-geo` | French copy, AI search | Page titles and descriptions, E-E-A-T signals, citability for AI answers. |
| 3.5 | Owner | Google Search Console, Bing Webmaster | Verify the domain, submit the sitemap index. |
| 3.6 | `claude-seo:seo-drift` | after launch | Baseline the SEO elements, then check after each deploy. |

**Done when:** rich results validate in Google's test tool, Search Console shows the sitemaps read without errors,
and the drift baseline exists.

## Phase 4: UI

| Step | Skill | Target | Action |
|---|---|---|---|
| 4.1 | `ui-ux-pro-max`, `design-system` | app and site | One design direction and token set (colours, type scale, spacing, radius) shared by the React Native app and the web pages; check contrast. |
| 4.2 | `ui-ux-pro-max` | key screens | Review and rework in this order: sign-in and onboarding, explore, activity page, group chat, profile. Screenshots before and after. |
| 4.3 | `web-quality-skills:accessibility` | site and web build | WCAG 2.2: contrast, labels, keyboard navigation, focus. |
| 4.4 | `ui-ux-pro-max` (React Native rules) | app | Touch targets, screen-reader labels, dark mode, French text lengths. |

**Done when:** the token set is in the code, the reworked screens pass the accessibility checks, and tests still pass.

## Order

1. **Phase 0** now (owner settings, no code).
2. **Phase 1** next, before the closed test: security is the priority.
3. **Phase 4.1** (design tokens) before other UI or SEO page changes, so the pages are only reworked once.
4. **Phases 2, 3 and 4.2-4.4** after that, in any order. The SEO steps that need the live site wait for the
   Cloudflare deployment.

Each step is started in its own session or branch, with this file as the reference.

## Progress

Updated 2026-11-20. Branch `security/threat-model`, not yet pushed or deployed.

| Step | State | Where |
|---|---|---|
| 0.x owner settings | waiting for the owner | `docs/launch/checklist.md`; add two-factor sign-in on every owner account (TM-10) and one backup restore test on a copy (TM-11) |
| 1.1 threat model | done | `docs/security/threat-model.md` |
| 1.2 insecure defaults | done; FN-8 fixed | security review, section 1.2 |
| 1.3 sharp edges | done; DB-9 fixed (search logs capped, misses kept 180 days) | security review, section 1.3; migration `…052` |
| 1.4 access tests | done; TM-1, 2, 3, 5, 12 closed | `supabase/tests/44_threat_model.test.sql` |
| 1.5 semgrep | done; no finding; CI and CodeQL actions pinned | security review, section 1.5 |
| 1.6 supply chain | done; nothing in shipped code | security review, section 1.6 |
| 1.7 workflows, importer role | done in code; owner must switch `IMPORTER_DB_URL` | migration `…053`, `importer/README.md` |
| TM-6 cron secret | done in code; owner must set `CRON_SECRET` and Vault | README, "Dedicated cron secret" |
| TM-14 job monitoring | done: admins get a push when a scheduled job failed | migration `…054` |
| 2.5 database | started: 15 indexes for foreign keys on read paths and account deletion; the rest needs real traffic | migration `…055`, test `47_foreign_key_indexes` |
| 2.1 to 2.4 speed | not started: needs a low-end Android release build and the deployed site | |
| 3.2 structured data | done: Event valid for Google (start, end, status, address, coordinates; none without a planned session) | `web/src/html.ts` |
| 3.1, 3.3 to 3.6 SEO | wait for the deployed site and Search Console | |
| 4.3 site accessibility | checked: contrast 6:1 and more, focus outline, `lang`, one `h1`, dark mode; nothing to fix | `web/public/styles.css` |
| 4.4 app accessibility | checked: every tappable element has a label or text, except modal backdrops (hidden on purpose); 14 text fields, toggles and chips had borders under 3:1 (WCAG 1.4.11), plus the create-activity fields, options and interest tiles found later; all now 4.3:1 | `app/src/lib/theme.ts` |
| 4.1 design tokens | done for colours: every screen uses `colors.*` from `app/src/lib/theme.ts` for the accent, danger, success and warning colours, and the greys are warm tokens (`muted`, `controlBorder`, `divider`, `surface`); only white and a few one-off greens and oranges remain literals | `app/__tests__/theme.test.ts` |
| 4.2 UI rework | started: owner chose warm and welcoming (2026-11-20); site style and home page reworked; logo (two people whose arms make the H) on the site, favicons, social preview image, app icons, web header and onboarding; app screens moved from blue to terracotta and peach, with a test against the old blue | `web/public/styles.css`, `app/assets/`, `app/src/lib/theme.ts` |

**Deploy order** when this branch is merged: push the migrations (`supabase db push`) first, outside the
monthly import run (the `association_tags` index briefly blocks writes to that table), then deploy
`send-push`, `storage-cleanup` and `submit-feedback`, then switch `IMPORTER_DB_URL` and set `CRON_SECRET`.
