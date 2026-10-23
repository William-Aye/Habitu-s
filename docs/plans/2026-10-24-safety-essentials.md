# Safety Essentials (Sub-project 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People can report and block anywhere, see safety tips at the right moment, share their plans with someone they trust, and send ideas or problems to the team. Admins, protected by two-factor sign-in and an audit log, can review reports with a statement of reasons, plus claims, community-added clubs, category requests and feedback. Abuse limits, a first automatic filter and the retention jobs enforce the rules without anyone watching.

**Architecture:** The database does most of the work.
- The **admin migration** makes `is_admin()` require a two-factor session (`aal2`) and adds `admin_audit_log`. Every admin action goes through a security-definer RPC that checks `is_admin()`, applies the effect and writes the audit row in the same transaction.
- The **moderation migration** extends reports (more target types, a rate limit, a queue RPC, decisions with effects, outcome notices). It also adds the banned-word filter, the remaining write limits, and the claim and collectif-to-association flows.
- The **retention migration** schedules the pg_cron deletions from §18.2.
- **Anonymous feedback** goes through a small Edge Function that checks Cloudflare Turnstile before inserting.
- **The app** gains a shared report sheet, a blocked-people list, safety tips with a "Conseils de sécurité" page, "Partager mon programme", a feedback form, a claim form, and an `/admin` area (two-factor enrolment and five queues).

**Tech Stack:**
- Supabase: Postgres (RLS, pg_cron), Auth MFA (TOTP, free), Storage (private buckets), Edge Functions (Deno), pgTAP.
- Cloudflare Turnstile (existing).
- OpenStreetMap Overpass API (free) for the public-place check.
- Expo (expo-router), React Native `Share`, `expo-image-picker` (existing), i18next, Lucide, Jest with Testing Library.

**Spec:** `docs/specs/2026-10-21-friend-app-design.md`. This plan implements:
- §8 "Une idée ? Un problème ?" and the claim button on the association page;
- §9 Safety: report and block, Partager mon programme, contextual safety tips;
- §11 Moderation and admin: reports queue with statement of reasons, category requests, community clubs, claims, feedback queue, automatic first filter, database write limits;
- §13 privacy and security tests;
- §14 Release 1 item 7;
- §18.2 retention;
- §18.4 admin 2FA and audit log.

It also picks up the items earlier plans deferred to this one: private-place detection, admin review of collectifs, linking a collectif to its association, and the three-year report purge. It builds on every plan in `docs/plans/`.

## Decisions for the owner to confirm

1. **Banning.** "Bannir" uses Supabase Auth's built-in ban, which blocks signing in and refreshing the session. The person's activities are archived, their collectif roles end, and their messages stay hidden from everyone. A session already open stops working within an hour at most, when its token expires. *Owner to confirm.*
2. **Moderation notices (EU Digital Services Act).** After a decision, the person who reported gets a short in-app notice: "Votre signalement a été traité". The person whose content was removed, or who was warned or banned, gets the statement of reasons in the app. Both also get a discreet push: "Information de modération" / "Ouvrez l'application pour voir le détail.". *Owner to confirm.*
3. **First automatic filter.** Admins keep a list of forbidden words, matched without accents or case on whole words.
   - A chat message, activity, collectif or community club containing a forbidden word is refused with a clear message.
   - A text that looks like spam is accepted but goes straight into the reports queue as an automatic report. Spam means more than 3 links, or the same text posted 3 times within 10 minutes by the same person.
   - *Owner to confirm.*
4. **Public-place check (free).** When an organiser publishes an activity or moves a session, the app asks OpenStreetMap (Overpass, free) whether there is a café, shop, park, sports hall or other public place within 60 m. If there isn't, a stronger warning asks them to confirm. They can still publish, and the check never blocks if the service is down. *Owner to confirm.*
5. **Accounts inactive for 3 years.** They are warned by a push notification and a notice in the app 30 days before deletion, then deleted. The spec mentions an email, which would need a paid or quota-limited email service, so it's left for later. *Owner to confirm.*
6. **Feedback.** Signing in is not required. Anonymous senders pass the invisible Turnstile check through a small server function. A screenshot can only be attached when signed in. It is stored privately and deleted with the feedback, which is kept **2 years**. *Owner to confirm.*
7. **Association claims.** The claimant gives their role and either an email address at the association's own domain or a document (statuts, récépissé or a signed letter), stored privately. An admin checks it by hand; there is no automatic email check. Once approved, the listing shows "Association vérifiée" and the claimant can edit it. *Owner to confirm.*
8. **A collectif that becomes an association.** Once the responsable's claim on that association is approved, they can "Rattacher le collectif". The collectif's activities then show "Organisé par <association>". The collectif stays, and its responsable can delete it. *Owner to confirm.*
9. **Admin two-factor sign-in.** Admins use an authenticator app (TOTP, free). Without it they see an enrolment screen, and every admin right stays off until the second factor has been entered in that session. The admin audit log is kept 3 years. *Owner to confirm.*

## Global Constraints

- **Admin rule:** `public.is_admin()` returns true only when `profiles.role = 'admin'` **and** `(auth.jwt() ->> 'aal') = 'aal2'`.
  - Every admin RPC is `security definer` with `set search_path = public, pg_temp`. It raises 42501 `not_allowed` unless `is_admin()`, and inserts one `admin_audit_log` row: `admin_id, action, target_type, target_id, details jsonb, created_at`.
  - Admins can never edit or delete audit rows, and nobody else can read them.
