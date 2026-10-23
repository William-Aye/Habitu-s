# Accounts and Interests (Sub-project 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A newcomer gets into Explore in one screen with no account; when they do something social they sign up in under a minute (Google or an emailed code, first name, 18+), keeping the interests and town they already chose; their profile, interests and RGPD rights ("Mes données": download, correct, delete) live in the Profil tab; and the session, location and photo handling meet spec §18.

**Architecture:** Database: one migration adds `profiles.last_seen_at`, a trigger that snaps any stored home area to a ~1 km grid, three RPCs (`touch_last_seen`, `export_my_data`, `delete_my_account`) and an `avatars` storage bucket with strict policies. App: a new `features/account` module (secure session storage, auth calls, a `requireAccount()` gate and the sign-up sheet), a `features/interests` module (one store that works signed-out in local storage and signed-in in `user_interests`, merged at sign-in, plus the picker), a first-launch screen in front of the tabs, and the Profil tab. Explore already accepts interest category ids; this plan feeds it.

**Tech Stack:** Supabase Auth (Google ID-token sign-in, email OTP, Turnstile CAPTCHA), Postgres + pgTAP, Supabase Storage; Expo (expo-router), `expo-secure-store`, `aes-js` + `react-native-get-random-values`, `@react-native-google-signin/google-signin`, `react-native-webview` (Turnstile), `expo-image-picker` + `expo-image-manipulator`, `expo-file-system` + `expo-sharing`, i18next, Lucide, Jest + Testing Library.

**Spec:** `docs/specs/2026-10-21-friend-app-design.md` — §7 (language), §8 "First launch", "Sign-up (only when needed)", interest picking, "Profil" tab, §9 (18+), §11 (Turnstile, Auth rate limits), §13 (privacy and security tests), §14 Release 1 item 4, §18.1–18.5 (minimisation, rights, secure storage, EXIF). Builds on `docs/plans/2026-10-21-foundation.md` and `docs/plans/2026-10-22-explore-search.md`.

## Decisions for the owner to confirm

1. **Google sign-in: native Android sign-in** with `@react-native-google-signin/google-signin`, then `supabase.auth.signInWithIdToken({ provider: 'google', token })`. Needs a free Google Cloud project with an OAuth "Web" client id (given to Supabase) and an "Android" client id (package `fr.friendapp.app` + signing SHA-1). No billing account, no card. *Owner to confirm.*
2. **Email: a 6-digit code instead of a link.** The spec says "email with a sign-in link"; a code typed in the app needs no deep-link setup, works if the email is opened on another device, and cannot be caught by another app. The email still reads "Votre code Habitués : 123456", valid 1 hour. *Owner to confirm the change from link to code.*
3. **Turnstile in the app** through an invisible Cloudflare Turnstile widget in a `react-native-webview`, token passed to Supabase's built-in CAPTCHA check on sign-up/sign-in. Free Cloudflare account; the secret key goes only into Supabase settings. *Owner to confirm.*
4. **Phone verification is NOT in this plan.** The spec needs it only to create an activity (sub-project 5), and SMS verification costs money (Supabase sends SMS through a paid provider such as Twilio, roughly €0.05–0.10 per SMS). Sub-project 5's plan will propose a cheap option. *Owner to confirm.*
5. **The picker's search field filters category names** (accent- and case-insensitive, French and English) instead of semantic search; with ~70 categories this finds what people type, and needs no server. *Owner to confirm.*
6. **Profile photo:** re-encoded on the phone (`expo-image-manipulator`, JPEG, max 800 px, quality 0.7), which drops all metadata including GPS; the `avatars` bucket accepts only `image/jpeg` up to 1 MB, one file per user under `<user id>/`. *Owner to confirm.*

## Global Constraints

