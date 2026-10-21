# Friend App — Product & Technical Design

- **Date:** 2026-10-21
- **Status:** Approved design, awaiting spec review
- **Working name:** Friend App (final name to be chosen before Play Store listing)

## 1. Purpose

Help adults in France make new friends by doing the same activity, with the same people, again and again. The core unit is a **recurring group** (weekly or every N days), not a one-off event: friendships come from repeated contact.

The biggest risk for an app like this is looking empty on day one. The answer is a **nationwide directory of associations**, imported from open data, so that every user in every town finds real, contactable activities immediately — even before any user has created a group.

### Success criteria

- A first-time user reaches useful results within one screen of opening the app, without creating an account.
- A user with a niche interest (e.g. "jeu de go", "Arduino", "danse bretonne") finds the relevant associations near them as top results.
- Users commit to concrete sessions ("I'll be there") and come back to the same groups.
- The app runs on a budget of roughly €25/month at launch, built and maintained by one person with Claude.

### Constraints

- **Country:** France, nationwide from day one.
- **Platform order:** Android (Google Play) first; then website; then iOS — from one codebase.
- **Team:** solo founder building with Claude. Simple stack, minimal operations, low hosting cost.
- **Audience:** 18+ only at launch.
- **Languages:** French UI, English included from the start.
- **No emoji anywhere in the app UI.**

## 2. Architecture

```
Android app (Expo)            ─┐
Website (Expo web, later)     ─┼──►  Supabase
Admin screens (same app,      ─┘      ├─ Postgres + PostGIS + pgvector (all data)
  admin role only)                    ├─ Auth (Google, email magic link, phone OTP)
                                      ├─ Realtime (group chat)
                                      ├─ Storage (photos, logos)
                                      └─ Edge Functions (notifications, share previews)

GitHub Actions (monthly cron) ──► import pipeline ──► Postgres (associations)
```

- **App:** React Native with Expo (TypeScript). One codebase for Android now, web and iOS later.
- **Backend:** Supabase. No custom server. Access rules are enforced in the database with Row Level Security (RLS).
- **Import pipeline:** a script (Python) run monthly by GitHub Actions, which loads data into Supabase.
- **Push notifications:** Expo Push, triggered from Supabase Edge Functions and scheduled jobs (pg_cron).
- **Icons:** Lucide (open source line icons). No emoji.

### Cost

| Item | Cost |
|---|---|
| Google Play developer account | $25 one-time |
| Supabase Pro (8 GB DB, needed for ~1–1.5M associations + embeddings) | ~€25/month from launch |
| GitHub Actions, Expo, embedding model, BAN geocoder, open data | Free |
| Optional: Claude Haiku batch for unclassified associations | A few euros per run, optional |

## 3. Data model

| Table | Purpose / key fields |
|---|---|
| `profiles` | first name, optional photo, optional bio, approximate home area (never exact address), languages, age confirmed (18+), phone verified flag, role (user/admin) |
| `categories` | tree (parent_id), name FR/EN, Lucide icon name. Admin-managed |
| `tags` / `association_tags` / `group_tags` | free-form tags; associations and groups can carry many. Categories are a browsable layer over tags |
| `user_interests` | user + category + level: `like`, `love`, `curious` |
| `category_requests` | user, requested name, status (pending/approved/merged/rejected), admin note |
| `groups` | title, description, category, tags, meeting place (point + label), recurrence rule (weekly / every N days / specific weekdays), time, max size, newcomer-friendly flag, approval mode (open / approve members), organiser, optional linked association, embedding |
| `group_members` | group + user + status (member / pending / removed) |
| `sessions` | concrete occurrences generated from the group's recurrence rule; can be individually cancelled or moved |
| `attendances` | session + user + status: `confirmed`, `cancelled`, `cancelled_late`, `no_show` |
| `messages` | group chat messages; private messages between users who are "regulars" together |
| `associations` | name, purpose text, RNA id, OSM id, address, location point, website, phone, opening hours, tags, embedding, confidence score, `likely_not_public` flag, claimed_by, verified, user-edited fields lock, source attribution |
| `association_claims` | association, claimant, proof method, status |
| `saved_searches` | user, query text, filters, location, radius, alert on/off |
| `search_misses` | anonymised queries returning no strong nearby results (for admin) |
| `reports` | reporter, target (user/group/message/association), reason, status, moderator decision + statement of reasons |
| `blocks` | blocker, blocked |
| `safety_tips_seen` | user + tip id (so each contextual tip shows once) |

"Regulars": two users who both attended (confirmed and not marked no-show) at least **3** sessions of the same group. Being regulars unlocks private messages between them.

## 4. Association directory (nationwide)

### Sources

1. **RNA** (Répertoire National des Associations, data.gouv.fr, monthly): name, purpose text, purpose codes, address, website, status (active/dissolved).
2. **OpenStreetMap France extract** (Geofabrik): clubs, sports centres, community centres with exact position, often phone, website, opening hours.
3. **Base Adresse Nationale** geocoder: turns RNA addresses into coordinates.