- **Write limits** (§11; trigger plus advisory lock `hashtext('limits:'||auth.uid())`, raising 42501 `limit_reached`; admins and the service role are exempt):
  - reports: 5 per hour;
  - feedback: 3 per hour per signed-in user;
  - category requests: 5 per day;
  - join requests (inserts into `activity_members`): 20 per day.
  - Messages, activities, collectifs, community clubs and invitations already have limits.
  - **Count from insert-only logs** (`limit_log(user_id, kind, at)`, with no API grants), so deleting a row never frees a slot.
- **Report targets:** `user`, `activity`, `message`, `association`, `collectif`, `session`. Reasons: `unsafe_place`, `inappropriate_behaviour`, `harassment`, `fake_or_spam`, `did_not_happen`, `other`.
  - A user can report only something they can currently see. A report of something they can't see is refused with `not_allowed`.
  - `reporter_id` is pinned to `auth.uid()`.
  - Automatic reports have a null reporter and `source = 'auto'`.
- **Decisions:** `dismiss | warn | remove | ban`. Each needs a `statement_of_reasons` of 10–1000 characters.
  - `remove` deletes a message; archives an activity; cancels a session; sets `associations.removed_at`; deletes a collectif; for a user, archives their activities and deletes their messages.
  - `ban` bans the account responsible: the target user, or the author/organiser/creator of the target.
  - Upheld reports (`warn`, `remove`, `ban`) have `status = 'actioned'`.
- **Retention (§18.2), nightly pg_cron in UTC:**

  | Data | Retention |
  |---|---|
  | Reports and `report_snapshots` | 3 years after `decided_at`, or after `created_at` while still open |
  | `admin_audit_log` | 3 years |
  | Feedback and its screenshot | 2 years |
  | Raw `session_feedback` | 6 months |
  | Inactive accounts | Notice at 35 months without `last_seen_at`; deletion at 36 months plus 30 days if still inactive |
  | `limit_log` | 1 day (hourly job), so 24-hour limits still see their history |

  Messages (12 months) and the outbox (30 days) are already scheduled.
- **Copy (French source, exact):**
  - **Reporting:**
    - "Signaler", "Signaler cette activité", "Signaler cette personne", "Signaler ce collectif", "Signaler une erreur / Retirer cette fiche", "Signaler cette séance".
    - Reasons: "Lieu dangereux ou inadapté", "Comportement inapproprié", "Harcèlement", "Faux ou spam", "N'a pas eu lieu", "Autre".
    - "Précisez (facultatif)", "Envoyer le signalement", "Merci, votre signalement a été envoyé.", "Vous avez atteint la limite de signalements. Réessayez plus tard."
  - **Blocking:** "Bloquer", "Personnes bloquées", "Débloquer", "Aucune personne bloquée".
  - **Safety tips and sharing:**
    - "Conseils de sécurité", "Partager mon programme", "Compris".
    - The message "{{titre}} — {{date}} à {{heure}}, {{lieu}}. Je vous préviens au cas où. (Habitués)".
  - **Feedback:**
    - "Une idée ? Un problème ?"; types "Idée", "Problème", "Autre"; "Ajouter une capture d'écran"; "Envoyer".
    - "Merci ! Votre message a bien été envoyé à l'équipe."
  - **Claims:**
    - "C'est mon association", "Votre rôle dans l'association", "Adresse e-mail de l'association", "Ou joindre un justificatif".
    - "Demande envoyée. Nous vous répondrons sous quelques jours."
  - **Collectif:** "Rattacher le collectif à cette association".
  - **Public-place check:** "Aucun lieu public trouvé à proximité. Confirmez que ce n'est pas un domicile.", "Je confirme : c'est un lieu public".
  - **Moderation:** "Information de modération", "Votre signalement a été traité".
  - **Inactive accounts:** "Votre compte sera supprimé dans 30 jours faute d'activité. Ouvrez l'application pour le garder."
  - **Filter:** "Ce texte contient un mot interdit."
  - **Admin:**
    - "Administration", "Activer la double authentification", "Code à 6 chiffres", "Signalements", "Revendications", "Clubs ajoutés", "Catégories", "Idées et problèmes".
    - Decisions: "Classer sans suite", "Avertir", "Retirer", "Bannir".
    - "Motif de la décision (obligatoire)".
- **Safety tips** (exact French, ids in brackets):
  - [`where`] the existing home tip.
  - [`first_session`] "Pour une première rencontre, restez dans le lieu public et organisez votre propre trajet." and "Prévenez un proche de l'endroit où vous allez."
  - [`moved_place`] "Les activités doivent se dérouler dans un lieu public. Si ce nouveau lieu vous semble inadapté, signalez-le."
  - [`private_message`] reserved for Release 2.
- **General rules:**
  - No hard-coded UI text and no emoji.
  - Lucide icons always come with text labels, and every control has a screen-reader label.
  - Buttons are disabled while busy.
  - RNTL 14 needs `await`.
  - Local Supabase runs on ports 553xx.
  - Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An admin on a stolen or old session without 2FA.** `is_admin()` is false on an `aal1` token, so every admin RPC and admin-only policy refuses. The app shows the enrolment or verification screen, never admin data. → tests in Tasks 1 and 9.
2. **Reporting to spy.** Reporting an id you can't see (another activity's message, a hidden activity, a blocked person) must be refused with the same `not_allowed` as a missing id, so it can't reveal that the target exists or what it contains. → test in Task 2.
3. **A decision applied twice, or to content that is already gone.** Deciding an already-decided report is refused. Removing content that was deleted meanwhile still records the decision without failing. Banning someone already banned is idempotent. → tests in Task 2.
4. **The retention jobs delete exactly the expired rows,** never a row one day younger, never a non-expired report's snapshot, and never an active account. → tests in Task 4.
5. **The Overpass check is slow, rate-limited or down.** Publishing goes ahead after 4 seconds without the stronger warning, never stuck on a spinner. → test in Task 7.