- **No account needed** to browse, search, see associations, choose a town or pick interests. An account is asked for only through `requireAccount(reason)`.
- **Sign-up collects exactly:** Google or email identity, `first_name` (1–40 characters after trimming), the 18+ confirmation (`age_confirmed = true`, required). Nothing else is required; photo and bio are optional and offered later.
- **Interests:** levels `like` / `love` / `curious`; tap cycles none → like → love → none; long-press sets `curious` (long-press again clears). Stored signed-out under AsyncStorage key `interests.local` (`{ [categoryId]: level }`), signed-in in `public.user_interests`. At sign-in the two are **merged** (stronger level wins: love > like > curious) and the local key is cleared.
- **Location:** home area is the **commune centre** chosen in Explore (`useExploreLocation`); GPS is turned into a commune with `https://geo.api.gouv.fr/communes?lat=…&lon=…&fields=nom,centre,codesPostaux&limit=1` before saving. The database also snaps `profiles.home_area` to a 0.01° grid (~1 km) whatever the client sends.
- **Language:** French is always the default; the first-launch screen shows the "Français / English" choice only when `shouldOfferLanguageChoice(stored, device)` is true (foundation `app/src/i18n`). Language chosen before sign-up is written to `profiles.language` at sign-up.
- **Session storage:** the Supabase session is never written in plain AsyncStorage: AES-256 encrypted blob in AsyncStorage, key in `expo-secure-store` (Android Keystore). Supabase's documented "LargeSecureStore" pattern.
- **Auth settings (documented in README, applied in Supabase dashboard / `config.toml`):** OTP length 6, OTP expiry 3600 s, refresh-token rotation on, email rate limit 4/hour per address, CAPTCHA provider `turnstile`, sign-in responses identical whether or not the email exists.
- **RGPD:** "Mes données" offers download (JSON of every personal row of the user and nothing about others), correction (profile screen) and deletion (immediate, cascades, deletes the avatar file, signs out). Privacy policy shown at sign-up (link) and in Profil.
- **`last_seen_at`:** updated by the app at most once per hour per user (server enforces the hour).
- **UI:** all text from i18n (French source), no emoji, Lucide icons always with a text label, screen-reader labels on controls.
- **Copy (French source, exact):** sign-up title "Créez votre compte en 1 minute"; buttons "Continuer avec Google", "Recevoir un code par e-mail", "Valider"; code screen "Entrez le code reçu à {{email}}"; first-name label "Votre prénom"; age checkbox "J'ai 18 ans ou plus"; first-launch questions "Où êtes-vous ?" and "Qu'est-ce qui vous plaît ?", button "Commencer", link "Passer"; picker link "Vous ne trouvez pas ? Proposer une catégorie"; Profil section "Mes données" with "Télécharger mes données", "Supprimer mon compte"; delete confirmation "Supprimer définitivement votre compte et toutes vos données ?" with "Supprimer" / "Annuler"; "Politique de confidentialité"; "Se déconnecter"; gate reasons `join` "Créez un compte pour rejoindre cette activité", `message` "Créez un compte pour écrire au groupe", `create` "Créez un compte pour créer une activité", `wait` "Créez un compte pour être prévenu", `category` "Créez un compte pour proposer une catégorie".
- Local Supabase ports 553xx (API `http://127.0.0.1:55321`). Jest mocks native modules (`expo-secure-store`, google-signin, webview, image picker/manipulator, sharing, MapLibre).
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Signing in on a phone that already has local interests and a town:** nothing lost, nothing duplicated, stronger level wins. → test in Task 4.
2. **Existing installs and broken secure storage:** a session saved by the old AsyncStorage adapter is moved, not lost; an unreadable key or corrupt blob means "signed out", never a crash at start. → tests in Task 2.
3. **Deleting the account:** every personal row and the avatar file are gone, the phone is signed out, and the same email can sign up again as a new person. → tests in Task 1 and Task 6.
4. **Incomplete sign-up** (no first name, whitespace-only name, 18+ unticked, Google account without a given name, app closed before finishing): the account cannot be used socially until completed, and the next gate opens the sheet directly on the missing step (an unused emailed code simply expires; a new one can be requested). → tests in Task 3.
5. **Wrong, expired or reused code, CAPTCHA failure, network loss:** a clear translated message and a way to retry, never a frozen button. → tests in Task 3.

---

## File Map

