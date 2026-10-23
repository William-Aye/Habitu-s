// Stored as a TypeScript string because Metro does not load .md files as source by default.
// MARKERS: every sentence tagged "(once this feature is available)" describes a feature that
// is not built yet. Remove the marker when it ships: messages and group/private chat, post-session
// feedback, 12-month/6-month automatic deletion, inactive-account warning and deletion, phone
// verification for organisers, reports and moderation (3-year purge), private messages (their mention in the export paragraph) (keep in sync with privacy.fr.ts).
export const privacyEn = `Version to be reviewed by a qualified person before publication.

# Privacy policy

Habitués helps you meet people around regular activities. This page explains, in plain words, what data we collect, why, how long we keep it and how you stay in control.

# What we collect

- Your first name (never your last name), your email address or your Google account to sign you in. No password is stored.
- A confirmation that you are 18 or older. We do not ask for your date of birth.
- Your home area, reduced to the centre of your town (about 1 km precision). Your GPS position is rounded to about 1 km on your phone before any use; it is only used to search for activities around you and to find your town (the public service geo.api.gouv.fr receives this rounded position). It is never stored on our servers.
- Optional: a profile photo and a short bio. Hidden information in the photo (including where it was taken) is removed before upload.
- Your interests, the activities you join, your attendance, your group messages and your feedback after sessions (once this feature is available).
- Your phone number, only if you organise activities, to verify your identity. It is held by our sign-in service and never appears in the app (once this feature is available).
- The date of your last visit, updated at most once an hour.
- If you turn notifications on: your phone's identifier to send them, and the text of the notifications (session reminders, new members, invitations). You can refuse or turn them off in your phone's settings.

Your interests and the activities you follow can reveal sensitive information (religion, health, orientation, opinions). We treat them as such: they are never public, only people in the same activity see that you take part, and they are never given to advertisers or used to personalise ads.

# Why, and on what legal basis

- Running the service (account, activities, groups, messages): performance of the contract.
- Personalised ads, if they ever exist: your consent, which you can withdraw at any time.
- Safety and moderation (reports, fighting abuse): legitimate interest.

We use no third-party advertising trackers. Usage statistics are totals, not linked to any person.

# How long we keep your data

- Group messages: 12 months, then deleted automatically (once this feature is available).
- Private messages: 12 months, then deleted automatically (once this feature is available).
- Feedback answers after sessions: aggregated into statistics, then the raw answers are deleted after 6 months (once this feature is available).
- Reports and moderation decisions: 3 years, then deleted (once this feature is available).
- Accounts inactive for 3 years: warning email, then deletion 30 days later (once this feature is available).
- Notifications: 30 days on our servers after they are sent, then deleted.
- Technical logs (including IP addresses): our host's default retention, at most 90 days.

Deleting your account is immediate (see below).

# Who processes your data

- Supabase (hosting, database and sign-in), in the European Union (Paris).
- Google (Google sign-in and, where applicable, ads).
- Cloudflare (protecting the service and the anti-bot check at sign-up).
- Expo (notification relay), then Google Firebase Cloud Messaging (Android) and Apple Push Notification service (iPhone) to deliver them to your phone. Notifications are deliberately generic: they contain no activity name or first name, only a short text such as "Reminder: you have an activity tomorrow". The details only show inside the app, after you sign in.
- GitHub (hosting the code of the app and the website: no user data).
- geo.api.gouv.fr (French public service, data.gouv): receives the position rounded to about 1 km to find your town, and the town names you type in the search.

When one of these services is located outside the European Union, the transfer is covered by the EU–US Data Privacy Framework or by standard contractual clauses.

# Your rights and how to use them

In the app, open Profile, then "My data":

- Download my data: you receive a file with all the personal data we hold about you (including your email address, your account creation and last sign-in dates, and your sign-in methods), and nothing about others. The private messages you received are deleted with your account but are not part of your export: they belong to their sender (Art. 15(4) GDPR) (once this feature is available).
- Correct: edit your first name, bio, photo and your town directly in Profile (you can also remove your town).
- Delete my account: deletion is immediate and permanent, after confirmation.

Deleting your account also deletes the activities you organise, including their sessions, attendances and group messages. Reports and your "Une idée ? Un problème ?" suggestions stay, but are no longer linked to you.

You can also object to a processing or ask for a restriction by writing to us: confidentialite@<domaine>. We answer within one month.

# Complaints

If you think your rights are not respected, you can complain to the CNIL (the French data protection authority) at www.cnil.fr.

# Contact

confidentialite@<domaine>
`;