---

## File Map

```
supabase/migrations/20261024000029_admin_security.sql      is_admin aal2, admin_audit_log, admin helper, ban
supabase/migrations/20261024000030_moderation.sql          reports v2, queue + decisions, notices, limits, filter
supabase/migrations/20261024000031_claims_requests.sql     claims, community clubs, category requests, feedback queue, collectif link
supabase/migrations/20261024000032_retention.sql           pg_cron retention jobs, inactive accounts
supabase/functions/submit-feedback/{index.ts,handler.ts,handler_test.ts}
supabase/tests/24_admin_security, 25_moderation, 26_claims_requests, 27_retention (.test.sql)
app/src/features/safety/   ReportSheet.tsx, reports.ts, blocks.ts, BlockedList.tsx, SafetyTip.tsx, tips.ts, shareMyPlans.ts, publicPlace.ts
app/src/features/feedback/ FeedbackForm.tsx, api.ts
app/src/features/claims/   ClaimForm.tsx, api.ts
app/src/features/admin/    api.ts, MfaGate.tsx, ReportsQueue.tsx, ClaimsQueue.tsx, ClubsQueue.tsx, CategoriesQueue.tsx, FeedbackQueue.tsx
app/src/app/admin/_layout.tsx, admin/index.tsx, admin/[queue].tsx, feedback.tsx, safety-tips.tsx, blocked.tsx
```

---

### Task 1: Admin two-factor rule, audit log and ban (database)

**Files:** Create `supabase/migrations/20261024000029_admin_security.sql` and `supabase/tests/24_admin_security.test.sql`.

**Interfaces:**
- **Produces:**
  - **`public.is_admin()`**, redefined with `create or replace` and keeping the same signature and grants. It returns true only for an admin role **and** `auth.jwt()->>'aal' = 'aal2'`.
  - **Table `public.admin_audit_log`:**
    - Columns: `id uuid pk`, `admin_id uuid references profiles on delete set null`, `action text not null`, `target_type text`, `target_id uuid`, `details jsonb not null default '{}'`, `created_at timestamptz not null default now()`.
    - RLS is on, with no API grants. Admins read it through `admin_audit_page(p_before timestamptz default null, p_limit int default 50) returns jsonb`.
  - **`public.admin_log(p_action text, p_target_type text, p_target_id uuid, p_details jsonb default '{}') returns void`:** internal, revoked from every API role, and called by every admin RPC.
  - **`public.ban_user(p_user uuid, p_reason text) returns void`:** internal. It does four things:
    - sets `auth.users.banned_until = 'infinity'`;
    - sets `profiles.banned_at = now()` (new column `banned_at timestamptz`);
    - archives the user's activities;
    - deletes their `collectif_members` rows, which lets the existing responsable hand-over trigger run.

    It is idempotent.
  - **Test helper `tests.act_as_admin(uuid)`**, added to `helpers.inc`. It sets claims with `aal: 'aal2'`.
  - **Existing tests:** existing tests that act as an admin get `aal2`. Update `helpers.inc` and any test using an admin JWT.
- [ ] **Step 1: Failing tests** (`24_admin_security`):
  - **The 2FA rule:** an admin with `aal1` has `is_admin()` false and can't read `reports` (the admin policy). With `aal2` it's true. A non-admin with `aal2` gets false.
  - **The audit log:** `admin_audit_log` can't be selected, inserted, updated or deleted by authenticated users (42501), including admins. `admin_audit_page` refuses `aal1` and non-admins, and returns rows newest first for `aal2`.
  - **Banning:** `ban_user` sets `banned_until` to infinity and `banned_at`, archives the user's activities, removes their collectif memberships and promotes the next organiser. Calling it twice changes nothing more.
  - **Internal functions:** `admin_log` and `ban_user` can't be executed by authenticated or anon users.
- [ ] **Step 2: Run RED**, with `npm run db:reset && npm run db:test`.
- [ ] **Step 3: Implement**, then update `helpers.inc` and the existing admin tests so the whole suite passes.
- [ ] **Step 4: Run GREEN**, then `npm run db:types`.
- [ ] **Step 5: Commit** with the message `feat(db): admins need two-factor sessions; audit log and account ban`.

---

### Task 2: Reports, decisions, limits and the first filter (database)

**Files:** Create `supabase/migrations/20261024000030_moderation.sql` and `supabase/tests/25_moderation.test.sql`.

