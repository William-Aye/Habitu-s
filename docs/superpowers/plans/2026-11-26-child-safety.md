# Activities with children: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activities with children (the Parents category, or any activity marked "Des enfants seront présents") require approval, accept only established accounts, never reveal their place to non-members, and get priority reports and parent advice.

**Architecture:** A new `activities.with_children` flag drives everything. The database enforces the rules (triggers, a check, column privileges) and the security-definer read functions decide per row whether the caller sees the place. The app and the website only render what those functions return.

**Tech Stack:** Supabase Postgres (PostGIS, pgTAP), Expo / React Native app (TypeScript, Jest), Cloudflare Pages site (TypeScript, Deno tests).

**Spec:** `docs/superpowers/specs/2026-11-26-child-safety-design.md` (approved 2026-11-26). Read it before starting.

## Global Constraints

- Branch `feat/child-safety`. New migration files only; never edit an existing migration.
- Never run anything against the hosted project: no `--remote`, no `--linked`, no `supabase db push`. Local stack only.
- Category tree: the category with slug `family` and every category whose parent has slug `family`.
- Requirements to ask to join or to organise: `profiles.photo_url is not null` and `profiles.created_at <= now() - interval '7 days'`. Admins are exempt.
- Refusal: `raise exception 'children_requirements_not_met' using errcode = '42501'`.
- Public point of a with-children activity: the place with longitude and latitude each rounded to 2 decimals (same rounding as `profiles.home_area`).
- French copy fixed by the spec: label "Avec des enfants"; "Lieu communiqué aux participants acceptés"; option "Des enfants seront présents"; report reason "Comportement inquiétant envers des enfants"; "Ajoutez une photo de profil"; "Votre compte doit avoir au moins 7 jours". English strings are the builder's, same meaning. Every key exists in both `app/src/i18n/locales/fr.json` and `en.json` (the `translations` test checks).
- No emoji. Icons from Lucide (per-icon import `lucide-react-native/icons/<kebab>`), always next to text.
- No score or rating of participants.
- Commands. pgTAP: `npx supabase db reset` then `npx supabase test db [file]` from the repo root. App, from `app/`: `npx jest <file>`, `npm test`, `npm run lint`, `npx tsc --noEmit`. Web: `npx --yes deno@2.9.6 test --allow-read=web/public web/src`. Types: `npm run db:types` from the repo root.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Co-organisers are in the spec but not built (no table exists); the co-organiser rule from the design applies when they are built. Note it in Task 7's spec update, nothing else.

## Review Focus

1. **A null place reaching app code that expects a string.** `SessionRow` calls `session.placeLabel.trim()`; calendar, `.ics` and share helpers read the place. A stranger or a pending requester opening a with-children activity must see the page, not a crash. Test in Task 5.
2. **An open activity with members moved into the Parents category.** Approval switches on, existing members stay, non-members lose the place at once. Test in Task 1 and Task 2.
3. **An organiser without a photo editing an existing with-children activity** (title, description). Only creating one, or turning the flag on, checks the requirements; ordinary edits are not refused. Test in Task 1.
4. **Link previews and search engines.** The website page's `<meta name="description">`, Open Graph tags and any session list must not contain the place either. Test in Task 6.
5. **The organiser and admins keep the place**: the organiser in "Mes activités" and on the page, an admin on the page and in the report queue preview. Test in Task 2 and Task 3.

---

### Task 1: The flag, forced approval and the requirements

**Files:**
- Create: `supabase/migrations/20261126000056_activities_with_children.sql`
- Create: `supabase/tests/48_with_children.test.sql`

**Interfaces:**
- Produces:
  - column `public.activities.with_children boolean not null default false`
  - check `activities_children_need_approval`: `not with_children or approval_mode = 'approval'`
  - `public.is_family_category(p_category uuid) returns boolean` (stable, security definer, `search_path = public, pg_temp`; execute revoked from `public`, `anon`; granted to `authenticated`)
  - `public.children_requirements_missing() returns text[]`: for `auth.uid()`, a subset of `{photo, account_age}` in that order, empty when nothing is missing or the caller is an admin (stable, security definer; granted to `authenticated` only)
  - trigger `activities_with_children` (BEFORE INSERT OR UPDATE on `activities`)
  - trigger `activity_members_children_guard` (BEFORE INSERT on `activity_members`)

