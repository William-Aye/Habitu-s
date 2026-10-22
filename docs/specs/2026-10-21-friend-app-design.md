# Friend App — Product & Technical Design

- **Date:** 2026-10-21
- **Status:** Approved design, awaiting spec review
- **Working name:** Friend App (final name to be chosen before Play Store listing)

## 1. Purpose

Help adults in France make new friends by doing the same activity, with the same people, again and again. The core unit is a **recurring activity** (weekly or every N days), not a one-off event: friendships come from repeated contact.

Anyone can create an activity. No association or registration is needed.

The biggest risk for an app like this is looking empty on day one. The answer is a **nationwide directory of clubs and associations**, imported from open data, so that every user in every town finds real, contactable options immediately — even before any user has created an activity.

### Success criteria

- A first-time user reaches useful results within one screen of opening the app, without creating an account.
- A user with a niche interest (e.g. "jeu de go", "Arduino", "danse bretonne") finds the relevant activities and associations near them as top results.
- Users commit to concrete sessions ("Je serai là") and come back to the same activities.
- The app runs on a budget of roughly €25/month at launch, partly offset by unobtrusive ads, built and maintained by one person with Claude.

### Constraints

- **Country:** France, nationwide from day one.
- **Platform order:** Android (Google Play) first; then website; then iOS — from one codebase.
- **Team:** solo founder building with Claude. Simple stack, minimal operations, low hosting cost.
- **Audience:** 18+ only at launch.
- **Language:** French by default (see section 7); English available.
- **No emoji anywhere in the app UI.**

## 2. Vocabulary

| Term (FR UI / EN) | Meaning |
|---|---|
| **Activité / Activity** | A recurring meetup created by a user, e.g. "Échecs le jeudi au Café du Parc". Internal table: `activities`. |
| **Séance / Session** | One concrete occurrence of an activity on a given date. |
| **Organisateur / Organiser** | The user who created the activity. Keeps the highest rights. |
| **Co-organisateur / Co-organiser** | A member the organiser chose (and who accepted) to help run the activity, e.g. while the organiser is away. Fewer rights than the organiser (section 8). |
| **Club ou association / Club or association** | An organisation listed in the directory (imported from open data, or added by the community). Optional "organised by" label on an activity. |
| **Habitués / Regulars** | Two users who attended at least 3 sessions of the same activity together. |
| **Organisateur de confiance / Trusted organiser** | Pass/fail safety badge earned by organisers (section 9). Not a rating. |
| **Ambiance** | Descriptive words chosen by participants after a session, shown on the activity page (section 9). |

## 3. Architecture

```
Android app (Expo)            ─┐
Website (Expo web, later)     ─┼──►  Supabase
Admin screens (same app,      ─┘      ├─ Postgres + PostGIS + pgvector (all data)
  admin role only)                    ├─ Auth (Google, email magic link, phone OTP)
                                      ├─ Realtime (activity chat)
                                      ├─ Storage (photos, logos)
                                      └─ Edge Functions (notifications, share previews)

GitHub Actions (monthly cron) ──► import pipeline ──► Postgres (associations)
Google AdMob ◄── native ads in Explore list only
Cloudflare Turnstile ◄── invisible bot check on sign-up and anonymous feedback
Cloudflare Pages ◄── hosts the website (later), with Cloudflare's DDoS/bot protection
```

- **App:** React Native with Expo (TypeScript), using a custom development build (required for AdMob and push notifications; Expo Go is not used). One codebase for Android now, web and iOS later.
- **Backend:** Supabase. No custom server. Access rules are enforced in the database with Row Level Security (RLS).
- **Import pipeline:** a script (Python) run monthly by GitHub Actions, which loads data into Supabase.
- **Push notifications:** Expo Push, triggered from Supabase Edge Functions and scheduled jobs (pg_cron).
- **Ads:** Google AdMob native ads via `react-native-google-mobile-ads`, with Google's UMP consent form (see section 10).
- **Translations:** all UI text in translation files (i18next), French as source, English kept in sync. No hard-coded strings.
- **Icons:** Lucide (open source line icons). No emoji.

### Cost

| Item | Cost |
|---|---|
| Google Play developer account | $25 one-time |
| Supabase Pro (8 GB DB, needed for ~1–1.5M associations + embeddings) | ~€25/month from launch |
| GitHub Actions, Expo, embedding model, BAN geocoder, open data, AdMob, Cloudflare Turnstile and Pages | Free |
| Optional: Claude Haiku batch for unclassified associations | A few euros per run, optional |

Expected offset from ads: see section 10.