**Interfaces:**
- **Consumes:** `is_admin`, `admin_log` and `ban_user` (Task 1); the existing `reports`, `report_snapshots` and `reports_check_message` (chat); `notify_user` and `notif_text`.
- **Produces:**
  - **The `reports` table:**
    - `target_type` gains `collectif` and `session`; `reason` gains `harassment`.
    - New columns `source text not null default 'user' check (source in ('user','auto'))` and `target_owner uuid`, which is filled by a trigger with the author, organiser, creator or user responsible for the target.
    - A BEFORE INSERT trigger for API roles pins `reporter_id := auth.uid()`, `source := 'user'` and `status := 'open'`. It refuses (42501 `not_allowed`) targets the reporter can't see, extending `reports_check_message` to every type:
      - **activity:** `get_activity` returns non-null for the caller;
      - **session:** the session's activity is visible;
      - **user:** the reporter shares an activity with them, or they organise a visible activity, and they are not blocked;
      - **association:** not removed;
      - **collectif:** `get_collectif` is not null.
  - **Limits:**
    - A `public.limit_log(user_id, kind, at)` table with no grants, plus `public.take_limit(p_kind text, p_max int, p_window interval)`, an internal helper that locks, counts, raises `limit_reached` and logs.
    - It applies to reports (5 per hour), feedback (3 per hour, signed-in), category requests (5 per day) and `activity_members` inserts (20 per day). The other existing limits stay as they are.
  - **Admin queue:**
    - `public.admin_reports(p_status text default 'open', p_before timestamptz default null, p_limit int default 30) returns jsonb`. Each item is `{id, created_at, source, target_type, target_id, reason, details, reporter_first_name|null, target_owner:{id, first_name}, preview}`.
    - `preview` is the activity title and place, the session date, the message `report_snapshots.snapshot.body`, the association name, the collectif name, or the user's first name.
    - It also returns `open_count`.
  - **`public.admin_decide_report(p_report uuid, p_decision text, p_statement text) returns void`:**
    - Validates the decision and a statement of 10–1000 characters.
    - Refuses if the report isn't open (42501 `already_decided`).
    - Applies the effect from Global Constraints, tolerating a target that's already gone.
    - Closes every other open report on the same target with the same decision.
    - Sets `status`, `decision`, `statement_of_reasons`, `decided_by` and `decided_at`.
    - Writes the audit row.
    - Notifies the reporter (kind `report_handled`, unless it was an automatic report) and the `target_owner` (kind `moderation_notice`, not for `dismiss`). Both use the generic text "Information de modération" / "Ouvrez l'application pour voir le détail.", with `data {kind, report_id}`.
  - **`public.my_moderation_notices() returns jsonb`** (authenticated): the decisions that affect the caller as `target_owner` (`{report_id, decision, statement_of_reasons, decided_at, target_type}`), plus their own reports that have been handled (`{report_id, status, decided_at}`). No other person's identity is included.
  - **`notif_text`** gets `report_handled` and `moderation_notice`. Use `create or replace`, keep every existing row, and diff against the latest version from migration 28.
  - **The first filter:**
    - A `public.banned_words(word text primary key, added_by, created_at)` table that only admins can manage, through `admin_set_banned_word(p_word text, p_add boolean)`, which is audited.
    - `public.text_has_banned_word(p_text text) returns boolean`: unaccent, lower case, whole-word match.
    - BEFORE INSERT/UPDATE triggers on `messages.body`, `activities.title/description`, `collectifs.name/description` and community `associations.name/purpose` (API roles) raise 23514 `content_refused` on a match.
    - Spam: an AFTER INSERT on `messages` and `activities` inserts an automatic report (`source 'auto'`, reason `fake_or_spam`) when the text has more than 3 `http` links, or when the same sender posted the same body 3 times in 10 minutes.
- [ ] **Step 1: Failing tests** (`25_moderation`):
  - **Reporting:**
    - A member reports a visible activity, message, session, user, association or collectif: accepted, with `reporter_id` pinned.
    - Reporting an invisible activity, a message from another activity, a blocked person or a random id: all refused with the same `not_allowed`.
    - The 6th report within an hour raises `limit_reached`, even after the earlier ones were deleted by an admin.
    - The 21st join in a day raises `limit_reached`, as does the 6th category request in a day.
  - **The admin queue:**
    - `admin_reports` refuses `aal1` and non-admins.
    - For an admin, the preview of a message report is the snapshot body, even after the message was deleted.
  - **Decisions:**
    - `remove` on a message deletes it.
    - `remove` on an activity archives it.
    - `ban` on a message bans its author.
    - `dismiss` with a statement under 10 characters raises 23514.
    - Deciding twice raises `already_decided`.
    - A decision on a target that's already gone succeeds.
    - Two open reports on the same target are both closed.
    - Every decision writes exactly one audit row.
  - **Notifications and notices:**
    - The reporter gets a `report_handled` outbox row and the owner a `moderation_notice` row, with generic text and no names.
    - `my_moderation_notices` shows the owner the statement, and shows the reporter only that their report was handled.
  - **The filter:**
    - A chat message with a banned word, and the same word with accents or capitals, is refused with 23514. A word containing it as a substring is accepted.
    - An activity description with 4 links creates one automatic report.
    - The same message sent 3 times creates one automatic report.
- [ ] **Step 2: Run RED.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run GREEN**, then `npm run db:types`.
- [ ] **Step 5: Commit** with the message `feat(db): reports on every target, moderation decisions with reasons, limits and word filter`.

---

### Task 3: Claims, community clubs, category requests, feedback and collectif link (database + Edge Function)

**Files:** Create:
- `supabase/migrations/20261024000031_claims_requests.sql`;
- `supabase/tests/26_claims_requests.test.sql`;
- `supabase/functions/submit-feedback/{index.ts,handler.ts,handler_test.ts}`.