- [ ] **Step 1: Write the failing pgTAP file** `supabase/tests/48_with_children.test.sql`, using `helpers.inc` like `12_sessions.test.sql`. Set up: a `family` category and child `family-sorties-parents-enfants`, a `go` category; users `org` (photo, created 10 days ago), `newbie` (photo, created 2 days ago), `nophoto` (no photo, created 10 days ago), `ok` (photo, 10 days), `adm` (admin). Assertions:
  - `has_column('public', 'activities', 'with_children', ...)`
  - `org` inserts an activity in `family-sorties-parents-enfants` with `approval_mode = 'open'` and `with_children = false`: the row has `with_children = true` and `approval_mode = 'approval'`.
  - `org` inserts a `go` activity with `with_children = true`: `approval_mode` is `'approval'`.
  - `update ... set with_children = false` on the family activity leaves it `true`; on the `go` activity it becomes `false` (approval stays as it is).
  - an open `go` activity with one member moved to the `family` category: `with_children = true`, `approval_mode = 'approval'`, the member row still has `status = 'member'`.
  - `throws_ok` with `'42501'` and `'children_requirements_not_met'`: `newbie` creates a family activity; `nophoto` creates one; `nophoto` sets `with_children = true` on their own `go` activity.
  - `lives_ok`: `nophoto` organises an old `go` activity flagged by an admin, then updates its title (Review Focus 3).
  - joining: `ok` inserting into `activity_members` of the family activity gets `status = 'pending'`; `newbie` and `nophoto` are refused with `children_requirements_not_met`; joining a `go` activity without the flag still works for `newbie`.
  - `children_requirements_missing()` as `nophoto` = `'{photo}'`; as `newbie` = `'{account_age}'`; as a user with neither = `'{photo,account_age}'`; as `adm` = `'{}'`.
  - `is(has_function_privilege('anon', 'public.children_requirements_missing()', 'execute'), false, ...)`

- [ ] **Step 2: Run it and see it fail**

Run: `npx supabase db reset && npx supabase test db supabase/tests/48_with_children.test.sql`
Expected: FAIL (column `with_children` does not exist).

- [ ] **Step 3: Write the migration.** Add the column and the check (backfill existing rows: set `with_children = true, approval_mode = 'approval'` where `is_family_category(category_id)`, before adding the check). `activities_with_children` does, in order: force `with_children := true` when `is_family_category(new.category_id)`; force `approval_mode := 'approval'` when `new.with_children`; when the flag is on and it is an INSERT or `old.with_children` was false, and `current_user in ('anon', 'authenticated')` and not `is_admin()`, refuse if `cardinality(children_requirements_missing()) > 0`. `activity_members_children_guard` refuses an insert by `anon`/`authenticated` (not admin) into a with-children activity when requirements are missing. Grant column `SELECT (with_children)` on `activities` to `anon, authenticated` (the table uses column grants).

- [ ] **Step 4: Run it and see it pass**

Run: `npx supabase test db supabase/tests/48_with_children.test.sql`
Expected: PASS.

- [ ] **Step 5: Run every pgTAP test**

Run: `npx supabase test db`
Expected: all files pass. A test that creates a `family` activity as `open` may now need adjusting; the security-invariant tests (`40_`, `41_`, `44_`) must keep passing unchanged.

- [ ] **Step 6: Commit** `feat(db): activities with children need approval and established accounts`

### Task 2: The place stays hidden from non-members

**Files:**
- Create: `supabase/migrations/20261126000057_hide_children_places.sql`
- Create: `supabase/tests/49_children_places.test.sql`
- Modify: existing pgTAP files that read `place`/`place_label` while acting as `anon` or `authenticated` (find them with the full run in Step 5)