### Pipeline (monthly, GitHub Actions)

1. **Download** latest RNA and OSM extracts.
2. **Keep every association except those officially dissolved.** No thematic filtering: niche associations are the point. Types unlikely to be open to the public (co-ownership associations, company staff clubs, etc.) get the `likely_not_public` flag and rank lower — they are not deleted.
3. **Geocode** RNA addresses via BAN.
4. **Match RNA ↔ OSM:** similar name and within ~300 m → merge into one listing (OSM contact details + RNA official id).
5. **Tag:** map RNA purpose codes to tags, then keyword rules on purpose text. Optionally, a Claude Haiku batch tags what remains unclassified. Associations get multiple tags.
6. **Embed:** compute a semantic embedding of name + purpose with a free open-source multilingual model, run inside the job. Stored with pgvector.
7. **Confidence score** from: recent official publication, has website, found in OSM, claimed/verified. Low-confidence listings are labelled "unverified" or hidden.
8. **Upsert** into Supabase. Never overwrite fields an association edited after claiming.
9. **Report** counts and errors to the admin "Import health" screen. On failure, the previous data stays live.

### Claiming a listing

"This is my association" button. Proof: email to an address on the association's own website domain, or an admin checks a document. A claimed association can edit its description and contacts, add a logo, and **publish its recurring sessions as groups** (shown with an "Association" badge).

### Legal / GDPR