**Interfaces:**
- **Consumes:** Task 1 (`is_admin`, `admin_log`) and Task 2 (`take_limit`).
- **Produces:**
  - **Association claims:**
    - `association_claims` gains `role_in_association text not null` (2–80 characters), `contact_email text`, `document_path text`, `admin_note text` and `decided_at`. A check requires `contact_email` or `document_path`.
    - Claims are limited to 3 per day.
    - Storage bucket `claim-documents`: private, 10 MB, PDF/JPEG/PNG. Owners can upload to `<uid>/…`, and only admins can read.
  - **Admin RPCs** (all audited):
    - `admin_claims(p_status)` returns `{id, created_at, association:{id, name, city}, claimant_first_name, role, contact_email, has_document}`.
    - `admin_claim_document_url(p_claim) returns text` returns a signed URL valid for 5 minutes.
    - `admin_decide_claim(p_claim, p_approve boolean, p_note text)`. Approving sets `associations.claimed_by` and `verified = true` and rejects the other pending claims on that association. The claimant is notified (kind `claim_decided`).
  - **Community clubs:**
    - `associations.reviewed_at timestamptz`.
    - `admin_community_clubs()` lists unreviewed community rows.
    - `admin_decide_club(p_id, p_action text check in ('approve','merge','reject'), p_into uuid default null)`. `approve` sets `reviewed_at`. `merge` moves `activities.organised_by_association_id` and pending claims to `p_into`, then deletes the row. `reject` sets `removed_at`.
    - `associations.removed_at timestamptz`. `search_explore`/`explore_rows`, `get_association` and `search_linkable_associations` must exclude removed rows. Redefine them with `create or replace` from their latest versions (migrations 26, 13 and 19), adding only that predicate.
  - **Category requests:**
    - `admin_category_requests()`.
    - `admin_decide_category(p_id, p_action check in ('approve','merge','reject'), p_parent uuid default null, p_name_en text default null, p_into uuid default null, p_note text default null)`. `approve` inserts a category under `p_parent` with FR from the request and EN from `p_name_en`. `merge` records `p_into` in `admin_note`. Every action notifies the requester (kind `category_decided`).
  - **Feedback:**
    - `feedback` gains `source check in ('app','anonymous')`, and `screenshot_path` must be under `<uid>/` in the private bucket `feedback-screenshots` (5 MB, image types only, owner insert, admin read).
    - Anonymous insert is removed from RLS: revoke the anon insert and drop `feedback_insert_anon`.
    - Signed-in insert is limited to 3 per hour.
    - `admin_feedback(p_status)` and `admin_set_feedback_status(p_id, p_status)`.
  - **Edge Function `submit-feedback`:**
    - `POST {type, body, app_version, device_model, turnstile_token}`.
    - It verifies the token with Cloudflare `siteverify` using the `TURNSTILE_SECRET` env var, then inserts with the service role (`source 'anonymous'`, `user_id` null).
    - It limits to 20 anonymous submissions per hour in total, as an abuse cap, by counting recent anonymous rows.
    - Responses: 200 `{ok:true}`, 400 for an invalid body, 403 for a failed Turnstile check, 429 for the cap.
    - `handler.ts` exports `createHandler(deps)`, as in `send-push`.
  - **Collectif link:** `link_collectif_to_association(p_collectif uuid, p_association uuid) returns int`. It is allowed when the caller is the collectif's active responsable **and** `associations.claimed_by = auth.uid() and verified`. It moves every activity of the collectif to `organised_by_association_id = p_association` and returns the count.
- [ ] **Step 1: Failing tests:**
  - **pgTAP `26_claims_requests`:**
    - A claim with neither an email nor a document raises 23514.
    - The 4th claim in a day raises `limit_reached`.
    - A claimant can't read another person's claim or document.
    - `admin_decide_claim` approve sets `claimed_by` and `verified`, rejects the other pending claims, notifies and audits.
    - Merging a club moves its activities and deletes the duplicate.
    - A rejected club disappears from `search_explore` and `get_association`.
    - Approving a category creates it under the parent with both names.
    - Anonymous insert into `feedback` is refused.
    - The 4th signed-in feedback in an hour raises `limit_reached`.
    - `link_collectif_to_association` is refused for a non-responsable and for an unverified claim, and moves the activities otherwise.
  - **Deno `handler_test.ts`:**
    - A failed Turnstile check returns 403 and inserts nothing.
    - A valid request inserts once with `source 'anonymous'`.
    - A missing body returns 400.
    - The cap returns 429.
- [ ] **Step 2: Run RED.** Run the database tests, then `npx --yes deno@2 test supabase/functions/submit-feedback`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run GREEN**, then `npm run db:types`.
- [ ] **Step 5: Commit** with the message `feat(db): claims, community clubs, category and feedback queues; anonymous feedback through Turnstile`.

---

### Task 4: Retention jobs and inactive accounts (database)

**Files:** Create `supabase/migrations/20261024000032_retention.sql` and `supabase/tests/27_retention.test.sql`.

**Interfaces:**
- **Consumes:** Tasks 1–3, plus `notify_user`.
- **Produces:**
  - **`public.run_retention() returns jsonb`.** It is internal, scheduled nightly as `retention` at `'20 3 * * *'` (UTC), and returns the count deleted per table. It deletes, by the rules in Global Constraints:
    - reports and their `report_snapshots`;
    - `admin_audit_log`;
    - feedback, together with its storage object (via `storage.objects` delete);
    - raw `session_feedback`;
    - pending claims older than 1 year, with their documents.
  - **`public.run_inactive_accounts() returns jsonb`.** It is scheduled nightly at `'40 3 * * *'`. Profiles have a new column, `inactivity_notice_at timestamptz`.
    - For profiles with `last_seen_at < now() - interval '35 months'` and no notice yet, it calls `notify_user(kind 'inactivity_notice')` and sets `inactivity_notice_at`.
    - For profiles with `inactivity_notice_at < now() - interval '30 days'` and `last_seen_at` still before the notice, it deletes the account (`auth.users` row, which cascades).
    - Any activity (a newer `last_seen_at`) clears the notice through the existing `last_seen_at` update path. Add a trigger to do that.
  - **`notif_text`** gets `inactivity_notice` with the exact copy. Use `create or replace` and keep every row.
  - **`hourly-limits`** at `'5 * * * *'`: deletes `limit_log` rows older than 1 day. Use 1 day, not 1 hour, so 24-hour limits still see their history.