**Interfaces:**
- Consumes: `activities.with_children` (Task 1).
- Produces:
  - column `public.activities.search_point geography(Point, 4326)`, generated and stored: the rounded place when `with_children`, else `place`; gist index `activities_search_point_gist`
  - `get_activity(p_id)` adds keys `with_children boolean`, `place_hidden boolean`, `children_requirements_missing text[]`; when `place_hidden`, `place_label`, `lon`, `lat` are null and every `next_sessions[].place_label` is null
  - `session_card(p_session, p_with_attendees)` (same signature): `place_label` null when the activity is with children, `p_with_attendees` is false and the caller is not an admin
  - `my_activities()` adds `with_children`; `place_label` null for a with-children activity unless the caller is its organiser or a `member`
  - `search_explore(...)` (same signature): activity results use `search_point` for `lon`, `lat`, `distance_km` and the radius filter; `subtitle` is null for with-children activities; every item has `with_children boolean`

- [ ] **Step 1: Write the failing pgTAP file** `supabase/tests/49_children_places.test.sql`. Set up a family activity `F` by `org` at `POINT(4.85123 45.76789)` with one member `mem`, one pending requester `pend`, a stranger `out`, an admin `adm`, and a `go` activity `G` without the flag. Assertions:
  - as `anon` and as `out`: `throws_ok` with `'42501'` on `select place from activities`, `select place_label from activities`, `select search_point from activities`, `select place from sessions`, `select place_label from sessions`; `lives_ok` on `select id, title, with_children from activities` and `select id, starts_at from sessions`.
  - `get_activity(F)` as `anon`, `out` and `pend`: `place_hidden = true`, `place_label`, `lon`, `lat` null, no non-null `place_label` in `next_sessions`; `children_requirements_missing` is `[]` for `anon`.
  - `get_activity(F)` as `mem`, `org` and `adm`: `place_hidden = false` and the exact `lon` 4.85123 / `lat` 45.76789.
  - `get_activity(G)` as `anon`: place shown (activities without children unchanged).
  - `my_activities()` as `pend`: `F` listed with null `place_label`; as `org`: `F` with its `place_label` (Review Focus 5).
  - `search_explore(4.85, 45.77, 5)` as `anon`: the `F` item has `lon` 4.85, `lat` 45.77, `subtitle` null, `with_children` true; the `G` item has its exact point.
  - radius edge: with `F` placed so that the exact point is inside a 5 km radius from centre C but the rounded point is outside (pick coordinates accordingly), `F` is absent from `search_explore` at C; and the reverse case is present.
  - after moving the open `G` (with a member) into the `family` category, `get_activity(G)` as `anon` has `place_hidden = true` (Review Focus 2).

- [ ] **Step 2: Run it and see it fail**

Run: `npx supabase db reset && npx supabase test db supabase/tests/49_children_places.test.sql`
Expected: FAIL.

- [ ] **Step 3: Write the migration.**
  - `activities`: `revoke select (place, place_label) on public.activities from anon, authenticated` (column grants). Add `search_point` and its index; grant it to nobody.
  - `sessions`: `anon` and `authenticated` hold a table-level `SELECT`, which a column revoke does not override. Revoke the table-level `SELECT` from both, then grant column `SELECT` on every other column of `sessions` (`id, activity_id, starts_at, status, cancelled_at, is_discovery`, plus any column added since; list them from `information_schema.columns`).
  - Recreate `get_activity`, `session_card`, `my_activities`, `search.explore_rows` and `search_explore` with `create or replace`, starting from their current bodies taken with `select pg_get_functiondef(...)` on the freshly reset local database (the newest migration wins; do not rebuild them from older files). In `get_activity` add `v_sees_place := not a.with_children or v_sees_people or public.is_admin()`. In `search.explore_rows` replace `x.place` with `x.search_point` in the distance and the `ST_DWithin` filter. In `search_explore`, take the point from `x.search_point` and the subtitle from `case when x.with_children then null else x.place_label end`, and add `with_children` (false for associations and collectifs).
  - Keep every existing grant and `revoke` of those functions as it is.

- [ ] **Step 4: Run it and see it pass**

Run: `npx supabase test db supabase/tests/49_children_places.test.sql`
Expected: PASS.