```
supabase/migrations/20261022000009_accounts.sql  last_seen_at, home-area snap, RPCs, avatars bucket
supabase/tests/10_accounts.test.sql
supabase/config.toml                              (modify) auth email OTP, captcha, rate limits
app/src/lib/secureSessionStorage.ts               LargeSecureStore + one-time migration
app/src/lib/supabase.ts                           (modify) use secureSessionStorage
app/src/features/account/
  auth.ts                                         signInWithGoogle, sendEmailCode, verifyEmailCode, signOut, completeProfile
  useSession.tsx                                  SessionProvider, useSession()
  AccountGate.tsx                                 AccountGateProvider, useRequireAccount()
  SignUpSheet.tsx                                 Google / email / code / first name + 18+ steps
  Turnstile.tsx                                   invisible Turnstile in a WebView
  myData.ts                                       exportMyData(), deleteMyAccount()
  avatar.ts                                       pickAndUploadAvatar()
  lastSeen.ts                                     touchLastSeen() (hourly)
app/src/features/interests/
  store.ts                                        getInterests, setLevel, mergeLocalIntoAccount, useInterests()
  categories.ts                                   fetchCategories(), filterCategories()
  InterestPicker.tsx                              tiles + filter + "Proposer une catégorie"
  categoryRequest.ts                              requestCategory(name)
app/src/app/onboarding.tsx                        first-launch screen
app/src/app/interests.tsx                         full picker screen (from Profil)
app/src/app/privacy.tsx                           privacy policy
app/src/app/_layout.tsx                           (modify) providers, onboarding redirect, last-seen
app/src/app/(tabs)/profile.tsx                    (modify) Profil tab
app/src/app/(tabs)/index.tsx                      (modify) interests → Explore params
app/src/app/associations/[id].tsx                 (modify) waiter button uses the gate
app/src/content/privacy.fr.md, privacy.en.md      privacy policy text
app/src/i18n/locales/fr.json, en.json             (modify) account.*, interests.*, onboarding.*, profile.*
app/__tests__/secure-session.test.ts, auth.test.ts, signup-sheet.test.tsx, interests-store.test.ts,
              interest-picker.test.tsx, onboarding.test.tsx, profile.test.tsx, my-data.test.ts
app/app.json, app/package.json                    (modify) plugins and dependencies
README.md                                         (modify) "Accounts" setup section
```

---

### Task 1: Database — last seen, home-area snap, data export, account deletion, avatars bucket

**Files:**
- Create: `supabase/migrations/20261022000009_accounts.sql`, `supabase/tests/10_accounts.test.sql`

**Interfaces:**
- Consumes: `public.profiles`, `public.user_interests`, `public.category_requests`, all tables with a user column (read `supabase/migrations/2026102100000[2-5]*.sql` and `2026102200000[78]*.sql` for the full list), `tests.create_user`, `tests.act_as`, `tests.act_as_anon`.
- Produces:
  - `profiles.last_seen_at timestamptz` (null until first touch); not in the API column-update grant.
  - Trigger `profiles_snap_home_area` (before insert/update of `home_area`): `home_area := ST_SetSRID(ST_MakePoint(round(x,2), round(y,2)), 4326)::geography`.
  - `public.touch_last_seen() returns void` — security definer, authenticated only; sets `last_seen_at = now()` only when null or older than 1 hour.
  - `public.export_my_data() returns jsonb` — security definer, authenticated only; keys: `profile`, `interests`, `category_requests`, `activities_organised`, `memberships`, `interests_in_activities`, `attendances`, `messages_sent`, `reports_filed`, `blocks`, `saved_searches`, `association_waiters`, `association_claims`, `feedback_sent`; each an array (profile an object) of the caller's own rows only; never other people's ids except the target ids the user acted on (activity id, association id, blocked user id).
  - `public.delete_my_account() returns void` — security definer, authenticated only; deletes `storage.objects` in bucket `avatars` under `<uid>/`, then `auth.users` row (cascades).
  - Storage bucket `avatars`: public read, `file_size_limit = 1048576`, `allowed_mime_types = '{image/jpeg}'`; insert/update/delete policies only where `(storage.foldername(name))[1] = auth.uid()::text`.