- [ ] **Step 1: Failing tests** (`27_retention`):
  - **Reports:** a report decided 3 years and 1 day ago is deleted together with its snapshot. One decided 3 years minus 1 day ago is kept.
  - **Feedback:** feedback older than 2 years is deleted and its storage object is removed. Feedback from yesterday is kept.
  - **Audit log:** audit rows older than 3 years are deleted.
  - **Session feedback:** raw rows older than 6 months are deleted.
  - **Inactive accounts:**
    - An account seen 35 months and 1 day ago gets one notice, and running the job twice gives one notice.
    - An account noticed 31 days ago that is still inactive is deleted.
    - An account noticed but seen since is not deleted, and its notice is cleared.
    - An account seen yesterday is untouched.
  - **Limits:** `limit_log` older than 1 day is deleted by the hourly job.
  - **Cron:** every job is present in `cron.job` with its schedule.
- [ ] **Step 2: Run RED.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run GREEN.**
- [ ] **Step 5: Commit** with the message `feat(db): retention jobs and inactive-account cleanup`.

---

### Task 5: Report and block everywhere (app)

**Files:**
- Create `app/src/features/safety/{reports.ts,blocks.ts,ReportSheet.tsx,BlockedList.tsx}`, `app/src/app/blocked.tsx` and `app/__tests__/report-block.test.tsx`.
- Modify the activity page (`activites/[id].tsx`), `SessionRow.tsx`, `associations/[id].tsx`, `collectifs/[id].tsx`, the chat `MessageActions.tsx` (reuse `ReportSheet`, keeping its current behaviour) and Profil (a "Personnes bloquées" entry).

**Interfaces:**
- **Consumes:** the Task 2 report rules.
- **Produces:**
  - `reportTarget(type: ReportTargetType, id: string, reason: ReportReason, details?: string): Promise<{ok:true} | {ok:false; error:'not_allowed'|'limit_reached'|'signed_out'|'network'|'unknown'}>`.
  - `listBlocked(): Promise<…[{userId, firstName}]>`. Names come from a new authenticated RPC, `my_blocked() returns jsonb` (`[{user_id, first_name}]`, own blocks only). Add it to migration 30 (unpushed on this branch) with a pgTAP test in `25_moderation`.
  - `unblock(userId)` and `block(userId)`.
  - `<ReportSheet target={{type, id}} visible onClose />`. It shows the reasons that fit the type: `did_not_happen` only for sessions and activities, and `unsafe_place` only for activities, sessions and associations. It has an optional details field of up to 500 characters, a busy state, and the exact copy.
- **Entry points:**
  - **Activity page:** a "Signaler cette activité" link. The organiser line gets a "Signaler cette personne" action that is not shown to the organiser themselves. Attendee avatars get a long press with "Signaler cette personne" and "Bloquer".
  - **Session rows:** "Signaler cette séance".
  - **Association page:** the "Signaler une erreur / Retirer cette fiche" link, replacing the coming-soon text.
  - **Collectif page:** "Signaler ce collectif".
  - **Blocked people:** a "Personnes bloquées" screen with "Débloquer", reachable from Profil.
  - **Signed out:** each entry asks for an account through the existing gate (reason `join`).
- [ ] **Step 1: Failing tests:**
  - Each entry point opens the sheet with the right target.
  - The sheet's reason list matches the target type.
  - Sending calls `reportTarget` with the reason and trimmed details, then shows the thank-you text.
  - `limit_reached` shows the limit text.
  - A signed-out user gets the gate.
  - Blocking from an avatar asks for confirmation. When the person is the organiser it uses the chat warning text that says it removes you.
  - The blocked list shows names and "Débloquer" removes one.
  - The empty list shows "Aucune personne bloquée".
- [ ] **Step 2: Run RED**, then **Step 3: Implement**, then **Step 4: Run GREEN** (plus lint and tsc).
- [ ] **Step 5: Commit** with the message `feat(app): report and block from every activity, session, person, association and collectif`.

---

### Task 6: Safety tips, safety page and Partager mon programme (app)

**Files:**
- Create `app/src/features/safety/{tips.ts,SafetyTip.tsx,shareMyPlans.ts}`, `app/src/app/safety-tips.tsx` and `app/__tests__/safety-tips.test.tsx`.
- Modify `SessionRow.tsx`, the activity page and Profil.

