# Activities and Sessions (Sub-project 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member creates a recurring activity in five short steps — organised by themselves, a collectif or an association — the app generates its sessions, people join and say "Je serai là" (optionally with a guest) and add it to their calendar, they get a reminder the day before, organisers manage sessions and join requests, and every activity and collectif has a shareable page.

**Architecture:** Database first: one migration adds collectifs and the session/attendance extras, a second the session generator (recurrence → concrete `sessions`, rolling 8-week horizon, Europe/Paris time), page RPCs and attendance rules, a third the notification outbox (triggers + day-before job) drained by a Supabase Edge Function that calls the free Expo Push service. Search learns about collectifs and "séances découverte"; new activities get their meaning fingerprint from the existing nightly GitHub job. The app adds an `activities` feature (create flow, activity page, organiser tools), a `collectifs` feature, the "Mes activités" tab and push registration.

**Tech Stack:** Supabase Postgres (PostGIS, pg_cron, pg_net, RLS), pgTAP; Supabase Edge Functions (Deno) + Expo Push API; Firebase Cloud Messaging (free) for Android delivery; Python importer (existing E5 embedder) + GitHub Actions; Expo (expo-router), `expo-notifications`, `expo-calendar`, `expo-sharing`/`Share`, MapLibre (existing), i18next, Lucide, Jest + Testing Library.

**Spec:** `docs/specs/2026-10-21-friend-app-design.md` — §2 (vocabulary incl. Collectif), §4 data model, §8 "Activity page", "Je serai là", "Creating an activity", "Collectifs", "Joining an approval-required activity", "Notifications", §9 safety tip at "Where", §13 (recurrence, collectif tests), §14 Release 1 item 5, §17 "Making the first meeting easier" and data-model additions, §18 (minimisation). Builds on the foundation, directory, explore/search and accounts plans in `docs/plans/`.

## Decisions for the owner to confirm

1. **No SMS phone verification at launch (cost).** The spec asks for a verified phone before creating an activity or a collectif; SMS through a provider costs about €0.05–0.10 each and needs a card. Instead, at launch an organiser needs: a completed profile, an account at least **24 hours old**, and they may create at most **3 activities and 2 collectifs per day** (database limits). The existing `phone_verified` rule in the database is replaced by `public.can_organise()`; turning SMS on later only changes that one function. *Owner to confirm.*
2. **Push notifications through Expo's free push service** with Firebase Cloud Messaging for Android (a free Firebase project; no card). *Owner to confirm.*
3. **Reminder actions "Oui" / "Pas cette fois" open the app briefly** and record the answer (simpler and more reliable than background handling). *Owner to confirm.*
4. **Who sees attendees' first names and photos:** members of the activity (and its organiser) only; everyone else sees counts ("6 confirmés"). *Owner to confirm.*
5. **New activities are found by keywords immediately and by meaning the next morning** (the nightly GitHub job computes their fingerprint; free). *Owner to confirm.*
6. **Share links point to the future website address** (`EXPO_PUBLIC_WEB_BASE_URL` + `/activites/<id>`), whose preview pages arrive in sub-project 8; inside the app the link `friendapp://activites/<id>` already opens the page. *Owner to confirm.*
7. **"Do not meet at your home" warning** is shown as a fixed tip at the "Où ?" step now; detecting that a chosen point is a private address is left to sub-project 7. *Owner to confirm.*

## Global Constraints