- [ ] **Step 1: Write the failing tests** `supabase/tests/10_accounts.test.sql` (pgTAP, `begin; \ir helpers.inc … rollback;`). Assertions:
  - updating own `home_area` to `POINT(4.83574 45.76402)` stores `POINT(4.84 45.76)`; same for an insert done as superuser;
  - authenticated cannot `update profiles set last_seen_at = now()` (42501); `touch_last_seen()` sets it; a second call within the hour leaves it unchanged (set it to `now() - interval '30 min'` as superuser, call, compare); after `now() - interval '2 hours'` it moves;
  - anon cannot execute `touch_last_seen`, `export_my_data`, `delete_my_account` (42501);
  - `export_my_data()` for Ana contains her interests and her category request, `profile.first_name = 'Ana'`, and contains no row whose user id is Ben's (check by searching the jsonb text for Ben's uuid where Ana never interacted with Ben);
  - `delete_my_account()` as Ana: her `auth.users`, `profiles`, `user_interests` rows are gone; an `avatars` object `'<ana>/a.jpg'` inserted as superuser is gone; Ben's rows untouched; `tests.create_user` with Ana's former email then succeeds and gets a new id;
  - storage policies: Ana can insert `'<ana>/x.jpg'`, cannot insert `'<ben>/x.jpg'` (42501); bucket row has the size limit and mime list.
- [ ] **Step 2: Run to verify they fail** — `npm run db:reset && npm run db:test`; Expected: FAIL `10_accounts`.
- [ ] **Step 3: Write the migration** per Interfaces (pinned `search_path`, execute revoked from public/anon, granted to authenticated).
- [ ] **Step 4: Run** — `npm run db:reset && npm run db:test`; Expected: all files `ok`. Regenerate types: `npm run db:types`.
- [ ] **Step 5: Commit** — `git commit -m "feat(db): last seen, home-area snapping, my-data export, account deletion, avatars bucket"`

---

### Task 2: Encrypted session storage

**Files:**
- Create: `app/src/lib/secureSessionStorage.ts`, `app/__tests__/secure-session.test.ts`
- Modify: `app/src/lib/supabase.ts`, `app/package.json`, `app/jest.setup.js`

**Interfaces:**
- Produces: `export const secureSessionStorage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }`.
  - `setItem`: new random 256-bit key (`react-native-get-random-values`), AES-CTR encrypt with `aes-js`, store the key hex in SecureStore under `sk_${key}` and the ciphertext hex in AsyncStorage under `enc_${key}`.
  - `getItem`: read both, decrypt; if either is missing **and** a plain AsyncStorage value exists under `key` (old adapter), migrate it (encrypt + store, then remove the plain one) and return it; any exception → remove both and return `null`.
  - `removeItem`: removes both.
- `createSupabaseClient` uses `storage: secureSessionStorage`.

- [ ] **Step 1: Install** — `npx expo install expo-secure-store react-native-get-random-values && npm i aes-js && npm i -D @types/aes-js`; add the `expo-secure-store` plugin to `app.json`; add an in-memory SecureStore mock to `jest.setup.js`.
- [ ] **Step 2: Write the failing tests** `secure-session.test.ts`: round-trip returns the same value; AsyncStorage never contains the plain value after `setItem` (scan all keys); a plain value under `sb-…-auth-token` from the old adapter is returned once and then only the encrypted form exists; SecureStore `getItemAsync` throwing → `getItem` resolves `null` and both entries are removed; corrupt ciphertext → `null`; `removeItem` clears both; `createSupabaseClient(...)` passes `secureSessionStorage` (spy on `createClient`).
- [ ] **Step 3: Run to verify they fail** — `cd app && npm test -- secure-session`.
- [ ] **Step 4: Implement** `secureSessionStorage.ts` and switch `supabase.ts`.
- [ ] **Step 5: Run** — `npm test && npm run lint && npx tsc --noEmit`; Expected: all pass.
- [ ] **Step 6: Commit** — `git commit -m "feat(app): encrypted session storage with migration from plain storage"`

---

### Task 3: Auth calls, session state, account gate and sign-up sheet

**Files:**
- Create: `app/src/features/account/auth.ts`, `useSession.tsx`, `AccountGate.tsx`, `SignUpSheet.tsx`, `Turnstile.tsx`; `app/__tests__/auth.test.ts`, `signup-sheet.test.tsx`
- Modify: `supabase/config.toml` (`[auth.email] otp_length = 6`, `otp_expiry = 3600`, `max_frequency`; `[auth.captcha] enabled = true, provider = "turnstile", secret = "env(TURNSTILE_SECRET)"` — disabled locally via env when unset; `[auth.external.google] enabled = true, client_id = "env(GOOGLE_WEB_CLIENT_ID)", secret = "env(GOOGLE_WEB_CLIENT_SECRET)", skip_nonce_check = true`), `app/package.json`, `app.json`, `app/jest.setup.js`, i18n files