**Interfaces:**
- **Produces:**
  - `TIPS: Record<'where'|'first_session'|'moved_place', string[]>`, as i18n keys.
  - `useTipSeen(id)` returns `{seen, dismiss()}`.
    - Signed in, it reads and writes `safety_tips_seen`.
    - Signed out, it uses AsyncStorage under `tips.seen.v1`, and the stored values are copied to the server after sign-in.
  - `<SafetyTip id onReport? />` shows the tip once and offers "Compris". On `first_session` it adds a "Partager mon programme" button.
  - `shareMyPlans(session, activity): Promise<'shared'|'dismissed'>` opens the system share sheet with the exact message, using the Paris date and time and the session place label (or the activity's).
- **Where tips appear:**
  - `first_session` appears on the activity page above the session the user just confirmed, the first time they ever confirm. "Ever" is true when `myActivities` shows no past confirmed attendance, or use a server flag if one is cheaper.
  - `moved_place` appears on a session row whose place differs from the activity's, with a "Signaler cette séance" link.
  - "Partager mon programme" is also a permanent action on every confirmed session row.
- **Profil:** gets a "Conseils de sécurité" entry. That page lists every tip, including the home tip, with no dismiss.
- [ ] **Step 1: Failing tests:**
  - The first confirmation shows the `first_session` tip, and "Compris" hides it for good.
  - A second confirmation doesn't show it.
  - The share message has the exact French format with a DST-correct time.
  - A moved session shows `moved_place` with its report link.
  - The safety page lists all tips.
  - Signed-out dismissals persist and sync after sign-in.
- [ ] **Step 2: Run RED**, then **Step 3: Implement**, then **Step 4: Run GREEN**.
- [ ] **Step 5: Commit** with the message `feat(app): contextual safety tips, safety page and share my plans`.

---

### Task 7: Public-place check, feedback form and claim form (app)

**Files:**
- Create `app/src/features/safety/publicPlace.ts`, `app/src/features/feedback/{api.ts,FeedbackForm.tsx}`, `app/src/app/feedback.tsx`, `app/src/features/claims/{api.ts,ClaimForm.tsx}`.
- Create the tests `app/__tests__/{public-place,feedback,claim}.test.ts(x)`.
- Modify `CreateActivityFlow` (before publishing), `OrganiserTools` (session place change), Explore's empty-results button, Profil, the association page ("C'est mon association") and the collectif page (the link action).

**Interfaces:**
- **Produces:**
  - **`hasPublicPlaceNearby(lat, lon): Promise<boolean | 'unknown'>`**
    - Sends a POST to `https://overpass-api.de/api/interpreter` with a 60 m `around` query for `amenity`, `shop`, `leisure`, `tourism`, `sport` and `office=association`.
    - Uses a 4 s AbortSignal timeout, and returns `'unknown'` on any error.
    - The coordinates are rounded to 4 decimals. No user identifier is sent.
  - **Before publishing or saving a moved place:**
    - `false` shows the stronger warning with "Je confirme : c'est un lieu public". The organiser must tap it to continue.
    - `true` and `'unknown'` continue straight away.
  - **Feedback API:**
    - `sendFeedback({type, body, screenshotUri?}): Promise<ok | error>`.
    - Signed in, it inserts directly, after uploading the screenshot to `feedback-screenshots/<uid>/<uuid>.jpg` with EXIF stripped through the existing avatar re-encode helper.
    - Signed out, it calls the `submit-feedback` function with a Turnstile token from the existing `Turnstile` component, and the screenshot button is hidden.
    - The app version comes from `expo-constants` and the device model from `expo-device`.
  - **Feedback form:** the three types, a body of 1–5000 characters, and the exact copy. It is reachable from Profil and from Explore's empty results, replacing the coming-soon notice.
  - **Claim form:** `submitClaim({associationId, role, contactEmail?, documentUri?})`. Documents go to `claim-documents/<uid>/<uuid>.<ext>` through `expo-document-picker` (install it with `npx expo install`). Signing in is required, through the gate with reason `join`.
  - **Collectif page:** shows "Rattacher le collectif à cette association" to the responsable, when they have an approved claim on an association. A picker lists their verified claimed associations, and confirming calls `link_collectif_to_association`.
- [ ] **Step 1: Failing tests:**
  - **Public-place check:**
    - `false` shows the warning and blocks publishing until confirmed.
    - `'unknown'` after the 4 s timeout publishes without the warning. Use fake timers.
    - Coordinates are rounded in the request body.
  - **Feedback:**
    - Signed-in send inserts with the app version.
    - Signed-out send calls the function with the token and has no screenshot button.
    - An empty body keeps "Envoyer" disabled.
    - `limit_reached` shows the limit text.
  - **Claims:**
    - The claim form requires an email or a document.
    - It sends the role.
    - Success shows the exact confirmation.
  - **Collectif link:** the action is shown only with a verified claim, and calls the RPC.
- [ ] **Step 2: Run RED**, then **Step 3: Implement**, then **Step 4: Run GREEN**.
- [ ] **Step 5: Commit** with the message `feat(app): public-place check, feedback form, association claims and collectif link`.

---

### Task 8: Moderation notices and filter messages (app)

**Files:**
- Create `app/src/features/safety/notices.ts`, `app/src/app/moderation.tsx` and `app/__tests__/moderation-notices.test.tsx`.
- Modify `notifications/responses.ts`, Profil, and the error mapping in `activities/errors.ts` and the chat API.

**Interfaces:**
- **Consumes:** `my_moderation_notices` (Task 2) and the notification kinds `report_handled`, `moderation_notice`, `claim_decided`, `category_decided` and `inactivity_notice`.
- **Produces:**
  - **Moderation screen:** an "Informations de modération" screen that lists the decisions affecting the user (decision label and statement of reasons) and their handled reports. Profil shows an entry with a count when there are unread items, tracked through AsyncStorage.
  - **Notification taps:**
    - `report_handled` and `moderation_notice` open `/moderation`.
    - `claim_decided` opens the association.
    - `category_decided` opens the interests screen.
    - `inactivity_notice` opens Profil.
  - **Error mapping:** a 23514 with message `content_refused` maps to a new error, `content_refused`, everywhere text is sent: chat, activity creation and editing, collectifs and community clubs. It shows "Ce texte contient un mot interdit."
- [ ] **Step 1: Failing tests:**
  - The notices list renders the statement.
  - Each notification kind navigates to the right place.
  - A chat send refused with `content_refused` shows the message and stays editable, and is not queued for retry. It is a permanent failure in the outbox.
  - Activity publishing shows the same message.
- [ ] **Step 2: Run RED**, then **Step 3: Implement**, then **Step 4: Run GREEN**.
- [ ] **Step 5: Commit** with the message `feat(app): moderation notices, decision outcomes and refused-content messages`.

---

### Task 9: Admin area with two-factor sign-in (app)

**Files:**
- Create `app/src/features/admin/{api.ts,MfaGate.tsx,ReportsQueue.tsx,ClaimsQueue.tsx,ClubsQueue.tsx,CategoriesQueue.tsx,FeedbackQueue.tsx}`, `app/src/app/admin/{_layout.tsx,index.tsx,[queue].tsx}` and `app/__tests__/admin.test.tsx`.
- Modify Profil to add an "Administration" entry, shown only when `profile.role === 'admin'`.

**Interfaces:**
- **Consumes:** every admin RPC from Tasks 1–3, plus `supabase.auth.mfa` (`listFactors`, `enroll({factorType:'totp'})`, `challenge`, `verify`, `getAuthenticatorAssuranceLevel`).
- **Produces:**
  - **`MfaGate`:**
    - With no verified TOTP factor, it shows "Activer la double authentification". This displays the QR code (the `react-native-qrcode-svg` package; install it) and the secret, plus a "Code à 6 chiffres" field that verifies the code.
    - With a factor but `currentLevel !== 'aal2'`, it shows the code field only.
    - With `aal2`, it renders its children.
    - A wrong code shows an error and keeps the screen.
  - **Admin home:** five queues with open counts.
  - **Reports queue:**
    - Items show the preview, the reason, the source ("Automatique" for automatic reports) and the owner's first name.
    - The decision buttons are "Classer sans suite", "Avertir", "Retirer" and "Bannir".
    - Each decision needs the "Motif de la décision (obligatoire)" text, 10–1000 characters.
    - "Bannir" asks for a second confirmation.
  - **Claims queue:** includes a "Voir le justificatif" button that opens the signed URL in the browser.
  - **Clubs queue:** approve, merge (with a search picker over associations) or reject.
  - **Categories queue:** approve (with a parent picker and an English name field), merge or reject.
  - **Feedback queue:** changes the status.
  - **Banned words:** the admin home also gets a small "Mots interdits" list with add and remove.
  - **Every screen:** busy states, live-region errors, and `not_allowed` sending the admin back to `MfaGate`.
- [ ] **Step 1: Failing tests:**
  - A non-admin never sees the Profil entry, and `/admin` redirects them.
  - An admin at `aal1` with a factor sees the code field, and a verified code shows the queues.
  - An admin with no factor sees the enrolment screen with a QR code.
  - A decision without a statement keeps the button disabled.
  - "Bannir" confirms twice.
  - A decision calls `admin_decide_report` with the statement and removes the item.
  - The claim document opens the signed URL.
  - Approving a category sends the parent and the English name.
- [ ] **Step 2: Run RED**, then **Step 3: Implement**, then **Step 4: Run GREEN**.
- [ ] **Step 5: Commit** with the message `feat(app): admin area behind two-factor sign-in with moderation queues`.

---

### Task 10: Privacy texts, README and full check

**Files:**
- Modify `app/src/content/privacy.fr.ts` and `privacy.en.ts`:
  - remove "(dès que cette fonctionnalité sera disponible)" from the retention lines that are now real;
  - add the moderation notices, anonymous feedback through Turnstile, the claim documents, the inactive-account notice and the Overpass check (coordinates only).
- Modify `README.md` to add a "Safety and moderation" section:
  - making the first admin (an SQL update of `profiles.role`, then enrolling 2FA in the app);
  - the `TURNSTILE_SECRET` secret for `submit-feedback` and deploying it;
  - the storage buckets;
  - the retention schedule;
  - managing banned words.
- Create `supabase/tests/28_privacy_checks.test.sql`, the §13 checks not yet covered:
  - no API path lists users: anon and authenticated can't select `profiles` beyond their own row, `public_profiles` exposes only `id, first_name, photo_url, bio` (or whatever it exposes; assert the exact column list);
  - `is_admin()` is false without 2FA;
  - the data export contains every personal table, checked by comparing it with the list of tables that have a user-id column;
  - stored home areas are commune centres.
- [ ] **Step 1: Failing tests:** the privacy marker test, now updated for the removed markers, and `28_privacy_checks`.
- [ ] **Step 2: Implement**, then **Step 3: Run all suites:**
  - `npm run db:reset && npm run db:test`
  - `npx --yes deno@2 test supabase/functions` (delete `deno.lock` afterwards)
  - `cd importer && uv run pytest`
  - `cd app && npm test && npm run lint && npx tsc --noEmit`
- [ ] **Step 4: Commit** with the message `docs: safety and moderation setup; privacy texts; privacy checks`.

---

## Out of scope (owned elsewhere)

- The trusted-organiser badge computation, morning-after feedback and ambiance words: Release 2 item 10. The upheld-report rule that feeds the badge uses `reports.status = 'actioned'` and `target_owner` from this plan.
- The private-message safety tip: Release 2 item 13.
- The email for inactive accounts, and the admin dashboard: later and Release 2 item 14.
- Cloudflare WAF and DNS, GitHub security features, and CI security checks: sub-project 9.