- [ ] **Step 5: Run every pgTAP test and fix readers of the revoked columns**

Run: `npx supabase test db`
Expected: all pass. Tests that `select place...` after `tests.act_as(...)` must read through the functions or switch to `tests.act_as_superuser()` for setup; never weaken an assertion about privacy.

- [ ] **Step 6: Check search performance has not moved.** Run `explain analyze select search_explore(4.8357, 45.7640, 10)` before and after on the local stack and confirm the plan uses `activities_search_point_gist`. CI's "Search ranking" job runs the ranking tests; run them locally only if `uv` and the model cache are present: `cd importer && uv run pytest -m ranking`.

- [ ] **Step 7: Commit** `feat(db): hide the place of activities with children from non-members`

### Task 3: Priority reports and the requester's facts

**Files:**
- Create: `supabase/migrations/20261126000058_child_safety_reports.sql`
- Create: `supabase/tests/50_child_safety_reports.test.sql`
- Modify: `supabase/tests/16_activity_roster.test.sql` (new columns)

**Interfaces:**
- Consumes: `activities.with_children`.
- Produces:
  - report reason `child_safety` accepted by `reports_reason_check`
  - `public.report_is_priority(p_reason text, p_target_type text, p_target_id uuid) returns boolean` (stable, security definer, not executable by `anon`/`authenticated`): true when the reason is `child_safety`, or the target is a with-children activity, a session of one, or a message in one
  - `admin_reports(p_status text default 'open', p_before_at timestamptz default null, p_before_id uuid default null, p_limit int default 30, p_priority boolean default false)`: each item gains `priority boolean`; the result gains `priority_open_count int`; `p_priority = true` returns only priority reports (same ordering and cursor)
  - `activity_roster(p_activity uuid)` returns `table(user_id uuid, first_name text, photo_url text, status text, bio text, member_since timestamptz)`; `bio` and `member_since` are filled for `pending` rows only, null for members

- [ ] **Step 1: Write the failing pgTAP file** `supabase/tests/50_child_safety_reports.test.sql`:
  - a user can insert a report with reason `child_safety` on a `user`, `activity`, `session` and `message` target.
  - `report_is_priority` is true for: reason `child_safety` on a `go` activity; reason `harassment` on a family activity, on one of its sessions, on a message in its chat; false for `harassment` on a `go` activity.
  - as admin (`tests.act_as_admin`): `admin_reports()->'priority_open_count'` counts those four; `admin_reports(p_priority => true)` returns only priority items, each with `priority = true`; the activity preview of a family activity still contains its place (Review Focus 5).
  - as a plain user: `admin_reports(p_priority => true)` raises `42501`.
  - `activity_roster` as the organiser: the pending row has the requester's `bio` and `member_since` = their `profiles.created_at`; member rows have both null.
  - `has_function_privilege('authenticated', 'public.admin_reports(text, timestamptz, uuid, integer, boolean)', 'execute')` is true; for `anon` it is false.

- [ ] **Step 2: Run it and see it fail**

Run: `npx supabase db reset && npx supabase test db supabase/tests/50_child_safety_reports.test.sql`
Expected: FAIL.

- [ ] **Step 3: Write the migration.** Replace the reason check. Drop and recreate `admin_reports` and `activity_roster` (their signatures or return types change), restoring exactly the grants and revokes they have today. Keep the `is_admin()` and organiser checks as they are.

- [ ] **Step 4: Run it, then every pgTAP test, and see them pass**

Run: `npx supabase test db supabase/tests/50_child_safety_reports.test.sql && npx supabase test db`
Expected: PASS (update the column assertions in `16_activity_roster.test.sql`).

- [ ] **Step 5: Commit** `feat(db): child-safety report reason, priority queue and requester facts`

### Task 4: App data layer

**Files:**
- Modify: `app/src/lib/database.types.ts` (regenerated)
- Modify: `app/src/features/activities/types.ts`, `api.ts`, `errors.ts`
- Modify: `app/src/features/safety/types.ts`
- Modify: `app/src/features/explore/types.ts`, `api.ts`
- Modify: `app/src/features/admin/api.ts`
- Test: `app/__tests__/activities-api.test.ts`, `explore-api.test.ts`, `safety-api.test.ts`, `admin.test.tsx`