**Interfaces:**
- Produces (`auth.ts`), every function resolves to a result, never throws:
  - `type AuthError = 'captcha' | 'network' | 'invalid_code' | 'expired_code' | 'rate_limited' | 'cancelled' | 'unknown'`
  - `signInWithGoogle(): Promise<{ ok: true } | { ok: false; error: AuthError }>` — `GoogleSignin.signIn()` → `idToken` → `supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })`.
  - `sendEmailCode(email: string, captchaToken: string): Promise<{ ok: true } | { ok: false; error: AuthError }>` — `signInWithOtp({ email, options: { shouldCreateUser: true, captchaToken } })`.
  - `verifyEmailCode(email: string, code: string): Promise<{ ok: true } | { ok: false; error: AuthError }>` — `verifyOtp({ email, token: code, type: 'email' })`.
  - `completeProfile(input: { firstName: string; ageConfirmed: true; language: 'fr' | 'en' }): Promise<{ ok: true } | { ok: false; error: 'first_name' | 'age' | AuthError }>` — trims first name, rejects empty or > 40 chars, updates `profiles`.
  - `signOut(): Promise<void>` (also `GoogleSignin.signOut()`, ignores its errors).
  - Error mapping from Supabase messages/status: 429 → `rate_limited`; "captcha" → `captcha`; "expired" → `expired_code`; "invalid"/"token" → `invalid_code`; fetch failure → `network`; Google `SIGN_IN_CANCELLED` → `cancelled`.
- Produces (`useSession.tsx`): `SessionProvider`; `useSession(): { status: 'loading' | 'signed_out' | 'needs_profile' | 'ready'; userId: string | null; profile: { firstName: string; language: 'fr'|'en'; photoUrl: string | null; bio: string | null } | null; refresh(): Promise<void> }` — `needs_profile` when signed in but `first_name` empty or `age_confirmed` false.
- Produces (`AccountGate.tsx`): `AccountGateProvider`; `useRequireAccount(): (reason: 'join' | 'message' | 'create' | 'wait' | 'category') => Promise<boolean>` — resolves `true` at once when `status === 'ready'`; otherwise opens `SignUpSheet` with the reason's sentence and resolves `true` when it ends `ready`, `false` if dismissed.
- Produces (`SignUpSheet.tsx`): steps `choose` → (`email` → `code`) → `profile`; opens directly on `profile` when `status === 'needs_profile'`; Google pre-fills first name from the Google profile when present; link to `/privacy`; on success calls `mergeLocalIntoAccount()` (Task 4) and saves home area from `useExploreLocation` (as commune centre) and language.
- Produces (`Turnstile.tsx`): `<Turnstile siteKey={process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY} onToken={(t: string) => void} onError={() => void} />` — invisible widget in a 0-size WebView; when `EXPO_PUBLIC_TURNSTILE_SITE_KEY` is empty (local dev) it calls `onToken('')` immediately.

- [ ] **Step 1: Install** — `npm i @react-native-google-signin/google-signin && npx expo install react-native-webview`; add the google-signin config plugin to `app.json`; mocks in `jest.setup.js`.
- [ ] **Step 2: Write the failing tests**
  - `auth.test.ts` (mock `supabase.auth` and GoogleSignin): each error mapping above; `completeProfile` rejects `''`, `'   '`, 41 chars, `ageConfirmed` false; trims `'  Ana '` to `'Ana'`; `signOut` swallows a Google error.
  - `signup-sheet.test.tsx`: tapping "Recevoir un code par e-mail" with an invalid email shows the translated error and sends nothing; a valid email sends with the captcha token and shows "Entrez le code reçu à ana@exemple.fr"; `invalid_code` and `expired_code` show their messages and keep the field editable; `captcha` failure shows a retry button; while a request is pending the button is disabled, and re-enabled after any result; with `status = 'needs_profile'` the sheet opens on the first-name step; "Valider" stays disabled until a non-blank first name and the 18+ box are set; Google with no given name lands on the first-name step with an empty field; `useRequireAccount()('wait')` resolves `false` when the sheet is dismissed and `true` after a completed profile.