- Only organisation contacts are displayed, never named individuals (the open RNA contains no directors' names).
- No scraping of websites for personal emails.
- Every listing has a "Remove / correct this listing" link.
- Source attribution recorded per field (Etalab Open Licence, ODbL for OSM).

## 5. Search and ranking

Applies to both associations and user-created groups.

### Understanding meaning

- **Semantic search:** the query (or interest) is embedded with the same model and compared to stored embeddings (pgvector). "coder" finds "Club informatique", "Atelier Arduino", "Python Lyon".
- **Full-text search** in French alongside it: stemming, accent-insensitive (unaccent), typo-tolerant (pg_trgm).
- **Interests feed search:** each selected interest runs a semantic search near the user, so matching associations appear before any group exists.

### Ranking

1. **Distance is a filter, not a ranking factor.** The user picks a radius (5 / 10 / 25 / 50 km); results outside are excluded.
2. **Sort by semantic match score, highest first** (0–100%). An exact keyword match from full-text search adds a small boost.
3. **Distance breaks ties** between near-equal scores.
4. **Weak matches** below a threshold are shown after a "Less related" divider.
5. **Few strong matches?** Offer to widen the radius ("3 strong matches within 10 km — 11 within 50 km").
6. **Sort switch:** *Best match* (default) or *Nearest*.
7. `likely_not_public` and low-confidence associations are ranked down.

Each result card shows a match label (e.g. "Strong match") and the distance.

### Supporting features

- **Saved searches with alerts:** notify when a new association or group matching a saved search appears nearby.
- **Search misses:** the admin sees the most frequent searches with no strong nearby results — candidates for new categories or for prompting someone to create a group.

## 6. App screens and flows

### First launch (no account)

1. One screen: **"Where are you?"** (allow GPS, or type a town) and **"What are you into?"** (tap a few interest tiles, or skip).
2. The user lands in **Explore** immediately.
3. Browsing, searching, viewing groups and contacting associations require **no account**.

### Sign-up (only when needed)

Triggered when the user joins a group, sends a message, or creates a group. A short sheet offers:

- **Continue with Google** (one tap), or
- **Email** with a sign-in link (no password).

Then: first name and 18+ confirmation. Photo and bio are optional and suggested later. Interests chosen before sign-up are kept. **Phone verification** is required only to create a group.

Interest picking: tap once = *like*, tap twice = *love*, long-press = *curious*. A search field inside the picker uses semantic search. A "Can't find it? Ask for a category" link creates a category request.

### Navigation: four tabs, each with icon and text label

- **Explore** — large search bar always at the top ("Search an activity, a club, an association…"); filter chips (Groups / Associations / Day / Distance / Newcomer-friendly); interest-based suggestions; list/map toggle.
- **My groups** — joined groups, next session of each, "I'll be there" / "Not this time".
- **Messages** — one chat per group; private messages with regulars.
- **Profile** — interests, groups, regular badges, Safety tips page, settings.

No icon-only buttons for important actions. One clear primary button per screen.

### Group page

Description, category, tags, meeting place on a map, recurrence, next session date, confirmed attendees for the next session (count + first names + photos, e.g. "6 confirmed"), organiser, linked association (if any), **Join** button, share button.

Shared links carry a preview card (WhatsApp/Instagram). Opening a link without the app shows a web preview with "Get the app".

### "I'll be there"

- Joining a group does not commit to every session. Each upcoming session has an **"I'll be there"** button → shows *Confirmed* with a *Cancel* option.
- **Day-before reminder** to group members: "Tomorrow 19:00, Running Tête d'Or — will you be there?" with *Yes* / *Not this time* actions directly in the notification.
- The organiser sees the confirmed list and can mark **no-shows** after the session.
- Cancelling **less than 2 hours before** is allowed, recorded as `cancelled_late`, and notifies the organiser immediately.
- Confirmed attendances not marked no-show count toward the "regulars" threshold.

### Creating a group (4 steps)

1. **What:** category, title, description (templates offered, e.g. "Weekly board-game evening").
2. **Where:** meeting place on a map, public place recommended (see safety tips).
3. **When:** start date, time, recurrence (weekly / every N days / specific weekdays).
4. **Settings:** max size, newcomer-friendly flag, open or approval-required.

When a user's interest has no group nearby, Explore shows nearby associations plus a **"Start one yourself"** prompt leading to this flow.

### Notifications

- Day-before session reminder with "I'll be there" actions.
- New member joined your group (organiser).
- Late cancellation (organiser).
- Saved-search alerts.
- Chat messages (mutable per group).
- Weekly digest "N new groups match your interests" — at most once per week.

### Visual style

- No emoji anywhere. Category and UI icons from Lucide, always paired with text.
- Calm design, one accent colour, readable sizes, high contrast, screen-reader labels on all controls.

## 7. Safety

- **18+ only** at launch.
- **Privacy by default:** exact location never shown (distance only); first names only; private messages only between regulars.
- **Report and block** on every profile, group, message and association. Blocking hides both users from each other everywhere.
- **Share my plans:** one tap sends session time and place to a trusted contact via the system share sheet.
- **Phone verification** before creating a group.
- **No-show reliability** visible only to organisers, never public.

### Contextual safety tips

Short plain-text tips shown once at the relevant moment, dismissible, and all collected on a **Safety tips** page in Profile:

| Moment | Tip |
|---|---|
| Creating a group, "Where" step | "Do not meet at your home: the group would know where you live. Choose a public place (café, park, sports hall, association premises)." If the chosen point has no public place/business nearby, the warning is repeated more prominently before publishing. |
| Before a user's first session | "For a first meeting, stay in the public place and arrange your own transport." and "Tell someone where you are going" with a link to Share my plans. |
| First private message | "Never send money, ID documents or your home address to someone you have just met." |
| A session is moved to a non-public place | Reminder that groups should meet in public places, with a report link. |

## 8. Moderation and admin

Admin screens live inside the app, visible only to `role = admin`:

- **Reports queue:** view item → dismiss / warn / remove / ban, with a mandatory short statement of reasons (EU Digital Services Act).
- **Category requests:** approve / merge / reject.
- **Association claims:** verify / approve / reject.
- **Search misses:** most frequent unanswered searches.
- **Import health:** last run, counts, errors.
- **Automatic first filter:** banned-word and spam checks on group titles, descriptions and chat before human review.

## 9. Error handling

- **Offline:** cached "My groups" and next sessions remain visible; "I'll be there" and messages are queued and sent on reconnect.
- **Import failure:** previous data stays live; error shown in Import health.
- **Location permission refused:** fall back to typing a town.
- **Session moved/cancelled:** confirmed attendees are notified.

## 10. Testing

- **RLS tests:** automated checks that a user can never read another user's private data, non-members cannot read group chat, and only admins reach admin data.
- **Search ranking tests:** a fixed set of queries ("coder", "jeu de go", "danse bretonne", "escalade") with expected top results, re-run after any ranking or embedding change.
- **Import tests:** run on a small RNA + OSM sample before every full run; check dissolved associations excluded, RNA↔OSM merge, claimed fields not overwritten.
- **Recurrence tests:** session generation for weekly, every-N-days and specific-weekday rules, including cancellations and moves.
- **End-to-end journeys** on an Android emulator: browse → sign up → join → "I'll be there"; create a group (with home-address warning); report.

## 11. Build order (sub-projects)

Each gets its own implementation plan.

1. **Foundation:** Supabase project, schema, RLS, categories seed, Expo app skeleton with the four tabs.
2. **Association directory:** import pipeline, tagging, embeddings, confidence score, GitHub Actions schedule.
3. **Explore and search:** semantic + full-text search, ranking, filters, list/map, association pages.
4. **Accounts and interests:** browse-first onboarding, deferred sign-up, interests picker, category requests.
5. **Groups and sessions:** create group, recurrence, join, "I'll be there", reminders, no-shows, share links.
6. **Chat and regulars:** group chat, regulars computation, private messages.
7. **Safety and admin:** reports, blocks, contextual tips, Share my plans, admin screens, association claims.
8. **Launch:** closed test (12+ testers for 14 days, Google Play requirement), store listing, public release.
9. **Later:** website (Expo web), iOS.

## 12. Launch and growth (non-code)

- Invite high-confidence associations to claim their listing and publish their sessions.
- Every group page is shareable, so each organiser brings their own circle.
- One partner association per large city to seed the first groups.
- Recruit closed-test testers early (friends + one or two friendly associations); they become the first users.

## 13. Out of scope for the first release

- iOS and website (planned next).
- Users under 18.
- Payments or paid events.
- One-off (non-recurring) events.