**Interfaces:**
- Consumes: the function outputs of Tasks 1 to 3.
- Produces:
  - `ActivityPage`: `placeLabel: string | null`, `lon: number | null`, `lat: number | null`, `withChildren: boolean`, `placeHidden: boolean`, `childrenRequirementsMissing: ('photo' | 'account_age')[]`
  - `SessionInfo.placeLabel: string | null`; `MyActivity.placeLabel: string | null`, `MyActivity.withChildren: boolean`
  - `ActivityDraft.withChildren: boolean`, sent as `with_children` by `createActivity`
  - `ApiError` gains `'children_requirements'`; `mapError` returns it when the code is `42501` and the message contains `children_requirements_not_met`; it is in `KNOWN_ERRORS`
  - `RosterEntry` gains `bio: string | null`, `memberSince: string | null`
  - `ExploreResult.withChildren: boolean`
  - `ReportReason` gains `'child_safety'`; `ReportTarget` gains `withChildren?: boolean`; `reasonsFor(type: ReportTargetType, opts?: { withChildren?: boolean }): ReportReason[]` puts `child_safety` first when `opts.withChildren` and the type is `user`, `activity`, `session` or `message`
  - admin `listReports` (the function wrapping `admin_reports` at `features/admin/api.ts`) takes `priority?: boolean` and returns `priorityOpenCount: number` and `priority: boolean` per item

- [ ] **Step 1: Regenerate the types**

Run: `npm run db:types` (repo root, local stack running). Expected: `database.types.ts` shows `with_children` and the new function arguments.

- [ ] **Step 2: Write the failing tests**
  - `activities-api.test.ts`: `mapActivity` of a payload with `with_children: true, place_hidden: true, place_label: null, lon: null, lat: null, children_requirements_missing: ['photo']` gives `placeLabel: null`, `placeHidden: true`, `withChildren: true`, `childrenRequirementsMissing: ['photo']`; a payload without those keys gives `withChildren: false`, `placeHidden: false`, `[]`. `createActivity` sends `with_children: true` when the draft says so. `mapError({ code: '42501', message: 'children_requirements_not_met' })` is `'children_requirements'`.
  - `explore-api.test.ts`: a result with `with_children: true` maps to `withChildren: true`; missing key maps to `false`.
  - `safety-api.test.ts`: `reasonsFor('activity', { withChildren: true })[0]` is `'child_safety'`; `reasonsFor('activity')` does not contain it; `reasonsFor('association', { withChildren: true })` does not contain it.
  - `admin.test.tsx`: the reports call passes `p_priority: true` when asked and maps `priority_open_count`.

- [ ] **Step 3: Run them and see them fail**

Run (from `app/`): `npx jest __tests__/activities-api.test.ts __tests__/explore-api.test.ts __tests__/safety-api.test.ts __tests__/admin.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement the interfaces above.** `npx tsc --noEmit` will list every screen that now receives a nullable place; leave those screens to Task 5 but make them compile (render nothing for a null place).

- [ ] **Step 5: Run the tests, the type check and the whole suite**

Run (from `app/`): `npx jest __tests__/activities-api.test.ts __tests__/explore-api.test.ts __tests__/safety-api.test.ts __tests__/admin.test.tsx && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 6: Commit** `feat(app): data layer for activities with children`

### Task 5: App screens for viewers and members

**Files:**
- Modify: `app/src/app/activites/[id].tsx`, `app/src/features/activities/SessionRow.tsx`, `app/src/app/(tabs)/my-activities.tsx`, `app/src/features/explore/components/ResultCard.tsx`
- Modify: `app/src/features/activities/calendar.ts`, `calendar.web.ts`, `ics.ts`, `app/src/features/safety/shareMyPlans.ts` (null-safe place)
- Modify: `app/src/features/safety/tips.ts`, `ReportSheet.tsx` and the callers that open it on the activity page, session rows and chat
- Modify: `app/src/i18n/locales/fr.json`, `en.json`
- Test: `app/__tests__/activity-page.test.tsx`, `session.test.tsx`, `my-activities.test.tsx`, `explore-screen.test.tsx`, `report-block.test.tsx`, `safety-tips.test.tsx`, `web-ics.test.ts`