- [ ] **Step 3: Run to verify they fail** — `npm test -- auth signup-sheet`.
- [ ] **Step 4: Implement** the five files and translations (copy from Global Constraints; error messages under `account.errors.*`).
- [ ] **Step 5: Run** — `npm test && npm run lint && npx tsc --noEmit`; Expected: all pass.
- [ ] **Step 6: Commit** — `git commit -m "feat(app): Google and email-code sign-up behind an account gate"`

---

### Task 4: Interests store and picker

**Files:**
- Create: `app/src/features/interests/store.ts`, `categories.ts`, `InterestPicker.tsx`, `categoryRequest.ts`; `app/src/app/interests.tsx`; `app/__tests__/interests-store.test.ts`, `interest-picker.test.tsx`
- Modify: `app/src/app/(tabs)/index.tsx` (pass `interestCategoryIds` from the store), i18n files

**Interfaces:**
- Consumes: `useSession`, `useRequireAccount` (Task 3); `normaliseQuery` from `app/src/features/explore` for accent/case folding.
- Produces (`store.ts`):
  - `type Level = 'like' | 'love' | 'curious'`; `type Interests = Record<string, Level>` (category id → level)
  - `getInterests(userId: string | null): Promise<Interests>` — signed-out: AsyncStorage `interests.local`; signed-in: `user_interests` rows of the user.
  - `setLevel(userId: string | null, categoryId: string, level: Level | null): Promise<void>` — `null` removes.
  - `mergeLocalIntoAccount(userId: string): Promise<void>` — upsert each local entry where it is stronger (love > like > curious) than the stored one, then remove `interests.local`.
  - `nextTapLevel(current: Level | null): Level | null` — none→like→love→none; curious→like.
  - `useInterests(): { interests: Interests; setLevel(categoryId: string, level: Level | null): void; loading: boolean }` (uses `useSession` for the user id, optimistic update, reverts on error).
