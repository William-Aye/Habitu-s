# Activities with children: safety design

Date: 2026-11-26. Status: draft, waiting for the owner's approval.

## Intent

Some activities have children present, for example the "Sorties parents-enfants" outings. The owner wants those
children to be safe: an ill-intentioned adult must not be able to find out where and when children meet, or join the
group easily. The app stays 18+ only; the children never have accounts, they come with their parent.

The owner chose option A for launch: protections without identity documents. Identity verification of organisers
(option B, a paid ID-and-selfie check) is a later step, once the app has the means.

## What exists today

- The "Parents" category (`family`) and its two children (`family-sorties-parents-enfants`,
  `family-rencontres-parents`) behave like every other category.
- Activities are open by default: anyone signed in joins at once and sees the place, the sessions and the chat.
- Age is a self-declared "J'ai 18 ans ou plus" box. `can_organise()` asks only for a first name, that box and an
  account older than 24 hours. Phone verification from the original spec is not in use (phone auth is off).
- **Anyone, even signed out, can read the exact place of every activity and session** straight from the database API:
  `anon` and `authenticated` have column `SELECT` on `activities.place`, `activities.place_label`, `sessions.place`
  and `sessions.place_label`, and both tables' select policies let every row through.
- The place is also returned by `get_activity` (to `anon`, and used by the website's `web_activity_page`),
  `session_card` (inside `get_activity`), `my_activities` and `search_explore` (exact `lon`/`lat` and a distance with
  one decimal, which allows the place to be triangulated by searching from several points).
- The app itself never selects `place` columns directly; it reads them only through those functions.
- Report reasons: `unsafe_place`, `inappropriate_behaviour`, `harassment`, `fake_or_spam`, `did_not_happen`, `other`.
  The admin queue is ordered by date only.
- `activity_roster` shows the organiser first name, photo and status of members and pending requests.

## Goals

1. An activity "with children" never shows its exact place, or its sessions' places, to anyone who is not an accepted
   member, its organiser, a co-organiser or an admin. This holds in the app, on the website, in search and through the
   raw database API.
2. Nobody joins such an activity without the organiser's approval.
3. Only established accounts can ask to join or can organise one: a profile photo and an account at least 7 days old.
4. The organiser has what they need to decide on a request: first name, photo, bio and "Membre depuis".
5. A worrying behaviour towards children can be reported as such, and those reports come first in the admin queue.
6. Parents get clear advice at the right moment.

## Non-goals

- Identity-document checks (option B, later).
- Criminal-record checks: in France only the person can request their own record, and article 10 of the RGPD forbids a
  private company from collecting such data. The app must never ask for it.
- Accounts for people under 18.
- Private messages (not in release 1 anyway).

## Anti-goals (a failure even if it technically works)

- The exact place leaks through any path: an API column, the search map or distance, the website, a share link, a
  notification to a non-member.
- Parents feel watched or graded. No score or rating of participants (spec section 9 still applies).
- Activities without children get extra friction.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Protections without identity documents: forced approval, place hidden until accepted, photo and 7-day account required, priority reports, advice | Free and quick. A careful fake profile can still be accepted by an organiser. |
| B | A plus an ID-and-selfie check by a specialised provider for organisers (or everyone) | Stops fake profiles and deters, but costs a few euros per check, adds a step and needs an RGPD impact assessment (AIPD). Planned for later. |
| C | Only verified associations may run activities with children | Safest, but almost no such activities at launch. |

The owner picked A on 2026-11-26.

## Design

### Which activities are "with children"

- New column `activities.with_children boolean not null default false`.
- It is forced to `true` when the activity's category is `family` or one of its child categories. The organiser cannot
  turn it off while the category is in that tree.
- Any other activity can be marked by its organiser with a "Des enfants seront présents" option in the settings step,
  so a children's football session filed under Sport gets the same protections.
- Turning it off is allowed only when the category is outside the Parents tree. An admin can set it on any activity.
- Existing members stay when the flag is turned on later; the rules below apply to new requests.

### Approval is mandatory

- A check: `not with_children or approval_mode = 'approval'`. Turning the flag on (by category or by the option)
  switches approval on in the same write, so an open activity moved into the Parents category is not refused. The
  create and edit screens show approval as on and locked, with one line saying why.
- Joining therefore always creates a `pending` row (existing `activity_members_set_status` trigger and
  `members_insert` policy).

### Who may ask to join, and who may organise

- Asking to join a with-children activity requires a profile photo (`profiles.photo_url` set) and an account created at
  least 7 days ago, on top of today's rules (first name, 18+ box). Enforced in the database; refused with a specific
  error the app turns into a clear message ("Ajoutez une photo de profil", "Votre compte doit avoir au moins 7 jours").
- The same two conditions apply to creating a with-children activity, to marking an activity as with children, and to
  being invited or accepted as co-organiser of one.
- Before the "Demander à rejoindre" button, the activity page says what is missing, if anything. On the website the
  photo can only be added in the app (the web profile has no photo), so the web message points to the app.

### The place stays hidden until accepted

- Revoke column `SELECT` on `place` and `place_label` of `activities` and `sessions` from `anon` and `authenticated`,
  for every activity (column grants cannot vary by row). All reads go through the functions below, which decide per
  row. The app already reads places only through those functions, and Realtime is used only for chat messages.
  Checked on 2026-11-26: every function that reads these columns is `security definer` except `search.explore_rows`,
  which API roles cannot execute and which runs inside `search_explore`. Existing pgTAP tests that select these
  columns as `anon` or `authenticated` must move to the functions.
- `get_activity`, `session_card` and `my_activities`: for a with-children activity, when the caller is not an accepted
  member, the organiser, an active co-organiser or an admin, return `place_label = null`, `lon`/`lat = null`, every
  session's `place_label = null`, and `place_hidden = true`. Pending requesters see the same as strangers.
- `search_explore` and `explore_rows`: use a public point that, for with-children activities, is the place rounded to 2
  decimals (about 1 km, the same rounding as `profiles.home_area`), both for the radius filter and for the returned
  `lon`/`lat` and distance. Rounding only the output would still let someone find the exact place by moving the search
  centre across a radius edge. A generated, indexed column (for example `search_point`) is one way; the builder chooses.
  The "new activity nearby" alert from the spec is not built yet; when it is, its distance must use the same point.
- Website: the activity page of a with-children activity shows the title, description, category and schedule, with
  "Lieu communiqué aux participants acceptés" instead of the place and map. It has no Event JSON-LD (an Event needs a
  location). It stays in the sitemap.
- App: the activity page shows the same line instead of the place and hides "Voir sur la carte"; the explore card and
  the activity page show a label "Avec des enfants".
- The create flow tells the organiser not to write the address in the title or description (a hint; it cannot be
  enforced).

### Deciding on a request

- `activity_roster` also returns `bio` and `member_since` (`profiles.created_at`) for pending rows, so the organiser
  sees the neutral facts the spec already promises. No other information, no score.

### Reports

- New report reason `child_safety`, shown as "Comportement inquiétant envers des enfants", offered on with-children
  activities, their sessions, their members and their chat messages.
- `admin_reports` lists open reports with reason `child_safety`, or on a with-children activity (or its sessions or
  messages), before the others.

### Advice for parents

- A new contextual safety tip, shown once on the first with-children activity a person opens and listed on the
  "Conseils de sécurité" page: the child always stays with their parent and is never left with another adult; meet
  only in the public place; do not share photos of children or personal details in the chat; report anything worrying.
- The terms (`web/src/legal.ts`) gain one sentence: children come under the sole responsibility of their parent, and
  Habituer does not check identities or criminal records. This joins the owner's legal review (launch checklist step 14).

### Spec and documents

- Spec section 9 (Safety) gets a "Activities with children" subsection summarising the rules above.
- No new personal data is collected, so the privacy texts and the Play data safety form do not change.

## Tests the builder must add

- pgTAP: `anon` and `authenticated` cannot select the four place columns; `get_activity`, `session_card`,
  `my_activities` hide the place of a with-children activity from a stranger and a pending requester and show it to a
  member, the organiser, a co-organiser and an admin; activities without children are unchanged.
- pgTAP: `search_explore` returns only the rounded point for a with-children activity, and searching from a centre that
  is within the radius of the exact place but outside that of the rounded point (and the reverse) gives the rounded
  answer.
- pgTAP: the flag is forced for the Parents tree; approval is forced; join, create and co-organiser rules for photo and
  7-day account; the `child_safety` reason; queue order.
- App (Jest): hidden place line and no map link; missing-requirement messages; locked approval toggle; the new tip.
- Web (Deno): a with-children page has no place, no map and no Event JSON-LD.

## Left to the builder

- Exact migration split, function signatures and error codes.
- How the public search point is stored and indexed, measured against the search performance budget.
- Wording of the app strings (French and English), within the meaning above.
- Whether the "Avec des enfants" label also appears as an explore filter (not required).

## Calls made by Claude, for the owner to check

1. The whole Parents category is covered, including "Rencontres de parents", because children are often there too.
2. Any activity can be marked "Des enfants seront présents", so the rules cannot be avoided by picking another
   category.
3. The same photo and 7-day rule applies to organisers and co-organisers, not only to people joining.
4. Pending requesters do not see the place either; only accepted members do.
5. The website page stays public and in the sitemap, without the place and without the Event rich result.
6. Reports on these activities come first in the admin queue; no extra alert by e-mail or push.