**Interfaces:**
- Consumes: Task 4's types.
- Produces: `TipId` gains `'with_children'` with lines `safety.tips.with_children.a` to `.d` (child stays with their parent and is never left with another adult; meet only in the public place; no photos of children or personal details in the chat; report anything worrying).

- [ ] **Step 1: Write the failing tests**
  - `activity-page.test.tsx`, with `placeHidden: true, withChildren: true`: shows "Lieu communiqué aux participants acceptés" and "Avec des enfants"; no "Voir sur la carte"; no element containing the fixture's place. With `childrenRequirementsMissing: ['photo', 'account_age']`: shows "Ajoutez une photo de profil" and "Votre compte doit avoir au moins 7 jours" and the join button is disabled. With `[]`: the join button is enabled and reads as a request (approval). The first view shows the `with_children` tip.
  - `session.test.tsx`: `SessionRow` renders with `placeLabel: null` on a with-children activity without throwing and shows no place line (Review Focus 1).
  - `my-activities.test.tsx`: a pending with-children item with `placeLabel: null` shows "Lieu communiqué aux participants acceptés".
  - `explore-screen.test.tsx`: a result with `withChildren: true` shows "Avec des enfants" and its accessibility label includes it.
  - `report-block.test.tsx`: reporting from a with-children activity page lists "Comportement inquiétant envers des enfants" first.
  - `web-ics.test.ts`: building an `.ics` with a null place gives a valid file without a `LOCATION` line.
  - `safety-tips.test.tsx`: the "Conseils de sécurité" page lists the four `with_children` lines.

- [ ] **Step 2: Run them and see them fail**

Run (from `app/`): `npx jest __tests__/activity-page.test.tsx __tests__/session.test.tsx __tests__/my-activities.test.tsx __tests__/explore-screen.test.tsx __tests__/report-block.test.tsx __tests__/safety-tips.test.tsx __tests__/web-ics.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** On the activity page, the hidden-place line replaces both `TownMap` and the place line when `placeHidden`; the "Avec des enfants" badge sits next to the category badge with a Lucide `baby` icon; the requirements block sits above the join button and, on the web, says the photo is added in the app (`Platform.OS === 'web'`). Pass `withChildren` to every `openReport(...)` from this page, its session rows and its chat.

- [ ] **Step 4: Run them, then lint, type check and the whole suite**

Run (from `app/`): `npx jest <the files above> && npm run lint && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 5: Commit** `feat(app): show activities with children safely to viewers and members`

### Task 6: App screens for organisers and admins