- **Out of this plan (Release 2):** co-organisers, "Ça m'intéresse", minimum participants and automatic cancellation, no-show marking, new-activity alerts, morning-after feedback, ambiance, trust badge. Their tables already exist; do not build their UI.
- **Organising rule:** `public.can_organise() returns boolean` = caller's profile has `first_name <> ''`, `age_confirmed`, and `profiles.created_at <= now() - interval '24 hours'`. Used for creating activities and collectifs and for inviting collectif organisers.
- **Daily limits (database, error 42501 with message `limit_reached`):** 3 activities and 2 collectifs per user per rolling 24 h; admins and service role exempt.
- **Recurrence → sessions:** generated for the next **8 weeks** in `activities.timezone` (default `Europe/Paris`), DST-correct (the local wall time stays e.g. 19:00 across the change). Re-generated when the recurrence, start date or time changes: future `scheduled` sessions with no confirmed attendance are replaced; sessions with confirmed attendances are kept and their attendees notified if the time changed. A nightly job extends every non-archived activity's horizon.
- **Attendance:** `attendances.guest_count` 0 or 1; a confirmation is refused (error `session_full`) when `confirmed people + their guests` would exceed `max_size`; cancelling less than 2 hours before start is stored as `cancelled_late` (existing rule).
- **Collectifs:** name 3–80 chars, description ≤ 500, town = commune centre (snapped to 0.01° like home areas); label everywhere "Collectif — sans statut juridique"; never modified by the import; at most one of `organised_by_association_id` / `organised_by_collectif_id` per activity; only active `responsable`/`organiser` members of the collectif may set it on an activity.
- **Notifications in this plan:** day-before reminder (18:00 Paris the day before, to members who haven't cancelled; text "Demain {{heure}}, {{titre}} — vous serez là ?", actions "Oui" / "Pas cette fois"); "Nouveau membre dans {{titre}}" to the organiser; late cancellation to the organiser; session moved or cancelled to confirmed attendees; join request (approval mode) to the organiser; request accepted to the requester; collectif organiser invitation. Never more than one reminder per user per session. Notification texts carry no other person's last name or contact.
- **Privacy:** attendee first names/photos only for members and the organiser; meeting places are public places; no exact home location ever stored; push tokens deleted with the account.
- **Copy (French source, exact):** "Créer une activité"; steps "Qui organise ?", "Quoi ?", "Où ?", "Quand ?", "Réglages"; options "Moi", "Un collectif", "Une association", "Créer un collectif"; recurrence labels "Chaque semaine", "Tous les {{n}} jours", "Certains jours"; "Rejoindre", "Quitter l'activité", "Demande envoyée", "Je serai là", "Confirmé", "Annuler", "Je viens avec quelqu'un", "Ajouter à mon agenda", "Partager", "Séance découverte", "À votre arrivée, demandez {{prenom}}", "Complet", "Lancez-la vous-même", "Partagez-la avec vos amis", "Collectif — sans statut juridique", "Mes activités", "Aucune activité pour l'instant", home tip "Ne vous donnez pas rendez-vous chez vous : le groupe saurait où vous habitez. Choisissez un lieu public (café, parc, salle, local d'association)."
- No hard-coded UI text, no emoji, Lucide icons with text labels, screen-reader labels. Local Supabase ports 553xx. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Daylight-saving weeks:** a 19:00 weekly activity must stay at 19:00 local on the Sunday the clocks change, and "every 3 days" must not drift. → tests in Task 2.
2. **Editing a recurrence with people already confirmed:** their sessions are kept (or moved with a notification), never silently deleted. → test in Task 2.
3. **Last place taken twice at the same moment / guests filling the last place:** never more confirmed people than `max_size`. → test in Task 2.
4. **The organiser leaves, deletes their account, or a collectif is deleted:** activities and pages stay coherent ("Organisé par …" falls back), no orphan rows, no crash. → tests in Tasks 1 and 7.
5. **Push token missing, revoked or invalid; Expo service down:** the outbox keeps the message, retries a bounded number of times, then drops it; invalid tokens are deleted; nothing blocks the app. → tests in Task 3.

---

## File Map

```
supabase/migrations/20261023000010_collectifs.sql        collectifs, members, activity/session/attendance extras, can_organise(), limits
supabase/migrations/20261023000011_sessions_engine.sql   generate_sessions, triggers, horizon cron, attendance rules, page RPCs
supabase/migrations/20261023000012_notifications.sql     push_tokens, notification_outbox, enqueue triggers, reminder cron, drain cron
supabase/migrations/20261023000013_search_collectifs.sql search_explore: collectifs + discovery filter; get_collectif
supabase/functions/send-push/index.ts, handler.ts, handler_test.ts
supabase/tests/11_collectifs.test.sql, 12_sessions.test.sql, 13_notifications.test.sql, 14_search_collectifs.test.sql
importer/importer/activities_embed.py + tests/test_activities_embed.py; importer/importer/cli.py (embed-activities); .github/workflows/vocab.yml (nightly step)
app/src/features/activities/  types.ts, api.ts, recurrence.ts, CreateActivityFlow.tsx, steps/*.tsx, SessionRow.tsx, OrganiserTools.tsx, share.ts, calendar.ts
app/src/features/collectifs/  api.ts, CreateCollectifForm.tsx, OrganisersList.tsx
app/src/features/notifications/  registerPush.ts, categories.ts, responses.ts
app/src/app/activites/[id].tsx (replace placeholder), app/src/app/activites/new.tsx, app/src/app/collectifs/[id].tsx
app/src/app/(tabs)/my-activities.tsx, app/src/app/(tabs)/index.tsx (create button, discovery chip, collectif cards)
app/src/i18n/locales/fr.json, en.json; app/app.json, package.json; README.md ("Activities and notifications")
```

---

### Task 1: Collectifs and activity extras (database)

**Files:** Create `supabase/migrations/20261023000010_collectifs.sql`, `supabase/tests/11_collectifs.test.sql`

**Interfaces:**
- Produces:
  - `public.can_organise() returns boolean` (security definer, `search_path` pinned; authenticated only).
  - `public.collectifs` — `id uuid pk`, `name text not null check (char_length(name) between 3 and 80)`, `description text check (char_length(description) <= 500)`, `town_label text not null`, `town_point geography(Point,4326) not null` (snapped to 0.01° by trigger), `created_by uuid references profiles on delete set null`, `created_at timestamptz default now()`.
  - `public.collectif_members` — `collectif_id` (cascade), `user_id` (cascade), `role text check (role in ('responsable','organiser'))`, `status text check (status in ('invited','active')) default 'invited'`, `invited_at`, `accepted_at`; pk `(collectif_id, user_id)`; at most one active `responsable` per collectif (partial unique index).
  - Insert trigger: the creator becomes the active `responsable`.
  - `activities.organised_by_collectif_id uuid references collectifs on delete set null`; check `num_nonnulls(organised_by_association_id, organised_by_collectif_id) <= 1`; guard trigger: API non-admin may set it only if they are an active member of that collectif.
  - `activities.welcome_member_id uuid references profiles on delete set null` — must be the organiser or an active member (guard trigger).
  - `sessions.is_discovery boolean not null default false`; `attendances.guest_count smallint not null default 0 check (guest_count in (0,1))`.
  - Replace the activities insert policy's phone rule by `public.can_organise()`; same for collectifs insert.
  - Daily limits (trigger): `limit_reached` when a non-admin creates a 4th activity or 3rd collectif within 24 h.
  - Responsable account deletion (trigger on `collectif_members` delete of the active responsable via cascade): promote the longest-active organiser; if none, delete the collectif.
  - RLS: collectifs readable by anon; insert by `can_organise()`; update by active responsable/organisers (name, description, town); delete by responsable or admin. collectif_members: readable by anon only for `status='active'` rows (first names come via the page RPC); invite (insert `organiser`/`invited`) by the responsable only; accept (status → active) by the invitee only and only if `can_organise()` is true for them; remove by the responsable or by the member themself.
- [ ] **Step 1: Failing tests** `11_collectifs.test.sql`: `can_organise` false for a 1-hour-old account, true at 25 h; collectif insert sets creator as active responsable and snaps the town; name of 2 chars → 23514; 4th activity in 24 h → `limit_reached`; an activity can't have both an association and a collectif (23514); a non-member can't set `organised_by_collectif_id` (42501), an active organiser can; invited (not yet accepted) organiser can't; welcome member must be organiser or member; deleting the responsable's account promotes the oldest organiser, or deletes the collectif when alone, and its activities keep existing with `organised_by_collectif_id` null; RLS: anon reads collectifs but not invited rows; only the invitee accepts.
- [ ] **Step 2: Run RED** — `npm run db:reset && npm run db:test`.
- [ ] **Step 3: Implement the migration.** Update `supabase/tests/03_activities.test.sql` fixtures that relied on `phone_verified` so they keep passing under `can_organise` (age the fixture accounts as superuser).
- [ ] **Step 4: Run GREEN**, then `npm run db:types`.
- [ ] **Step 5: Commit** — `feat(db): collectifs, organising rule and daily limits`

---

### Task 2: Session generation, attendance rules and page RPCs

**Files:** Create `supabase/migrations/20261023000011_sessions_engine.sql`, `supabase/tests/12_sessions.test.sql`

**Interfaces:**
- Produces:
  - `public.generate_sessions(p_activity uuid, p_until date) returns int` (security definer; service/trigger use only) — inserts missing `scheduled` sessions from `start_date` (or today) to `p_until` per the recurrence, at `start_time` local in `timezone`; returns the count inserted; idempotent (unique `(activity_id, starts_at)`).
  - Trigger after insert/update of `recurrence_kind, recurrence_interval_days, recurrence_weekdays, start_date, start_time, timezone` on activities: delete future `scheduled` sessions with no `confirmed` attendance that no longer match, then `generate_sessions(id, current_date + 56)`. Kept sessions whose time no longer matches the rule are left as they are and listed in the enqueue step (Task 3) as "moved/kept".
  - `pg_cron` job `extend-sessions` daily 02:30 UTC: `generate_sessions` for every non-archived activity to `current_date + 56`.
  - Attendance trigger (before insert/update to `confirmed`, or guest change): lock the session row (`for update`), refuse with `session_full` when `sum(1 + guest_count)` of confirmed would exceed `max_size`.
  - `public.get_activity(p_id uuid) returns jsonb` (anon + authenticated): public fields, category, tags, organiser `{first_name, photo_url}`, `organised_by` `{kind: 'association'|'collectif', id, name}` or null, place label + point, recurrence fields, `welcome_first_name` (only for members), `my_status` ('none'|'pending'|'member') for the caller, `next_sessions` (next 8: `id, starts_at, place_label, is_discovery, status, confirmed_count` (people + guests), `my_attendance` (status, guest_count) for the caller, `attendees` [{first_name, photo_url}] only when the caller is a member or the organiser), `is_full`. Returns null for archived activities to non-organisers.
  - `public.my_activities() returns jsonb` (authenticated): activities the caller organises or is a member of (incl. pending), each with its next session and the caller's attendance.
- [ ] **Step 1: Failing tests** `12_sessions.test.sql`:
  - weekly Tuesday 19:00 from 2026-10-20 generates 8 sessions; the session on 2026-10-27 (after the 2026-10-25 DST change) is 19:00 Europe/Paris (`starts_at at time zone 'Europe/Paris'` = 19:00);
  - every-3-days from a Monday gives Mon, Thu, Sun, Wed … without drift across DST; weekdays {1,4} gives Mon and Thu only;
  - calling the generator twice inserts nothing the second time;
  - changing the time to 20:00 replaces sessions without confirmations, keeps one with a confirmation (still 19:00);
  - `max_size` 3: two confirmations with one guest each → the second is refused `session_full`; concurrent-safety: the trigger takes the session row lock (assert via `pg_locks` in the same transaction or document the `for update`);
  - `guest_count` 2 → 23514;
  - `get_activity` as anon has counts but no `attendees` and no `welcome_first_name`; as a member includes them; as non-member signed-in no attendees; archived → null for non-organiser;
  - `my_activities` lists organised and joined (incl. pending) with the next session.
- [ ] **Step 2: Run RED.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run GREEN**, `npm run db:types`.
- [ ] **Step 5: Commit** — `feat(db): session generation, capacity rule and activity page RPCs`

---

### Task 3: Notifications outbox and push sending

**Files:** Create `supabase/migrations/20261023000012_notifications.sql`, `supabase/tests/13_notifications.test.sql`, `supabase/functions/send-push/{index.ts,handler.ts,handler_test.ts}`

**Interfaces:**
- Produces:
  - `public.push_tokens` — `token text pk`, `user_id` (cascade), `platform text`, `updated_at`; RLS own rows; `public.register_push_token(p_token text, p_platform text)` upsert for the caller.
  - `public.notification_outbox` — `id bigserial`, `user_id` (cascade), `kind text`, `title text`, `body text`, `data jsonb`, `dedupe_key text unique`, `attempts int default 0`, `send_after timestamptz default now()`, `sent_at`, `failed_at`; no API access.
  - Enqueue (security-definer triggers/functions, French or English per `profiles.language`): new member and join request (to organiser), request accepted (to requester), late cancellation (to organiser), session time/place changed or cancelled (to confirmed attendees), collectif invitation (to invitee). `dedupe_key` e.g. `reminder:<session>:<user>`.
  - `pg_cron` `enqueue-reminders` every 15 min: for sessions starting tomorrow, enqueue the day-before reminder with `send_after` = 18:00 Europe/Paris of the day before (or now if later), category `session_reminder`, `data = {session_id, activity_id}`, to members without a `cancelled`/`cancelled_late` attendance.
  - `pg_cron` `drain-outbox` every minute: `net.http_post` to the Edge Function `send-push` (deployed with JWT verification on) with header `Authorization: Bearer <service-role key>` read from the Vault secret `send_push_key`; when the secret is missing the job does nothing (so local runs don't fail).
  - Edge Function `send-push`: `createHandler({ fetchOutbox(limit), markSent(ids), markRetry(id, err), dropToken(token), expoSend(messages) })` — takes up to 100 due rows, looks up tokens, sends to `https://exp.host/--/api/v2/push/send` in batches of 100, marks sent; `DeviceNotRegistered` → delete the token; other errors → attempts+1, `send_after` + 5 min × attempts; after 5 attempts → `failed_at`; rows without any token are marked sent (nothing to deliver).
- [ ] **Step 1: Failing tests**: pgTAP — each enqueue case produces exactly one row with the right recipient and language; reminder not enqueued for a member who cancelled; dedupe prevents a second reminder; outbox unreadable by authenticated/anon; `register_push_token` upserts own row only. Deno — sends due rows, deletes `DeviceNotRegistered` tokens, retries then fails after 5, never throws on Expo 500 (run with `npx --yes deno@2 test supabase/functions/send-push`).
- [ ] **Step 2: Run RED.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run GREEN** (pgTAP + Deno).
- [ ] **Step 5: Commit** — `feat(notifications): outbox, reminder job and Expo push sender`

---

### Task 4: Search for collectifs and discovery sessions; nightly activity fingerprints

**Files:** Create `supabase/migrations/20261023000013_search_collectifs.sql`, `supabase/tests/14_search_collectifs.test.sql`, `importer/importer/activities_embed.py`, `importer/tests/test_activities_embed.py`; modify `importer/importer/cli.py`, `.github/workflows/vocab.yml`, `supabase/tests/07_search.test.sql` if its expectations change

**Interfaces:**
- Produces:
  - `collectifs.embedding vector(384)`, `embedding_hash text`, `search_tsv` (French, generated from name + description).
  - `search_explore(...)` gains `p_discovery_only boolean default false` (activities with a scheduled `is_discovery` session in the next 14 days) and returns collectifs as `kind = 'collectif'` when `'association'` is requested (same ranking rules as community-added listings, label `collectif`). Existing callers keep working (new parameter defaulted).
  - `public.get_collectif(p_id uuid) returns jsonb` — name, description, town (point + label), active organisers `[{first_name, photo_url, role}]`, activities (non-archived) `[{id, title, next_starts_at}]`, `my_role` for the caller.
  - Python `embed_pending_activities(conn, embedder, batch_size=256) -> int` — embeds activities and collectifs whose `embedding_hash` is missing or stale (`text_hash(embedding_text(title/name, description))`), writes vectors; CLI `python -m importer embed-activities`; nightly step added to `vocab.yml`.
- [ ] **Step 1: Failing tests**: pgTAP — a collectif named "Les Joueurs de Go du Parc" is returned for "jeu de go" near it with kind `collectif`; `p_discovery_only` keeps only activities with a discovery session; `get_collectif` lists active organisers only. Python (FakeEmbedder) — new activity embedded once, second run embeds 0, edited description re-embedded.
- [ ] **Step 2: Run RED.** - [ ] **Step 3: Implement.** - [ ] **Step 4: Run GREEN** (pgTAP, `uv run pytest`, the existing ranking set `uv run pytest -m integration` still passes).
- [ ] **Step 5: Commit** — `feat(search): collectifs and discovery sessions; nightly activity embeddings`

---

### Task 5: App data layer for activities and collectifs

**Files:** Create `app/src/features/activities/{types.ts,api.ts,recurrence.ts}`, `app/src/features/collectifs/api.ts`, `app/__tests__/activities-api.test.ts`, `recurrence.test.ts`

**Interfaces:**
- Produces (`types.ts`): `Recurrence = { kind: 'weekly' } | { kind: 'every_n_days'; days: number } | { kind: 'weekdays'; weekdays: number[] }`; `ActivityDraft { organisedBy: { kind: 'me' } | { kind: 'collectif'; id: string } | { kind: 'association'; id: string }; categoryId; title; description; place: { label: string; lon: number; lat: number }; startDate: string; startTime: string; recurrence: Recurrence; maxSize: number | null; newcomerFriendly: boolean; approvalMode: 'open' | 'approval' }`; `ActivityPage`, `SessionInfo`, `MyActivity`, `CollectifPage` mirroring Tasks 2 and 4 JSON in camelCase.
- Produces (`api.ts`), each resolving `{ ok: true, … } | { ok: false, error: 'limit_reached' | 'not_allowed' | 'session_full' | 'network' | 'unknown' }`: `createActivity(d: ActivityDraft)`, `getActivity(id)`, `joinActivity(id)`, `leaveActivity(id)`, `setAttendance(sessionId, status: 'confirmed' | 'cancelled', guestCount: 0 | 1)`, `myActivities()`, `updateSession(sessionId, patch: { startsAt?: string; placeLabel?: string; place?: {lon,lat}; isDiscovery?: boolean; status?: 'cancelled_by_organiser' })`, `decideJoinRequest(activityId, userId, accept: boolean)`, `setWelcomeMember(activityId, userId | null)`.
- Produces (`recurrence.ts`): `describeRecurrence(r: Recurrence, startTime: string, t: TFunction): string` — e.g. "Chaque semaine le mardi à 19:00", "Tous les 3 jours à 19:00", "Le lundi et le jeudi à 19:00"; `formatSessionDate(iso: string, lang: 'fr'|'en'): string` in Europe/Paris ("mardi 27 octobre, 19:00").
- Produces (`collectifs/api.ts`): `createCollectif({ name, description, town })`, `getCollectif(id)`, `myCollectifs()` (where I'm active responsable/organiser), `inviteOrganiser(collectifId, userId)`, `answerInvitation(collectifId, accept)`, `leaveCollectif(id)`, `deleteCollectif(id)`.
- [ ] **Step 1: Failing tests** (mock Supabase): error mapping (`limit_reached` message → `limit_reached`, 42501 → `not_allowed`, `session_full`), draft → insert payload (organised_by fields, point as `SRID=4326;POINT(lon lat)`), `describeRecurrence` table in French and English, `formatSessionDate` across the DST weekend.
- [ ] **Step 2–4: RED, implement, GREEN** (`cd app && npm test && npm run lint && npx tsc --noEmit`).
- [ ] **Step 5: Commit** — `feat(app): activities and collectifs data layer`

---

### Task 6: Create-an-activity flow

**Files:** Create `app/src/app/activites/new.tsx`, `app/src/features/activities/CreateActivityFlow.tsx`, `steps/{WhoStep,WhatStep,WhereStep,WhenStep,SettingsStep}.tsx`, `app/src/features/collectifs/CreateCollectifForm.tsx`, `app/__tests__/create-activity.test.tsx`

**Interfaces:**
- Consumes: Task 5 API; `useRequireAccount()('create')`; `fetchCategories`/`filterCategories`; Explore's `LocationPicker`/`searchTowns` and MapLibre map components; `resolveHomeArea` for collectif towns.
- Behaviour: opening `/activites/new` first passes the account gate (`create`); five steps with "Suivant"/"Retour", a progress label "Étape 2 sur 5"; **Qui organise ?** — "Moi" (default), "Un collectif" (list `myCollectifs()` + "Créer un collectif" inline form), "Une association" (directory search, only associations the user may link per the existing rule; unlisted → existing community-club path); **Quoi ?** — category (picker), title 3–100, description ≤ 2000, 3 templates fill title/description ("Soirée jeux de société hebdomadaire", "Course à pied du dimanche", "Échange de langues au café"); **Où ?** — search a place or move the map pin, label required, home tip always visible; **Quand ?** — start date (today or later), time, recurrence; **Réglages** — max size (empty = no limit, else 2–200), newcomer-friendly, open/approval. "Publier" → `createActivity` → "Partagez-la avec vos amis" screen (share button, "Voir l'activité"). Errors `limit_reached` and `not_allowed` show translated messages explaining the 24-hour rule / daily limit.
- [ ] **Step 1: Failing tests**: signed-out opening asks for an account; "Suivant" disabled until each step is valid (title 2 chars, no place label, past date); templates fill fields; choosing "Un collectif" with none offers "Créer un collectif" and selects the new one; publish sends the expected draft; `limit_reached` shows its message; the home tip text is present on "Où ?".
- [ ] **Step 2–4: RED, implement, GREEN.**
- [ ] **Step 5: Commit** — `feat(app): five-step create-an-activity flow with collectifs`

---

### Task 7: Activity page, sessions and organiser tools

**Files:** Replace `app/src/app/activites/[id].tsx`; create `app/src/features/activities/{SessionRow.tsx,OrganiserTools.tsx,share.ts,calendar.ts}`, `app/__tests__/activity-page.test.tsx`

**Interfaces:**
- Consumes: Task 5 API, `useSession`, `useRequireAccount()('join')`, `TownMap`/map components, `expo-calendar` `createEventInCalendarAsync`, React Native `Share`.
- Produces: `shareActivity(id: string, title: string): Promise<void>` — message "{{titre}} sur Habitués : {{url}}" with `url = EXPO_PUBLIC_WEB_BASE_URL + '/activites/' + id` (falls back to `friendapp://activites/<id>` when the env is empty); `addSessionToCalendar(session, activity): Promise<'added' | 'cancelled' | 'unavailable'>`.
- Page: title, "Organisé par" (me/collectif/association link), organiser first name + photo, description, category, recurrence text, place (map + label), "Rejoindre" / "Demande envoyée" / "Quitter l'activité", "Partager", next sessions list. Each session row: date, "Séance découverte" label, "Complet", "Je serai là" → "Confirmé" + "Annuler" + "Je viens avec quelqu'un" toggle + "Ajouter à mon agenda"; first-time members see "À votre arrivée, demandez {{prenom}}"; attendees (first names + photos) only when `get_activity` returns them; counts otherwise.
- Organiser tools (organiser only): pending requests with Accepter/Refuser; per session: change time/place, mark/unmark "Séance découverte", cancel; choose the welcome person; archive the activity (with confirmation).
- [ ] **Step 1: Failing tests**: anon sees counts and "Rejoindre" (which opens the gate); member sees "Je serai là", confirming shows "Confirmé" and the guest toggle; `session_full` shows "Complet"; cancel within 2 h shows the late-cancel notice; non-member never sees attendee names; organiser sees requests and accepts one; changing a session time calls `updateSession`; share builds the URL from the env and falls back to the app link; calendar result `unavailable` shows a message; archived activity for a visitor shows "Cette activité n'est plus disponible".
- [ ] **Step 2–4: RED, implement, GREEN.**
- [ ] **Step 5: Commit** — `feat(app): activity page with Je serai là, guests, calendar and organiser tools`

---

### Task 8: Collectif page and organisers

**Files:** Create `app/src/app/collectifs/[id].tsx`, `app/src/features/collectifs/OrganisersList.tsx`, `app/__tests__/collectif-page.test.tsx`; modify Profil to list "Mes collectifs" with "Créer un collectif"

**Interfaces:**
- Consumes: `getCollectif`, `inviteOrganiser`, `answerInvitation`, `leaveCollectif`, `deleteCollectif`.
- Page: name, label "Collectif — sans statut juridique" (always visible near the title), description, town map (town-level circle), organisers (first names + photos, role), activities list, "Créer une activité" (pre-selects this collectif) for organisers, edit (name/description/town) for organisers, invite an organiser (from members of the collectif's activities who pass `can_organise`), accept/decline an invitation, leave, delete (responsable, confirmation explaining activities stay and show their organiser).
- [ ] **Step 1: Failing tests**: label always rendered; visitor sees no edit/invite; organiser sees "Créer une activité" which opens the flow with the collectif selected; invitation accept flips the role; responsable delete shows the exact confirmation and returns to Profil; a collectif deleted meanwhile shows "Ce collectif n'existe plus".
- [ ] **Step 2–4: RED, implement, GREEN.**
- [ ] **Step 5: Commit** — `feat(app): collectif page with organisers and invitations`

---

### Task 9: "Mes activités" tab and push notifications in the app

**Files:** Replace `app/src/app/(tabs)/my-activities.tsx`; create `app/src/features/notifications/{registerPush.ts,categories.ts,responses.ts}`, `app/__tests__/my-activities.test.tsx`, `notifications.test.ts`; modify `app/src/app/_layout.tsx`, `app/app.json` (expo-notifications plugin, `android.googleServicesFile: ./google-services.json`), `app/src/features/account/myData.ts` (delete own push tokens before account deletion — server cascade also covers it)

**Interfaces:**
- Produces: `registerForPush(): Promise<'registered' | 'denied' | 'unavailable'>` — asks permission once after the user's first "Je serai là" or activity creation (never at launch), gets the Expo push token (`projectId` from `expo-constants`), calls `register_push_token`; `setupNotificationCategories()` — category `session_reminder` with actions `yes` ("Oui", opens app) and `no` ("Pas cette fois", opens app); `handleNotificationResponse(response)` — `yes` → `setAttendance(session, 'confirmed', 0)`, `no` → `setAttendance(session, 'cancelled', 0)`, default tap → open `/activites/<id>`.
- "Mes activités": sections "J'organise" and "Je participe" (incl. "Demande envoyée"), each card with the next session and its "Je serai là" state; empty state "Aucune activité pour l'instant" with "Créer une activité" and "Explorer".
- [ ] **Step 1: Failing tests**: empty state; lists from `myActivities()`; tapping "Je serai là" on a card updates it; permission asked after the first confirmation only; denied permission is remembered and not asked again for 30 days; `yes`/`no` responses call `setAttendance` correctly; a default tap navigates to the activity.
- [ ] **Step 2–4: RED, implement, GREEN.**
- [ ] **Step 5: Commit** — `feat(app): Mes activités tab and session reminders`

---

### Task 10: Explore wiring, setup guide and full check

**Files:** Modify `app/src/app/(tabs)/index.tsx` and Explore components (a visible "Créer une activité" button; the "Lancez-la vous-même" prompt when an interest has no activity nearby; "Séances découverte" chip → `p_discovery_only`; collectif result cards with the label, opening `/collectifs/<id>`), `app/__tests__/explore-screen.test.tsx`, `README.md` ("Activities and notifications": Firebase project + `google-services.json` (committed: it holds only public identifiers), Expo push credentials (`eas credentials` FCM V1 key), Vault secret `send_push_key`, deploying `send-push`, `EXPO_PUBLIC_WEB_BASE_URL`), `app/.env.example`

- [ ] **Step 1: Failing tests**: Explore shows "Créer une activité"; with interests and zero activities nearby the prompt appears and opens the flow; the chip sends `discoveryOnly: true`; a collectif result shows "Collectif — sans statut juridique" and opens its page.
- [ ] **Step 2–4: RED, implement, GREEN.**
- [ ] **Step 5: Run all suites** — `npm run db:reset && npm run db:test`, `npx --yes deno@2 test supabase/functions`, `cd importer && uv run pytest`, `cd app && npm test && npm run lint && npx tsc --noEmit`.
- [ ] **Step 6: Commit** — `feat(app): create button, discovery filter and collectifs in Explore; setup guide`

---

## Out of scope (owned elsewhere)

- Co-organisers, "Ça m'intéresse", minimum participants, no-shows, new-activity alerts, morning-after feedback, ambiance, trust badge, regulars → Release 2 sub-projects.
- Group chat → sub-project 6. Reports, blocks, private-address detection, admin review of collectifs → sub-project 7.
- Web preview pages for shared links → sub-project 8.
- SMS phone verification → later, by changing `can_organise()` (decision 1).
- Linking a collectif to its official association once registered (admin approval) → sub-project 7.
