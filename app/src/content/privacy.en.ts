import { PRIVACY_CONTACT } from './contact.ts';

// Stored as a TypeScript string because Metro does not load .md files as source by default.
// MARKERS: a sentence for a feature that is not built yet is left out of this text. When the feature
// ships, add the sentence back (tagged "(once this feature is available)" while it is in review), then
// remove the marker: post-session feedback (collection and its 6-month deletion), phone verification
// for organisers, private messages (retention and the received-messages clause of the export paragraph). Group chat,
// reports and moderation, feedback, claims and inactive-account deletion are live (keep in sync with
// privacy.fr.ts).
export const privacyEn = `Version to be reviewed by a qualified person before publication.

# Privacy policy

Habitués helps you meet people around regular activities. This page explains, in plain words, what data we collect, why, how long we keep it and how you stay in control.

# What we collect

- Your first name (never your last name), your email address or your Google account to sign you in. No password is stored.
- A confirmation that you are 18 or older. We do not ask for your date of birth.
- Your home area, reduced to the centre of your town (about 1 km precision). Your GPS position is rounded to about 1 km on your phone before any use; it is only used to search for activities around you and to find your town (the public service geo.api.gouv.fr receives this rounded position). It is never stored on our servers.
- Optional: a profile photo and a short bio. Hidden information in the photo (including where it was taken) is removed before upload.
- Your interests, the activities you join, your attendance and your group messages.
- The date of your last visit, updated at most once an hour.
- If you write to us through "Une idée ? Un problème ?": your message, its type, the app version and the type of device, and an optional screenshot (signed-in people only). You can write without an account: the submission is then protected by Cloudflare Turnstile, an invisible anti-bot check. In that case your IP address is sent to Cloudflare Turnstile for this check, and a keyed hash of the address stays in our function's memory for at most one hour to limit the number of submissions; the IP address itself is never stored.
- If you report content or a person: the reason and the details you write. If you claim an association: your role, the association's email address or a supporting document (statutes, receipt or signed letter).
- If you turn notifications on: your phone's identifier to send them, and the text of the notifications (session reminders, new members, invitations). You can refuse or turn them off in your phone's settings.

Your interests and the activities you follow can reveal sensitive information (religion, health, orientation, opinions). We treat them as such: they are never public, only people in the same activity see that you take part, and they are never given to advertisers or used to personalise ads.

# Why, and on what legal basis

- Running the service (account, activities, groups, messages): performance of the contract.
- Safety and moderation (reports, fighting abuse): legitimate interest.

This version of the app shows no ads and we use no third-party advertising trackers. Usage statistics are totals, not linked to any person.

# How long we keep your data

- Group messages: 12 months, then deleted automatically.
- Reports and moderation decisions: 3 years after the decision, then deleted. The report's details and the statement of reasons are kept with it as evidence. When a message is reported, a copy is kept with the report, for the same period.
- Admin audit log (the actions taken by the moderation team): 3 years.
- Ideas and problems you send (text, app version, type of device) and their screenshot: 2 years.
- Association claims: a request left unanswered is deleted after 1 year, with its supporting document. A handled request is kept while the association stays verified; the supporting document and the contact email address are deleted 1 year after the decision.
- Accounts inactive for 3 years: a notification (and a notice in the app) warns you 30 days before deletion; opening the app keeps the account. This warning only reaches people who turned notifications on.
- Accounts suspended for breaking the rules: the data is hidden from other people and kept as evidence for the period set for reports. To learn the statement of reasons or contest the decision, write to ${PRIVACY_CONTACT}.
- Notifications: 30 days on our servers after they are sent, then deleted.
- Technical logs (including IP addresses): kept by our hosts under their default retention (Supabase's is at most 90 days). This is not a period we set ourselves.

Deleting your account is immediate (see below).

# Who processes your data

- Supabase (hosting, database and sign-in), in the European Union (Paris).
- Google (Google sign-in).
- Cloudflare (hosting the website with Cloudflare Pages, protecting the service, the anti-bot check at sign-up and Turnstile for messages sent without an account).
- OpenStreetMap (Overpass service): when you publish an activity or move a session, the app sends a request to this service to check that a public place is nearby. The service sees your phone's network address (IP address). The request only contains the rounded coordinates of the place: no account data is sent.
- Expo (notification relay), then Google Firebase Cloud Messaging (Android) to deliver them to your phone. Notifications are deliberately generic: they contain no activity name or first name, only a short text such as "Reminder: you have an activity tomorrow". The details only show inside the app, after you sign in.
- GitHub (hosting the code of the app and the website: no user data).
- geo.api.gouv.fr (French public service, data.gouv): receives the position rounded to about 1 km to find your town, and the town names you type in the search.

When one of these services is located outside the European Union, the transfer is covered by the EU–US Data Privacy Framework or by standard contractual clauses.

# Website

The website includes the public pages (home, activities, associations, legal notices) and a web version of the app, under /app.

- Hosting: the site is hosted by Cloudflare Pages. Cloudflare keeps technical logs (IP address, page requested, date) for security and for the service to work, for its default period. Our own code stores no IP address (see above for the form without an account) and we add no advertising tracker.
- Your session: if you sign in on the website, your session is kept in your browser storage (localStorage). It is strictly necessary to keep you signed in, so no consent banner is shown. It is erased when you sign out. The public pages set no cookie.
- Sign-up: on the sign-up page, a Cloudflare Turnstile script (challenges.cloudflare.com) runs to check that you are not a robot; Cloudflare receives technical information about your browser when it does. The same script is used by the "Une idée ? Un problème ?" form without an account. It is not loaded on any public page.
- Public activity pages: each running activity has a public page, readable without an account and indexed by search engines. It shows the activity (title, description, category), the town or meeting place, the next session, the number of confirmed people and the organising association or collective. Members' names and photos never appear on them: the organiser's first name is only visible to signed-in people.

# Moderation information

When a report is handled, the person who sent it is told in the app. The person affected by a removal, a warning or a suspension receives the statement of reasons. Both get a discreet notification ("Information de modération") with no detail. You find them, in the app, in Profile, "Informations de modération".

# Your rights and how to use them

Sign in, then open Profile (in the app, the Profile tab; on the website, "My account"), then "My data":

- Download my data: you receive a file with all the personal data we hold about you (including your email address, your account creation and last sign-in dates, and your sign-in methods), and nothing about others.
- Correct: edit your first name, bio, photo and your town directly in Profile (you can also remove your town). On the website, you can edit your first name and bio.
- Delete my account: deletion is immediate and permanent, after confirmation.

Deleting your account also deletes the activities you organise, including their sessions, attendances and group messages. Reports and your "Une idée ? Un problème ?" suggestions stay, but are no longer linked to you.

You can also object to a processing or ask for a restriction by writing to us: ${PRIVACY_CONTACT}. We answer within one month.

# Complaints

If you think your rights are not respected, you can complain to the CNIL (the French data protection authority) at www.cnil.fr.

# Contact

${PRIVACY_CONTACT}
`;