**Files:**
- Modify: `app/src/features/activities/steps/SettingsStep.tsx`, `app/src/features/activities/steps/WhatStep.tsx` (or wherever the draft's category and description are set), `app/src/features/activities/CreateActivityFlow.tsx`, `app/src/features/activities/form.ts`
- Modify: `app/src/features/activities/OrganiserTools.tsx` (roster facts)
- Modify: `app/src/app/admin/[queue].tsx` (priority list)
- Modify: `app/src/i18n/locales/fr.json`, `en.json`
- Test: `app/__tests__/create-activity.test.tsx`, `activity-form.test.ts`, `activity-page.test.tsx` (organiser tools), `admin.test.tsx`

**Interfaces:**
- Consumes: Task 4's `ActivityDraft.withChildren`, `RosterEntry.bio/memberSince`, admin `priority`.
- Produces:
  - `isFamilyCategory(categoryId: string, categories: { id: string; slug: string; parentId: string | null }[]): boolean` in `app/src/features/activities/form.ts`
  - `myChildrenRequirements(): Promise<ApiResult<{ missing: ('photo' | 'account_age')[] }>>` in `app/src/features/activities/api.ts`, calling `children_requirements_missing`

- [ ] **Step 1: Write the failing tests**
  - `activity-form.test.ts`: `isFamilyCategory` is true for `family` and its children, false for others and for an unknown id.
  - `create-activity.test.tsx`: choosing a Parents category sets `withChildren` and shows approval on and locked with one explaining line; for another category, the "Des enfants seront présents" switch sets `withChildren` and locks approval; turning it off unlocks approval. The description step shows the hint not to write the address. A `children_requirements` error from `createActivity` shows "Ajoutez une photo de profil" or the 7-day line according to `children_requirements_missing()` (call it through a new `myChildrenRequirements()` in `api.ts` returning `('photo' | 'account_age')[]`).
  - `activity-page.test.tsx`: in organiser tools, a pending request shows the requester's bio and "Membre depuis <month year>".
  - `admin.test.tsx`: with `priorityOpenCount > 0`, the reports queue shows a "Prioritaires" section above the others, filled from the `priority: true` call.

- [ ] **Step 2: Run them and see them fail**

Run (from `app/`): `npx jest __tests__/activity-form.test.ts __tests__/create-activity.test.tsx __tests__/activity-page.test.tsx __tests__/admin.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** the switch, the lock, the hint, `myChildrenRequirements()`, the roster facts and the admin section.

- [ ] **Step 4: Run them, then lint, type check and the whole suite**

Run (from `app/`): `npx jest <the files above> && npm run lint && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 5: Commit** `feat(app): organiser and admin tools for activities with children`

### Task 7: Website, terms and spec

**Files:**
- Modify: `web/src/html.ts` (`renderActivityPage`), `web/src/copy.ts`, `web/src/fixtures.ts`, `web/src/legal.ts`
- Modify: `docs/specs/2026-10-21-friend-app-design.md` (section 9)
- Test: `web/src/html_test.ts`, `web/src/legal_test.ts`

**Interfaces:**
- Consumes: `get_activity` keys `place_hidden`, `with_children` (through `web_activity_page`).
- Produces: `copy.activity.placeHidden = "Lieu communiqué aux participants acceptés"`, `copy.activity.withChildren = "Avec des enfants"`.

- [ ] **Step 1: Write the failing tests**
  - `html_test.ts`, with a fixture activity that has `place_hidden: true, with_children: true, place_label: null, lon: null, lat: null` and a distinctive title: the HTML contains "Lieu communiqué aux participants acceptés" and "Avec des enfants", has no `application/ld+json` block with `"Event"`, no OpenStreetMap link, and the fixture place used in the visible version of the same activity appears nowhere, including in `<meta name="description">` and `og:` tags (Review Focus 4). The visible fixture is unchanged.
  - `legal_test.ts`: the terms contain "sous la seule responsabilité de leur parent" and say Habituer does not check identities or criminal records.

- [ ] **Step 2: Run them and see them fail**

Run: `npx --yes deno@2.9.6 test --allow-read=web/public web/src`
Expected: FAIL.

- [ ] **Step 3: Implement** in `renderActivityPage` and `legal.ts`. Add the "Activities with children" subsection to spec section 9 (rules from the design, including that co-organisers, when built, need the same photo and 7-day account).

- [ ] **Step 4: Run the web tests and the web build**

Run: `npx --yes deno@2.9.6 test --allow-read=web/public web/src && npm run web:build`
Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): activity pages with children hide the place; terms and spec`

### Task 8: Whole-branch check

- [ ] **Step 1: Run everything**

Run, from the repo root: `npx supabase db reset && npx supabase test db && npm run web:test && npm run scripts:test`, then from `app/`: `npm test && npm run lint && npx tsc --noEmit`.
Expected: every command passes.

- [ ] **Step 2: Check the raw API by hand on the local stack.** With the local anon key, `curl "http://127.0.0.1:55321/rest/v1/activities?select=place_label"` and `.../sessions?select=place` must fail with a permission error; `.../rpc/get_activity` for a with-children activity must return `place_hidden: true`.

- [ ] **Step 3: Note the owner's deploy step.** Add a line to `docs/launch/checklist.md` step 3: migrations 56 to 58 go out with the next `supabase db push`, together with the website deploy (the site reads the new keys).

- [ ] **Step 4: Commit** `docs: deploy note for activities with children`