## 4. Data model

| Table | Purpose / key fields |
|---|---|
| `profiles` | first name, optional photo, optional bio, approximate home area (never exact address), UI language (`fr`/`en`), age confirmed (18+), phone verified flag, role (user/admin), supporter flag (reserved for later ad-free option), `last_seen_at` (updated at most once per hour by the app; drives the dashboard's active-user counts) |
| `categories` | tree (parent_id), name FR/EN, Lucide icon name. Admin-managed |
| `tags` / `association_tags` / `activity_tags` | free-form tags; associations and activities can carry many. Categories are a browsable layer over tags |
| `user_interests` | user + category + level: `like`, `love`, `curious` |
| `category_requests` | user, requested name, status (pending/approved/merged/rejected), admin note |
| `activities` | title, description, category, tags, meeting place (point + label), recurrence rule (weekly / every N days / specific weekdays), time, max size, optional minimum participants, newcomer-friendly flag, approval mode (open by default / approve members), organiser, optional `organised_by_association_id`, published_at (drives the "Nouvelle" label), embedding |
| `activity_members` | activity + user + status (member / pending / removed) |
| `activity_interests` | user + activity ("Ça m'intéresse": lighter than joining, no commitment) |
| `activity_co_organisers` | activity + user + status (`invited`, `active`, `declined`, `removed`) + optional `ends_at` (rights end automatically at that time) + invited_at/accepted_at |
| `sessions` | concrete occurrences generated from the activity's recurrence rule; can be individually cancelled or moved; status (`scheduled`, `held`, `cancelled_by_organiser`, `cancelled_min_not_reached`) |
| `session_feedback` | session + participant + `went_well` (yes/no) + up to 3 ambiance words. Never shown individually; anonymous to the organiser |
| `ambiance_words` | fixed admin-managed list, FR/EN (e.g. Accueillant, Détendu, Bavard, Sportif, Concentré, Débutants bienvenus, Bon niveau requis, Petit groupe, Grand groupe, Jeunes adultes, Tous âges) |
| `organiser_stats` | per user, recomputed nightly: sessions held, distinct participants, positive feedback rate and count, organiser late-cancellation rate, trusted badge status (`none`, `active`, `suspended`, `revoked`) |
| `feedback` | "Une idée ? Un problème ?" submissions: user (optional), type (`idea`, `problem`, `other`), text, optional screenshot, app version, device model, status (`new`, `planned`, `done`, `wont_do`) |
| `notification_log` | per user, instant new-activity alerts sent (enforces the weekly cap) |
| `attendances` | session + user + status: `confirmed`, `cancelled`, `cancelled_late`, `no_show` |
| `messages` | activity chat messages; private messages between regulars |
| `associations` | name, purpose text, RNA id, OSM id, address, location point, website, phone, opening hours, tags, embedding, confidence score, `likely_not_public` flag, `source` (`rna`, `osm`, `rna+osm`, `community`), claimed_by, verified, user-edited fields lock, source attribution |
| `association_claims` | association, claimant, proof method, status |
| `saved_searches` | user, query text, filters, location, radius, alert on/off |
| `search_misses` | anonymised queries returning no strong nearby results (for admin) |
| `reports` | reporter, target (user/activity/message/association), reason, status, moderator decision + statement of reasons |
| `blocks` | blocker, blocked |
| `safety_tips_seen` | user + tip id (so each contextual tip shows once) |

"Regulars": two users who both attended (confirmed and not marked no-show) at least **3** sessions of the same activity. Being regulars unlocks private messages between them.

## 5. Club and association directory (nationwide)

### Sources

1. **RNA** (Répertoire National des Associations, data.gouv.fr, monthly): name, purpose text, purpose codes, address, website, status (active/dissolved).
2. **OpenStreetMap France extract** (Geofabrik): clubs, sports centres, community centres with exact position, often phone, website, opening hours.
3. **Base Adresse Nationale** geocoder: turns RNA addresses into coordinates.
4. **Community:** clubs named by users while creating an activity (see section 8, "Who organises it?").

### Pipeline (monthly, GitHub Actions)

1. **Download** latest RNA and OSM extracts.
2. **Keep every association except those officially dissolved.** No thematic filtering: niche associations are the point. Types unlikely to be open to the public (co-ownership associations, company staff clubs, etc.) get the `likely_not_public` flag and rank lower — they are not deleted.
3. **Geocode** RNA addresses via BAN.
4. **Match RNA ↔ OSM:** similar name and within ~300 m → merge into one listing (OSM contact details + RNA official id).
5. **Match community-added clubs** to RNA/OSM entries by RNA number if given, otherwise by similar name nearby → merge into one listing, keeping links to existing activities.
6. **Tag:** map RNA purpose codes to tags, then keyword rules on purpose text. Optionally, a Claude Haiku batch tags what remains unclassified. Associations get multiple tags.
7. **Embed:** compute a semantic embedding of name + purpose with a free open-source multilingual model, run inside the job. Stored with pgvector.
8. **Confidence score** from: recent official publication, has website, found in OSM, claimed/verified. Low-confidence listings are labelled "non vérifié" or hidden.
9. **Upsert** into Supabase. Never overwrite fields an association edited after claiming.
10. **Report** counts and errors to the admin "Import health" screen. On failure, the previous data stays live.

### Claiming a listing

"C'est mon association" button. Proof: email to an address on the association's own website domain, or an admin checks a document. A claimed association can edit its description and contacts, add a logo, and create activities shown as "organised by" it (with an "Association" badge).

### Legal / GDPR

- Only organisation contacts are displayed, never named individuals (the open RNA contains no directors' names).
- No scraping of websites for personal emails.
- Every listing has a "Signaler une erreur / Retirer cette fiche" link.
- Source attribution recorded per field (Etalab Open Licence, ODbL for OSM).

## 6. Search and ranking

Applies to both activities and clubs/associations.

### Understanding meaning

- **Semantic search:** the query (or interest) is embedded with the same model and compared to stored embeddings (pgvector). "coder" finds "Club informatique", "Atelier Arduino", "Python Lyon".
- **Full-text search** in French alongside it: stemming, accent-insensitive (unaccent), typo-tolerant (pg_trgm).
- **Interests feed search:** each selected interest runs a semantic search near the user, so matching associations appear before any activity exists.

### Ranking

1. **Distance is a filter, not a ranking factor.** The user picks a radius (5 / 10 / 25 / 50 km); results outside are excluded.
2. **Sort by semantic match score, highest first** (0–100%). An exact keyword match from full-text search adds a small boost.
3. **Distance breaks ties** between near-equal scores.
4. **Weak matches** below a threshold are shown after a "Moins proche de votre recherche" divider.
5. **Few strong matches?** Offer to widen the radius ("3 résultats pertinents à 10 km — 11 à 50 km").
6. **Sort switch:** *Meilleure correspondance* (default) or *Plus proche*.
7. `likely_not_public`, low-confidence and unchecked community-added associations are ranked down.
8. **New activities** (published in the last 14 days) get a small score boost and a "Nouvelle" label, so they are not buried under associations.

Each result card shows a match label (e.g. "Très pertinent") and the distance.

### Supporting features

- **Saved searches with alerts:** notify when a new activity or association matching a saved search appears nearby.
- **Search misses:** the admin sees the most frequent searches with no strong nearby results — candidates for new categories or for prompting someone to create an activity.

## 7. Language

- **French is the default for everyone in France**, regardless of phone settings: all screens, notifications, safety tips, category names and the Play Store listing.
- **If the phone's language is English**, the first screen shows a small one-time choice "Français / English" with French pre-selected.
- **Changeable anytime** in Profil → Paramètres. Stored in `profiles.language` once signed in, locally before.
- **No hard-coded text:** all wording in translation files (French source, English in sync), so other languages/countries can be added later.
- **User content** (activity and association names, descriptions) is shown as written, never machine-translated.

## 8. App screens and flows

UI labels below are given in English for readability; the app shows them in French by default.

### First launch (no account)

1. One screen: **"Where are you?"** (allow GPS, or type a town) and **"What are you into?"** (tap a few interest tiles, or skip). If the phone is in English, the language choice appears here too.
2. If ads are enabled, Google's consent form appears **after** this screen, never before.
3. The user lands in **Explore** immediately.
4. Browsing, searching, viewing activities and contacting associations require **no account**.

### Sign-up (only when needed)

Triggered when the user joins an activity, sends a message, or creates an activity. A short sheet offers:

- **Continue with Google** (one tap), or
- **Email** with a sign-in link (no password).

Then: first name and 18+ confirmation. Photo and bio are optional and suggested later. Interests and language chosen before sign-up are kept. **Phone verification** is required only to create an activity.

Interest picking: tap once = *like*, tap twice = *love*, long-press = *curious*. A search field inside the picker uses semantic search. A "Can't find it? Ask for a category" link creates a category request.

### Navigation: four tabs, each with icon and text label

- **Explorer** — large search bar always at the top ("Rechercher une activité, un club, une association…"); filter chips (Activités / Clubs et associations / Jour / Distance / Débutants bienvenus); interest-based suggestions; list/map toggle.
- **Mes activités** — joined activities, next session of each, "Je serai là" / "Pas cette fois".
- **Messages** — one chat per activity; private messages with regulars.
- **Profil** — interests, activities, regular badges, Safety tips page, "Une idée ? Un problème ?", settings (language, notifications, ads consent).

No icon-only buttons for important actions. One clear primary button per screen.

### Activity page

Description, category, tags, meeting place on a map, recurrence, next session date, confirmed attendees for the next session (count + first names + photos, e.g. "6 confirmés"), interested count ("9 intéressés"), "Organisé par" club/association (if any), **Rejoindre** button, **Ça m'intéresse** button, share button, and a visible **Signaler cette activité** link.

Organiser block: first name, photo, active co-organisers if any ("Co-organisé par Sam"), factual stats ("Organisé par Julie · 8 séances organisées · 14 participants différents") and badge: **Organisateur de confiance**, **Association vérifiée**, or **Nouvel organisateur** (neutral, shown until the trusted conditions are met).

Ambiance line (once at least 3 participants answered): the most chosen words, e.g. "Ambiance : Accueillant · Détendu · Débutants bienvenus". "Nouvelle" label during the first 14 days.

Report reasons for an activity: unsafe place, inappropriate behaviour, fake or spam, did not happen, other.

Shared links carry a preview card (WhatsApp/Instagram). Opening a link without the app shows a web preview with "Télécharger l'app".

### Club / association page

Name, purpose, tags, address on a map, contact (website, phone, email if public), source and confidence label ("Ajouté par la communauté" / "non vérifié" where applicable), activities organised by it in the app, "C'est mon association" claim button, report/correct link.

### "Je serai là" (I'll be there)

- Joining an activity does not commit to every session. Each upcoming session has a **"Je serai là"** button → shows *Confirmé* with an *Annuler* option.
- **Day-before reminder** to members: "Demain 19h, Course au Parc de la Tête d'Or — vous serez là ?" with *Oui* / *Pas cette fois* actions directly in the notification.
- The organiser sees the confirmed list and can mark **no-shows** after the session.
- Cancelling **less than 2 hours before** is allowed, recorded as `cancelled_late`, and notifies the organiser immediately.
- Confirmed attendances not marked no-show count toward the "regulars" threshold.
- **Minimum participants (optional):** if the organiser set a minimum and fewer people have confirmed by the evening before (20:00), the session is automatically cancelled (`cancelled_min_not_reached`) and everyone confirmed or interested is told. This does not count against the organiser.

### After a session

The morning after a held session, each confirmed participant gets one optional question:
*"La séance s'est bien passée ? Vous vous êtes senti(e) en sécurité ?"* **Oui / Non**.

- **Non** → offers to explain or open a report.
- Then optionally: "Décrivez l'ambiance" — tap up to 3 words from the fixed ambiance list.
- Answers are anonymous to the organiser and only used in aggregate (trusted badge, ambiance line).

### Feedback to the team: "Une idée ? Un problème ?"

Reachable from Profil and from empty search results. Short form: type (Idée / Problème / Autre), text, optional screenshot. App version and device model attached automatically. Signing in is not required. Lands in the admin Feedback queue.

### Creating an activity

One button everywhere: **"Créer une activité"** — in Explore, on empty search results, and on the "Start one yourself" prompt. There is no separate "add an association" button.

1. **Who organises it?** (optional)
   - **Just me / friends** — default, nothing else to fill.
   - **A club or association** — search the directory and pick it. If not listed, type its name and optionally a website/contact: this creates a directory listing as a side effect (`source = community`, labelled "Ajouté par la communauté", sent to the admin queue, ranked lower until checked). The creator may claim it with the normal claim proof.
2. **What:** category, title, description (templates offered, e.g. "Soirée jeux de société hebdomadaire").
3. **Where:** meeting place on a map, public place recommended (see safety tips).
4. **When:** start date, time, recurrence (weekly / every N days / specific weekdays).
5. **Settings:** max size, optional minimum participants, newcomer-friendly flag, **open to all (default)** or approval-required.

After publishing: a **"Partagez-la avec vos amis"** screen with the share link, and matching nearby users are alerted (see Notifications).

When a user's interest has no activity nearby, Explore shows nearby associations plus a **"Lancez-la vous-même"** prompt leading to this flow.

### Co-organisers (stand-ins)

For when the organiser is away (holidays, illness) or simply wants help.

- **"Ajouter un co-organisateur"** on the activity page (organiser only). Only current members of the activity with a verified phone number can be chosen.
- **The person must accept** an invitation; nobody gets responsibilities without agreeing.
- **Optional end date** ("jusqu'au 15 novembre"): rights end automatically at that time. Without an end date, rights last until removed.
- **The organiser can remove a co-organiser at any time** (one tap); a co-organiser can step down themselves.
- Co-organisers receive the same notifications as the organiser (new members, late cancellations, join requests).
- Shown on the activity page as "Co-organisé par Sam".

| Action | Organiser | Co-organiser |
|---|---|---|
| Change a future session's time or place, cancel it | yes | yes |
| Accept or refuse join requests | yes | yes |
| Mark no-shows | yes | yes |
| Edit title and description | yes | yes |
| Add or remove co-organisers | yes | no |
| Change main settings (open/approval, max size, minimum participants, recurrence, category, "organised by") | yes | no |
| Archive or delete the activity | yes | no |

**Trust badge:** sessions run by a co-organiser count toward the **main organiser's** statistics and badge (the organiser chose the stand-in), never the co-organiser's. Session feedback stays anonymous to co-organisers exactly as to organisers, and a co-organiser cannot give feedback on sessions of an activity they co-organise.

### Joining an approval-required activity

The organiser sees only neutral facts about the requester: first name, photo, bio, "Membre depuis …". There is no participant score. A user joining an activity for the first time is shown to the group with a positive label: *"Première fois dans cette activité — accueillez-le/la"*.

### Notifications

- Day-before session reminder with "Je serai là" actions (members and interested users).
- **New activity nearby:** when an activity is published, users within their chosen radius whose interests or saved searches match it are alerted: "Nouvelle activité près de chez vous : Jeu de go le mardi, 3 km".
  - Interests marked *love* and saved searches → instant alert.
  - Interests marked *like* or *curious* → included in the weekly digest.
  - At most **2 instant new-activity alerts per user per week**; can be turned off in settings.
- Session cancelled because the minimum was not reached.
- Morning-after "La séance s'est bien passée ?" question.
- New member joined your activity (organiser and active co-organisers).
- Co-organiser invitation (to the invited member); invitation accepted or declined, and end of co-organiser rights (to the organiser).
- Late cancellation (organiser).
- Saved-search alerts.
- Chat messages (mutable per activity).
- Weekly digest "N nouvelles activités correspondent à vos centres d'intérêt" — at most once per week.

Notifications never contain ads.

### Visual style

- No emoji anywhere. Category and UI icons from Lucide, always paired with text.
- Calm design, one accent colour, readable sizes, high contrast, screen-reader labels on all controls.

## 9. Safety

- **18+ only** at launch.
- **Privacy by default:** exact location never shown (distance only); first names only; private messages only between regulars.
- **Report and block** on every profile, activity, message and association. Blocking hides both users from each other everywhere.
- **Partager mon programme (Share my plans):** one tap sends session time and place to a trusted contact via the system share sheet.
- **Phone verification** before creating an activity.
- **No-show reliability** visible only to organisers, never public.

### Trust without rating people

**Participants are never graded.** No stars, scores or public comments are attached to participants. A newcomer looks exactly like anyone else; organisers see only neutral facts. Bad behaviour is handled through reports and moderation.

**No free-text reviews on activities.** The mood of an activity is shown through the fixed, descriptive ambiance words only (no insults possible, nothing to moderate).

**Organisateur de confiance** — a pass/fail badge, not a rating. Recomputed nightly. All conditions required:

- Phone verified, profile photo and first name set.
- At least **3 sessions held**, each with at least 2 participants.
- At least **5 distinct participants** across their activities.
- At least **90% "Oui"** answers to "La séance s'est bien passée ?", with at least **5 answers**.
- **No upheld report** against them in the last 6 months.
- At most **1 in 5** of their own sessions cancelled late (less than 2 hours before) by them.

Losing it: an upheld report **revokes** the badge immediately (it can be re-earned after 6 months). If the positive rate drops below 90%, the badge is **suspended** until it recovers.

**Association vérifiée** — given automatically to activities organised by a claimed and verified association.

**Nouvel organisateur** — neutral label shown until the trusted conditions are met.

### Contextual safety tips

Short plain-text tips shown once at the relevant moment, dismissible, and all collected on a **Conseils de sécurité** page in Profil. Shown in French by default (English versions in the translation files):

| Moment | Tip (EN meaning) |
|---|---|
| Creating an activity, "Where" step | "Do not meet at your home: the group would know where you live. Choose a public place (café, park, sports hall, association premises)." If the chosen point has no public place/business nearby, the warning is repeated more prominently before publishing. |
| Before a user's first session | "For a first meeting, stay in the public place and arrange your own transport." and "Tell someone where you are going" with a link to Share my plans. |
| First private message | "Never send money, ID documents or your home address to someone you have just met." |
| A session is moved to a non-public place | Reminder that activities should meet in public places, with a report link. |

## 10. Ads

Goal: offset hosting costs with the least possible intrusion.

### Placement rules

- **Only in the Explore results list:** first ad after the 6th result, then at most one every 12 results.
- **Native ads** styled like a result card, clearly labelled **"Sponsorisé"**, never imitating an activity.
- **Never:** interstitial/full-screen ads, video ads, ads in chat, sign-up, onboarding, safety tips, activity pages, association pages, notifications, or admin screens.

### Provider and consent

- **Google AdMob** native ads (`react-native-google-mobile-ads`).
- **GDPR/ePrivacy consent** via Google's UMP consent form, shown **after** the first onboarding screen, never before. If declined, only non-personalised ads are shown. Consent can be changed in Profil → Paramètres.
- Play Store listing declares "Contient des annonces".

### Expected revenue (order of magnitude)

Native ads in France earn roughly €1–3 per 1,000 impressions. Covering €25/month needs ~10–25k impressions per month — roughly a few hundred regularly active users.

### Later (not in first release)

- **Local sponsored listings:** relevant local businesses (climbing gym, café hosting game nights, sports shop) pay a small monthly fee to appear as "Sponsorisé" in matching nearby searches. No tracking needed.
- **"Soutenir l'app":** ~€1–2/month subscription that removes ads (`profiles.supporter` reserved for this).

## 11. Moderation and admin

Admin screens live inside the app, visible only to `role = admin`:

- **Reports queue:** view item → dismiss / warn / remove / ban, with a mandatory short statement of reasons (EU Digital Services Act).
- **Category requests:** approve / merge / reject.
- **Community-added clubs:** approve / merge with an existing listing / reject.
- **Association claims:** verify / approve / reject.
- **Search misses:** most frequent unanswered searches.
- **Feedback queue:** ideas and problems from users → new / planned / done / won't do.
- **Trusted badges:** see who holds, lost or is close to the badge; manual revoke.
- **Ambiance words:** manage the fixed list.
- **Import health:** last run, counts, errors.
- **Automatic first filter:** banned-word and spam checks on activity titles, descriptions, community-added clubs and chat before human review.
- **Tableau de bord (dashboard):** see below.

### Tableau de bord (admin dashboard)

An admin-only screen in the app (and on the website once it exists). Totals only — never individual people. Computed from the app's own database by an admin-only function; **no third-party analytics or trackers** (no extra consent banner, no cost).

| Group | Figures (each with a "last 30 days" trend) |
|---|---|
| Users | total accounts; active today / last 7 days / last 30 days (from `profiles.last_seen_at`); new sign-ups per day |
| Activity | activities created; sessions held; "Je serai là" confirmations; average participants per held session; share links opened |
| Health | share of users who come back after their first session (attended ≥ 2 sessions); activities with no participant after 30 days; open reports |
| Where | the figures above per département, sortable, to see where to push associations next |
| Directory | association listings; claimed listings; community-added clubs awaiting review; last import run status |

Figures are refreshed every hour by a scheduled job (pg_cron) into a small summary table, so opening the dashboard is instant and cheap.

### Abuse and spam protection

Protection is applied at each layer where it actually works (the app talks directly to Supabase, which already sits behind Cloudflare's network protection):

- **Cloudflare Turnstile** (free, usually invisible) on sign-up and on the anonymous "Une idée ? Un problème ?" form, using Supabase Auth's built-in CAPTCHA support.
- **Supabase Auth rate limits** on sign-in, emails and SMS, tuned below Supabase defaults.
- **Database write limits per user**, enforced by triggers (error code 42501 with a clear message the app translates):

| Action | Limit |
|---|---|
| Messages | 30 per minute |
| Activities created | 3 per day |
| Reports | 5 per hour |
| "Une idée ? Un problème ?" | 3 per hour per user; anonymous submissions limited through Turnstile |
| Community-added clubs | 5 per day |
| Category requests | 5 per day |
| Join requests | 20 per day |

- **Website (later)** hosted on **Cloudflare Pages** (free), with Cloudflare's DDoS protection, bot filtering and rate rules.
- **Access rules** (row-level security) remain the main protection for data; every rule is covered by automated tests.

## 12. Error handling

- **Offline:** cached "Mes activités" and next sessions remain visible; "Je serai là" and messages are queued and sent on reconnect.
- **Import failure:** previous data stays live; error shown in Import health.
- **Location permission refused:** fall back to typing a town.
- **Session moved/cancelled:** confirmed attendees are notified.
- **Ads fail to load or consent declined:** the list renders normally without ad slots; no empty gaps.

## 13. Testing

- **RLS tests:** automated checks that a user can never read another user's private data, non-members cannot read activity chat, and only admins reach admin data.
- **Search ranking tests:** a fixed set of queries ("coder", "jeu de go", "danse bretonne", "escalade") with expected top results, re-run after any ranking or embedding change.
- **Import tests:** run on a small RNA + OSM sample before every full run; check dissolved associations excluded, RNA↔OSM merge, community-club merge, claimed fields not overwritten.
- **Recurrence tests:** session generation for weekly, every-N-days and specific-weekday rules, including cancellations and moves.
- **Translation check:** automated test that every French key has an English equivalent and no UI text is hard-coded.
- **Ad placement test:** ads appear only at the allowed positions in Explore and nowhere else.
- **Trusted badge tests:** each condition individually blocks the badge; suspension below 90%; revocation on upheld report; no participant score exists anywhere in the API.
- **Feedback privacy test:** an organiser can never read individual session feedback rows; ambiance hidden below 3 answers.
- **Alert cap test:** a user never receives more than 2 instant new-activity alerts per week.
- **Minimum participants test:** session auto-cancelled at 20:00 the evening before when below minimum, not otherwise.
- **Rate limit tests:** each write limit allows the last permitted action and refuses the next one; admins and the service role are not limited.
- **Dashboard tests:** the dashboard function is callable only by admins; figures match a known fixture; no per-person data is returned.
- **Co-organiser tests:** every row of the organiser/co-organiser rights table; an invited (not yet accepted), declined, removed or expired (`ends_at` passed) co-organiser has no rights; only members with a verified phone can be invited; a co-organiser cannot add co-organisers or give feedback on the activity's sessions; sessions they run count toward the organiser's stats.
- **End-to-end journeys** on an Android emulator: browse → sign up → join → "Je serai là"; create an activity with and without "organised by" (including a new community club and the home-address warning); report.

## 14. Build order (sub-projects)

Each gets its own implementation plan. The work is split into **Release 1 (MVP)** — the smallest app that delivers the core promise (find a recurring activity near you, show up safely, come back) — and **Release 2**, built in the first months after launch. Nothing is dropped from the spec; only the order changes. Release 2 items must not delay Release 1.

### Release 1 — MVP

1. **Foundation** (done): Supabase project, schema, RLS, categories seed, Expo app skeleton with the four tabs and French/English translations.
2. **Association directory:** import pipeline, tagging, embeddings, confidence score, GitHub Actions schedule; dormant-listing rule (section 17).
3. **Explore and search:** semantic + full-text search, ranking, filters, list/map, association pages, "Me prévenir quand ce club arrive" (section 17).
4. **Accounts and interests:** browse-first onboarding, language choice, deferred sign-up (Cloudflare Turnstile, tuned Auth rate limits), interests picker, category requests, `last_seen_at`.
5. **Activities and sessions (core):** create activity (incl. "Who organises it?"), recurrence, join, "Je serai là" with add-to-calendar, reminders, share links, séance découverte, "Je viens avec quelqu'un", welcome person (section 17).
6. **Group chat:** one chat per activity (private messages come in Release 2).
7. **Safety essentials:** reports, blocks, contextual safety tips, Share my plans, "Une idée ? Un problème ?", minimal admin screens (reports queue, claims, community clubs, category requests, feedback), database write limits.
8. **Public web pages:** association and activity pages on the web (Expo web on Cloudflare Pages), indexable by search engines, with "Je serai là" from the browser after a light sign-up (section 17). Comes before launch because shared links must work for iPhone friends.
9. **Launch:** closed test (12+ testers for 14 days, Google Play requirement), French store listing, public release — timed with the September "Forums des associations" if the date allows (section 15).

### Release 2 — first months after launch

10. **Trust and feedback:** morning-after feedback, ambiance words, trusted organiser badge.
11. **Engagement:** "Ça m'intéresse", minimum participants, no-shows, new-activity alerts, saved searches with alerts, gentle return reminders, seasonal suggestions (section 17).
12. **Organisers:** co-organisers.
13. **Regulars:** regulars computation and private messages between regulars.
14. **Admin:** Tableau de bord, trusted-badge admin, search misses, import health screen.
15. **Ads:** AdMob native ads in Explore, UMP consent, placement rules.
16. **Later:** iOS app, local sponsored listings, "Soutenir l'app".

## 15. Launch and growth (non-code)

- **Associations are the first customers.** Invite high-confidence associations to claim their listing and post their recurring sessions: each claimed association brings its existing members. Give them a page they are proud to share (and a QR code for their premises and flyers).
- **Forums des associations (September).** Nearly every French town holds one at the "rentrée". Aim the launch at it; give participating associations their QR code; be present in one or two cities.
- **Target first: students, newcomers and expats** — people who just moved (Erasmus, first job, relocation) are the ones most actively looking for new friends. Campus associations and expat groups are priority partners.
- **Search engines:** every association and activity has a public web page; niche searches ("club de go Lyon") land on them — the cheapest acquisition channel.
- Every activity page is shareable, so each organiser brings their own circle.
- One partner association per large city to seed the first activities.
- Recruit closed-test testers early (friends + one or two friendly associations); they become the first users.
- **Positioning:** recurring groups + nationwide association directory + safety. This is what sets the app apart from one-off meetups (On Va Sortir, Meetup) and dinners with strangers (Timeleft); use it in the store listing and first screen.

## 16. Out of scope for the first release

- iOS app (planned in Release 2; public web pages are in Release 1).
- Everything listed under Release 2 in section 14.
- Users under 18.
- Payments, paid events, sponsored listings, ad-free subscription.
- One-off (non-recurring) events.
- Machine translation of user content.
- Ratings or reviews of participants; free-text reviews of activities.
- Identity-document verification for organisers.

## 17. First-meeting, directory and retention improvements

### Making the first meeting easier (Release 1)

- **Séance découverte (trial session):** the organiser can mark any session as open to first-timers with no commitment. Shown as a label on the session and as a filter in Explore ("Séances découverte").
- **"Je viens avec quelqu'un":** when confirming "Je serai là", a member can add one guest (count only, no account needed). The guest counts toward the confirmed number and the maximum size. Only one guest per member per session.
- **Welcome person:** the organiser can name a member (or themselves) as the welcome contact for newcomers: "À votre arrivée, demandez Sam". Shown on the session to members who are coming for the first time.
- **Add to calendar:** after "Je serai là", one tap adds the session to the phone's calendar (time, place, link back to the app).

### Better directory (Release 1)

- **"Me prévenir quand ce club arrive":** on an unclaimed association page with no contact details, a signed-in user can ask to be notified when the association claims its listing or creates an activity. The number of people waiting is shown to the association when it claims ("12 personnes attendent votre club"), which encourages claiming. Admins see listings with the most people waiting, to contact those associations first.
- **Dormant listings:** an association with no website, no OpenStreetMap match, no claim and no RNA publication in the last 10 years is hidden from browsing and suggestions; it still appears when someone searches for it by name or very specific terms (match score above the "strong match" threshold).

### Public web pages (Release 1)

- Every association and activity has a public web page at a stable, readable address (e.g. `/associations/club-de-go-de-lyon-w691000001`, `/activites/go-le-mardi-lyon-<id>`), rendered on the server or pre-rendered so search engines index it, with title, description, place (town level for associations, meeting place for activities), next session and "Ouvrir dans l'app".
- From the web, a visitor can sign up (same light sign-up as the app) and press "Je serai là"; the app is recommended but not required.
- Pages never show participants' names or photos to visitors who are not signed in; only counts ("6 confirmés").
- Pages of hidden (dormant or confidence < 20) listings return "not found" to search engines.

### Retention (Release 2)

- **Gentle return:** a member who has not attended their activity for 3 weeks gets one friendly reminder ("Le groupe se retrouve jeudi, vous venez ?"), at most once per activity per month; can be turned off.
- **Seasonal suggestions:** Explore suggestions favour outdoor categories in spring and summer and indoor ones in autumn and winter, using the category tree.

### Data model additions

| Table / column | Purpose |
|---|---|
| `sessions.is_discovery` boolean | Séance découverte |
| `attendances.guest_count` smallint (0 or 1) | "Je viens avec quelqu'un" |
| `activities.welcome_member_id` | Welcome person (must be the organiser, a co-organiser or a member) |
| `association_waiters` (association + user, created_at) | "Me prévenir quand ce club arrive" |
| `activity_members.last_reminded_at` | Gentle-return frequency cap |