- Produces (`categories.ts`): `fetchCategories(): Promise<Category[]>` (`{ id, slug, nameFr, nameEn, icon, parentId }`, ordered by `sort_order`); `filterCategories(all: Category[], text: string, lang: 'fr'|'en'): Category[]` — matches the folded text inside the folded name in either language; a matching child also returns its parent.
- Produces (`categoryRequest.ts`): `requestCategory(name: string): Promise<'sent' | 'signed_out' | 'invalid'>` — 2–80 chars after trimming; inserts into `category_requests`.
- Produces (`InterestPicker.tsx`): `InterestPicker({ compact?: boolean })` — tiles (Lucide icon + name, level shown as text "J'aime" / "J'adore" / "Curieux" and as the tile's accessibility state), tap → `nextTapLevel`, long-press → toggle `curious`, filter field, "Vous ne trouvez pas ? Proposer une catégorie" → `useRequireAccount()('category')`, then a one-field form.

- [ ] **Step 1: Write the failing tests**
  - `interests-store.test.ts`: signed-out `setLevel` writes `interests.local`; `nextTapLevel` table (null→like, like→love, love→null, curious→like); **merge**: local `{a: love, b: like, c: curious}` + account `{a: like, b: love, d: like}` → account becomes `{a: love, b: love, c: curious, d: like}` and `interests.local` is removed; merging twice changes nothing; a failed upsert keeps `interests.local` (nothing lost).
  - `interest-picker.test.tsx`: tap shows "J'aime" then "J'adore" then nothing; long-press shows "Curieux"; typing "echecs" shows "Échecs" and its parent "Jeux"; "Proposer une catégorie" while signed out opens the gate and sends nothing until signed in; a 1-character request shows the invalid message.
- [ ] **Step 2: Run to verify they fail** — `npm test -- interests`.
- [ ] **Step 3: Implement** the files, the `/interests` screen (full picker) and the Explore wiring (`interestCategoryIds = Object.keys(interests)` when the query is empty).
- [ ] **Step 4: Run** — `npm test && npm run lint && npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(app): interests that work signed out and merge at sign-in"`

---

### Task 5: First-launch screen

**Files:**
- Create: `app/src/app/onboarding.tsx`, `app/__tests__/onboarding.test.tsx`
- Modify: `app/src/app/_layout.tsx` (providers: `SessionProvider`, `AccountGateProvider`; redirect), i18n files

**Interfaces:**
- Consumes: `shouldOfferLanguageChoice`, `setLanguage` (foundation i18n); `useExploreLocation` (`requestGps`, `setTown`) and `searchTowns` from Explore; `InterestPicker compact` (Task 4).
- Produces: AsyncStorage key `onboarding.done` (`'1'`); the root layout redirects to `/onboarding` when it is missing and the user is signed out, otherwise renders the tabs. `onboarding.tsx` shows, in order on one scrolling screen: the language choice (only when offered), "Où êtes-vous ?" (GPS button + town search), "Qu'est-ce qui vous plaît ?" (`InterestPicker compact`), then "Commencer" (enabled once a location is set) and "Passer" (always enabled). Both set `onboarding.done` and go to `/`. GPS results are converted to the commune centre (`geo.api.gouv.fr/communes?lat&lon`, Global Constraints) before `setTown`.

- [ ] **Step 1: Write the failing tests** `onboarding.test.tsx`: with no `onboarding.done` and signed out, the app opens on "Où êtes-vous ?"; with it set, opens on Explorer; language choice visible only for an `en-GB` device with nothing stored; "Commencer" disabled until a town is chosen; "Passer" sets the flag and shows Explorer; GPS denied shows the town search, never a dead end; GPS granted stores the commune centre (mock geo.api: `[{nom:'Lyon', centre:{coordinates:[4.8467,45.7485]}, codesPostaux:['69001']}]`) — stored `lon 4.85, lat 45.75` after rounding, label "Lyon (69001)"; a signed-in user never sees onboarding.
- [ ] **Step 2: Run to verify they fail** — `npm test -- onboarding`.
- [ ] **Step 3: Implement** the screen and layout changes.
- [ ] **Step 4: Run** — `npm test && npm run lint && npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(app): one-screen first launch with location and interests"`

---

### Task 6: Profil tab, "Mes données", photo, last seen, privacy policy

**Files:**
- Create: `app/src/features/account/myData.ts`, `avatar.ts`, `lastSeen.ts`; `app/src/app/privacy.tsx`; `app/src/content/privacy.fr.md`, `privacy.en.md`; `app/__tests__/profile.test.tsx`, `my-data.test.ts`
- Modify: `app/src/app/(tabs)/profile.tsx`, `app/src/app/_layout.tsx` (call `touchLastSeen` when signed in and the app comes to the foreground), `app/src/app/associations/[id].tsx` (waiter button uses `useRequireAccount()('wait')`), `app/package.json`, i18n files

**Interfaces:**
- Consumes: Task 1 RPCs and bucket; Tasks 3–4 hooks.
- Produces:
  - `exportMyData(): Promise<{ ok: true; path: string } | { ok: false }>` — calls `export_my_data`, writes `habitues-mes-donnees-YYYY-MM-DD.json` to the cache directory (`expo-file-system`), opens the share sheet (`expo-sharing`).
  - `deleteMyAccount(): Promise<{ ok: boolean }>` — calls `delete_my_account`, then `signOut()`, clears `interests.local`, `explore.location`, `onboarding.done`.
  - `pickAndUploadAvatar(userId: string): Promise<{ ok: true; url: string } | { ok: false; error: 'cancelled' | 'too_large' | 'network' }>` — `expo-image-picker` (library, images only), `manipulateAsync(uri, [{ resize: { width: 800 } }], { compress: 0.7, format: JPEG })`, reject > 1 MB, upload to `avatars/<userId>/avatar.jpg` (upsert), save public URL (+ `?v=<timestamp>`) in `profiles.photo_url`.
  - `touchLastSeen(): Promise<void>` — calls the RPC at most once per hour per app run (remembers the last call time in memory); errors ignored.
  - Profil screen — signed out: "Se connecter" (opens the gate with no reason sentence), language switch, "Politique de confidentialité". Signed in: photo + "Changer la photo", first name and bio (editable, saved on "Enregistrer"), "Mes centres d'intérêt" → `/interests`, language switch (writes `profiles.language` and `setLanguage`), "Mes données" → "Télécharger mes données", "Supprimer mon compte" (confirmation dialog, exact copy), "Politique de confidentialité", "Se déconnecter".
  - `privacy.fr.md` / `privacy.en.md`: plain-language policy built from spec §18 (what is collected, why and legal basis, how long — the §18.2 table —, who processes it — Supabase (EU), Google, Cloudflare, Expo, GitHub —, rights and how to use them in "Mes données", CNIL complaint, contact address placeholder `confidentialite@<domaine>` to be replaced by the owner before launch) with the line "Version à faire relire par une personne qualifiée avant la publication." at the top. `privacy.tsx` renders it as simple paragraphs (no Markdown library: split on blank lines, `#` lines as headings).

- [ ] **Step 1: Install** — `npx expo install expo-image-picker expo-image-manipulator expo-file-system expo-sharing`; mocks.
- [ ] **Step 2: Write the failing tests**
  - `my-data.test.ts`: `exportMyData` writes a file whose JSON equals the RPC result and calls share; RPC error → `{ ok: false }` with no file; `deleteMyAccount` calls the RPC, signs out and clears the three local keys; when the RPC fails nothing is cleared and the user stays signed in.
  - `profile.test.tsx`: signed out shows "Se connecter" and no "Mes données"; signed in shows the first name and "Mes données"; "Supprimer mon compte" shows the exact confirmation and "Annuler" does nothing; "Supprimer" calls `deleteMyAccount` and returns to the signed-out Profil; saving a blank first name shows the error and saves nothing; an oversized photo shows `too_large`; `touchLastSeen` called twice within an hour calls the RPC once; the association page waiter button, signed out, opens the gate with "Créez un compte pour être prévenu".
- [ ] **Step 3: Run to verify they fail** — `npm test -- profile my-data`.
- [ ] **Step 4: Implement** the files and the policy texts (French source; English translation).
- [ ] **Step 5: Run** — `npm test && npm run lint && npx tsc --noEmit`; translation parity test still green.
- [ ] **Step 6: Commit** — `git commit -m "feat(app): Profil tab with Mes données, photo, last seen and privacy policy"`

---

### Task 7: Setup guide and full check

**Files:**
- Modify: `README.md` ("Accounts" section), `app/.env.example` (`EXPO_PUBLIC_TURNSTILE_SITE_KEY=`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=`)

**Interfaces:** none new.

README "Accounts" section (plain steps for the owner):
1. **Google sign-in (free):** create a Google Cloud project; OAuth consent screen (app name "Habitués", support email); create a **Web** client id (→ Supabase Auth → Google: client id + secret, "Skip nonce check" on) and an **Android** client id (package `fr.friendapp.app`, SHA-1 from `npx expo prebuild` / `cd android && ./gradlew signingReport`, and later the Play signing SHA-1); put the Web client id in `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
2. **Turnstile (free):** Cloudflare dashboard → Turnstile → add widget (mode "Invisible", domain `habitues.app` or the chosen domain); site key → `EXPO_PUBLIC_TURNSTILE_SITE_KEY`; secret → Supabase Auth → Attack protection → CAPTCHA (Turnstile).
3. **Supabase Auth settings:** email OTP length 6, expiry 3600 s; email template "Votre code Habitués : {{ .Token }}" (French, no link); rate limits (4 emails/hour per address); refresh-token rotation on; custom SMTP recommended before launch (Supabase's built-in email is limited to a few emails per hour).
4. **Local development:** CAPTCHA and Google are skipped when their env values are empty; Supabase local email codes appear in Inbucket (`http://127.0.0.1:55324`).

- [ ] **Step 1: Write the README section and `.env.example` entries.**
- [ ] **Step 2: Run all suites** — `npm run db:reset && npm run db:test`, `cd importer && uv run pytest`, `cd app && npm test && npm run lint && npx tsc --noEmit`; Expected: all pass.
- [ ] **Step 3: Commit** — `git commit -m "docs: accounts setup (Google, Turnstile, Supabase Auth)"`

---

## Out of scope (owned elsewhere)

- Phone verification for organisers → sub-project 5 (cost decision there).
- Admin two-factor authentication and the admin audit log → sub-project 7.
- Retention jobs (deleting old messages, inactive accounts) → sub-project 7.
- Database write limits on category requests → sub-project 7.
- Signing in on the website → sub-project 8.
- Custom SMTP provider choice → launch step (README note only).
