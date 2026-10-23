# Group Chat (Sub-project 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every activity has one discussion. Its organiser and members read and write it in real time, see who wrote each message (first name and photo), get a discreet notification when they're away, can mute it, report or block a sender, delete their own messages, and keep writing offline (sent on reconnect). The "Messages" tab lists their discussions with unread counts.

**Architecture:** The `messages` table and its read/insert policies already exist (foundation). One migration adds the chat rules: sender and time pinned, a 30-per-minute limit, read-only once the activity is archived, deleting your own message, per-person read and mute state, page RPCs that join first names, 12-month retention, and the table in the Realtime publication. A second migration adds the discreet `chat_message` push, at most one per person per discussion every 15 minutes. The app uses Realtime only as a "something changed" signal and always reads through the RPC, so names, blocks and access stay enforced by the database. A small offline outbox in AsyncStorage resends unsent messages with their client-made id, so a retry can never post twice.

**Tech Stack:** Supabase Postgres (RLS, pg_cron), Supabase Realtime (`postgres_changes`), pgTAP; Expo (expo-router), `@supabase/supabase-js` channels, `@react-native-community/netinfo`, AsyncStorage (existing), i18next, Lucide, Jest + Testing Library.

**Spec:** `docs/specs/2026-10-21-friend-app-design.md`. The relevant sections are:
- §3 (Realtime for activity chat)
- §4 `messages`
- §8 "Sign-up" (sending a message triggers sign-up) and "Navigation" (Messages tab)
- "Notifications" (chat messages, mutable per activity)
- §9 (report and block on every message; blocking hides both users)
- §11 (messages limited to 30 per minute)
- §12 (offline queue)
- §13 (RLS: non-members cannot read the chat)
- §14 Release 1 item 6
- §18.2 (chat messages kept 12 months)

It builds on `docs/plans/2026-10-23-activities-sessions.md`, including the owner's rulings on discreet notifications and on blocks hiding and removing.

## Decisions for the owner to confirm

1. **Real time through Supabase Realtime, as a signal only.** The open discussion subscribes to new or deleted rows for its activity, then re-reads them through the RPC. It costs nothing extra on the free tier (200 simultaneous connections, 2 million Realtime messages a month), and access and blocks stay enforced in the database. *Owner to confirm.*
2. **Who takes part:** the organiser and members with status `member`. A pending request, a removed member or someone who left can't read or write. Leaving hides the discussion's history from that person. *Owner to confirm.*
3. **Chat notifications are discreet**, following the owner's earlier ruling: "Nouveau message" / "Nouveau message dans une de vos activités." A person gets at most **one per discussion every 15 minutes**, none if they read that discussion in the last 2 minutes, and none when they've muted it ("Couper les notifications"). *Owner to confirm.*
4. **You can delete your own messages.** They disappear for everyone, with no "message supprimé" placeholder. Admins can already delete any message. *Owner to confirm.*
5. **Report and block from a message** (long press → "Signaler", "Bloquer {{prenom}}") use the existing `reports` and `blocks` tables. The admin review queue comes in sub-project 7. *Owner to confirm.*
6. **Text only.** No photos, no voice, and no automatic links: a URL shows as plain text, which helps safety. Up to 2000 characters, as the existing table allows. The banned-word filter is in sub-project 7. *Owner to confirm.*
7. **Archived activity:** the discussion stays readable for its members but nobody can post. *Owner to confirm.*

## Global Constraints

- **Out of this plan:**
  - private messages between regulars (Release 2, item 13);
  - the banned-word and spam filter, and the admin reports queue (sub-project 7);
  - photos and attachments.
- **Access rule (database):** read and write only when `public.is_activity_member(activity_id)` is true (the organiser, or a member with status `member`) and the activity is not archived (write only). Blocked senders are hidden from each other through the existing `messages_select_group` policy.
- **Limits:** body 1–2000 characters (existing check, trimmed by the app). **30 messages per user per rolling minute**, enforced by a trigger raising 42501 `limit_reached`, with `pg_advisory_xact_lock(hashtext('limits:'||auth.uid()))` like the other limits. Admins and the service role are exempt.
- **Pinned for API roles:** `sender_id = auth.uid()` and `created_at = now()` (a client can't backdate or impersonate). `id` may be supplied by the client (a UUID for idempotent retries).
- **Retention:** a nightly pg_cron job `prune-messages` at 04:10 deletes messages older than **12 months**.
- **Notifications:** kind `chat_message`. Texts are "Nouveau message" / "Nouveau message dans une de vos activités." and "New message" / "New message in one of your activities."
  - Data is `{activity_id, kind: 'chat_message'}`, with no names and no message text. `send-push` forwards `data` but not the kind, so the kind must be in `data`.
  - The dedupe key is `'chat:'||activity_id||':'||user_id||':'||floor(extract(epoch from now())/900)`.
  - The actor is the sender, so blocks suppress it.
- **Copy (French source, exact):**
  - Tab and screen titles: "Messages", "Discussion".
  - Composer and button: "Écrire un message…", "Envoyer".
  - Empty states: "Aucune discussion pour l'instant", "Rejoignez une activité pour discuter avec le groupe.", "Soyez la première personne à écrire."
  - Non-member: "Rejoignez l'activité pour participer à la discussion."
  - Read-only: "Cette activité est archivée : la discussion est en lecture seule."
  - Mute: "Couper les notifications", "Réactiver les notifications".
  - Message actions: "Signaler", "Bloquer {{prenom}}", "Supprimer le message", "Supprimer ce message pour tout le monde ?".
  - Sending states: "Envoi…", "Non envoyé — touchez pour réessayer".
  - Limit: "Vous envoyez beaucoup de messages. Patientez une minute."
  - Report reasons: "Contenu inapproprié", "Harcèlement", "Arnaque ou spam", "Autre".
  - Activity page button: "Discussion".
- **App rules:**
  - No hard-coded UI text, no emoji.
  - Lucide icons with text labels, and screen-reader labels.
  - Buttons are disabled while busy.
  - RNTL 14 requires `await render` / `await fireEvent`.
  - Local Supabase runs on ports 553xx.
  - Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The same message sent twice:** a retry after a lost network response, or a double tap. The client-made `id` makes the second insert a 23505, which the app treats as sent. Only one copy ever appears. → tests in Tasks 1 and 3.
2. **Someone removed, blocked or leaving while the discussion is open:** their next read returns nothing new and their send is refused. The screen shows the non-member state instead of crashing. The other members no longer see a blocked person's messages. → tests in Tasks 1 and 4.
3. **A burst of messages in a 20-person group:** each person gets one notification per 15-minute window, not twenty. → test in Task 2.
4. **Offline, then back online, with the app closed in between:** unsent messages survive a restart and are sent in order on reconnect. Messages that fail for good (not a member any more, limit reached, too long) are marked, not retried forever. → tests in Task 3.
5. **Long discussions:** opening loads the latest 50, scrolling up loads older ones without duplicates or gaps, and new messages arriving meanwhile appear once. → tests in Tasks 1 and 4.

---

## File Map

```
supabase/migrations/20261023000027_chat.sql                rules, limit, chat_states, RPCs, realtime publication, retention, export
supabase/migrations/20261023000028_chat_notifications.sql  notif_text + chat_message trigger
supabase/tests/21_chat.test.sql, 22_chat_notifications.test.sql
app/src/features/chat/  types.ts, api.ts, outbox.ts, useChat.ts, MessageBubble.tsx, Composer.tsx, MessageActions.tsx
app/src/app/discussions/[activityId].tsx          the discussion screen
app/src/app/(tabs)/messages.tsx                   replaces the placeholder
app/src/app/(tabs)/_layout.tsx                    unread badge on the Messages tab
app/src/app/activites/[id].tsx                    "Discussion" button for members
app/src/features/notifications/responses.ts       chat_message tap → /discussions/<id>
```

---

### Task 1: Chat rules, read state and page RPCs (database)

**Files:** Create `supabase/migrations/20261023000027_chat.sql` and `supabase/tests/21_chat.test.sql`.

**Interfaces:**
- **Produces:**
  - **Guard trigger `messages_guard`** (before insert, API roles, not admin):
    - Pins `sender_id := auth.uid()` and `created_at := now()`.
    - Refuses with 42501 `not_allowed` when the activity is archived.
    - Enforces the 30-per-minute limit with 42501 `limit_reached`.
  - **Delete policy `messages_delete_own`:** `sender_id = auth.uid()`.
  - **Table `public.chat_states`:**
    - Columns: `activity_id uuid references activities on delete cascade`, `user_id uuid references profiles on delete cascade`, `last_read_at timestamptz not null default now()`, `muted boolean not null default false`, primary key `(activity_id, user_id)`.
    - RLS: own rows only. Grants: `authenticated` select only; writes go through the RPCs below.
  - **`public.chat_messages(p_activity uuid, p_before timestamptz default null, p_after timestamptz default null, p_limit int default 50) returns jsonb`**
    - Security definer, authenticated only.
    - Returns null when the caller is not `is_activity_member`.
    - Otherwise returns `{archived boolean, messages: [{id, body, created_at, sender: {id, first_name, photo_url}, is_mine}]}`, newest first, capped at 100.
    - Excludes senders blocked in either direction.
    - `p_before` pages older messages; `p_after` fetches newer ones.
  - **`public.my_chats() returns jsonb`** (authenticated):
    - One row per activity the caller organises or is a member of (status `member`), not archived or archived with messages.
    - Each row: `{activity_id, title, last_message: {body, created_at, sender_first_name} | null, unread_count, muted}`.
    - Ordered by last message, then title.
    - `unread_count` counts messages after `last_read_at` that are not the caller's own and not from blocked senders, capped at 99.
  - **`public.mark_chat_read(p_activity uuid) returns void`:** upserts `last_read_at = now()`. Members only, otherwise 42501.
  - **`public.set_chat_muted(p_activity uuid, p_muted boolean) returns void`:** members only.
  - **Realtime:** `alter publication supabase_realtime add table public.messages`. Realtime applies the select policies per subscriber.
  - **Retention:** cron `prune-messages` `'10 4 * * *'` deletes `messages` with `created_at < now() - interval '12 months'`.
  - **Export:** `export_my_data` is redefined with `create or replace`, keeping every key from migration 23 and adding `chat_states`. Diff it against migration 23.
- [ ] **Step 1: Failing tests** in `21_chat.test.sql`:
  - **Access:**
    - A member and the organiser can insert and read.
    - A pending requester, a removed member, a non-member and anon can't read (`chat_messages` returns null, and a direct select returns 0 rows) and can't insert (42501).
  - **Pinning and archiving:**
    - Inserting with another `sender_id` or a 2020 `created_at` stores the caller and now().
    - Inserting into an archived activity's chat is refused, while reading still works and returns `archived: true`.
  - **Rate limit:** the 31st message in a minute raises `limit_reached`; 30 succeed.
  - **Idempotency:** inserting the same `id` twice raises 23505 and only one row exists.
  - **Deleting:** you can delete your own message, but deleting someone else's affects 0 rows.
  - **Blocks:** after a block, `chat_messages` hides that sender in both directions.
  - **Paging:** 120 messages give a first page of 50, then `p_before` gives the next 50 with no overlap and no gap; `p_after` returns only newer ones; `p_limit` 500 is capped at 100.
  - **`my_chats`:**
    - `unread_count` counts others' messages after `last_read_at`, and `mark_chat_read` resets it to 0.
    - Own messages never count.
    - A muted chat reports `muted: true`.
  - **Retention:** a 13-month-old message is deleted by the prune function and a 11-month-old one is kept.
  - **Setup:** `messages` is in `pg_publication_tables` for `supabase_realtime`.
  - **Export:** the export contains `chat_states`.
- [ ] **Step 2: Run RED.** Run `npm run db:reset && npm run db:test` and expect the new file to fail.
- [ ] **Step 3: Implement the migration.** Write the prune logic as `public.prune_messages() returns int`, revoked from API roles, and schedule it with cron.
- [ ] **Step 4: Run GREEN**, then `npm run db:types`.
- [ ] **Step 5: Commit** with the message `feat(db): group chat rules, read state, page RPCs and retention`.

---

### Task 2: Discreet chat notifications (database)

**Files:** Create `supabase/migrations/20261023000028_chat_notifications.sql` and `supabase/tests/22_chat_notifications.test.sql`.

**Interfaces:**
- **Consumes:**
  - `public.notify_user(p_user, p_kind, p_title_fr, p_body_fr, p_title_en, p_body_en, p_data, p_dedupe, p_send_after, p_actor)`. It ignores the caller's texts and uses `notif_text`.
  - `chat_states` from Task 1.
- **Produces:**
  - **`public.notif_text`** redefined with `create or replace`, keeping every existing row: all the kinds from migration 24 plus the `session_cancelled` text from migration 26. Add `chat_message` with the texts from Global Constraints, and add it to the fallback exclusion list.
  - **Trigger `messages_notify`** (after insert on `messages` where `activity_id is not null`). For every organiser or `member` of the activity except the sender:
    - Skip people whose `chat_states.muted` is true.
    - Skip people whose `last_read_at > now() - interval '2 minutes'`.
    - Otherwise call `notify_user(user, 'chat_message', …, jsonb_build_object('activity_id', activity_id, 'kind', 'chat_message'), <dedupe key from Global Constraints>, now(), new.sender_id)`.
- [ ] **Step 1: Failing tests** in `22_chat_notifications.test.sql`:
  - **One notification per window:** a group of 4 (organiser plus 3 members) gets 3 outbox rows after one message, none for the sender. After 10 more messages in the same 15-minute window there are still 3.
  - **Skips:**
    - A muted member gets none.
    - A member who called `mark_chat_read` within 2 minutes gets none.
    - A member who blocked the sender gets none.
  - **Texts:** the outbox title and body equal "Nouveau message" / "Nouveau message dans une de vos activités." (and the English ones for an `en` profile). The data is exactly `{activity_id, kind: 'chat_message'}`, and the body contains neither the message text nor a first name.
  - **No regression:** every other kind's text is unchanged (assert `session_reminder` and `session_cancelled`).
- [ ] **Step 2: Run RED.**
- [ ] **Step 3: Implement.** Diff `notif_text` against migrations 24 and 26 so that only the new row and the exclusion list change.
- [ ] **Step 4: Run GREEN**, including the existing `13_notifications` file.
- [ ] **Step 5: Commit** with the message `feat(db): discreet chat notifications, one per discussion every 15 minutes`.

---

### Task 3: Chat data layer and offline outbox (app)

**Files:**
- Create `app/src/features/chat/{types.ts,api.ts,outbox.ts}`.
- Create `app/__tests__/chat-api.test.ts` and `app/__tests__/chat-outbox.test.ts`.
- Install `@react-native-community/netinfo` with `npx expo install`, and mock it in `jest.setup.js`.

**Interfaces:**
- **Consumes:** the RPCs from Task 1, plus the existing `run` / `runAsUser` / `mapError` helpers in `app/src/features/activities/{api.ts,errors.ts}`. Reuse them by moving the shared helpers into a small module if needed; don't copy them.
- **Produces:**
  - **`types.ts`:**
    - `ChatMessage = {id: string; body: string; createdAt: string; sender: {id: string; firstName: string; photoUrl: string | null}; isMine: boolean}`
    - `ChatPage = {archived: boolean; messages: ChatMessage[]}`
    - `ChatSummary = {activityId: string; title: string; lastMessage: {body: string; createdAt: string; senderFirstName: string} | null; unreadCount: number; muted: boolean}`
    - `PendingMessage = {id: string; activityId: string; body: string; createdAt: string; state: 'sending' | 'failed'; error?: ChatError}`
    - `ChatError = 'not_allowed' | 'limit_reached' | 'network' | 'unknown'`
  - **`api.ts`**:
    - `fetchMessages(activityId, opts?: {before?: string; after?: string; limit?: number}): Promise<{ok: true; page: ChatPage | null} | {ok: false; error: ChatError}>`. A `null` page means not a member.
    - `sendMessage(activityId, id, body): Promise<{ok: true} | {ok: false; error: ChatError}>`. A 23505 counts as `ok`.
    - `deleteMessage(id)`, with `.select()` and `expectRows`.
    - `myChats()`
    - `markRead(activityId)`
    - `setMuted(activityId, muted)`
    - `reportMessage(messageId, reason: 'inappropriate' | 'harassment' | 'scam' | 'other')`. It inserts into `reports` with `target_type 'message'`.
    - `blockUser(userId)`
  - **`outbox.ts`:**
    - `enqueue(activityId, body): PendingMessage`. It creates a UUID, trims the body, and rejects empty or over-2000-character bodies before queuing.
    - `pending(activityId): PendingMessage[]`
    - `flush(): Promise<void>`. It sends in creation order and keeps going after a failure. `network` stays queued as `sending`. `not_allowed`, `limit_reached` and `unknown` become `failed`.
    - `retry(id)`
    - `discard(id)`
    - `subscribe(listener): () => void`
    - The queue is persisted in AsyncStorage under `chat.outbox.v1`.
    - `flush` runs on enqueue, on NetInfo "connected", and when the app comes to the foreground.
- [ ] **Step 1: Failing tests:**
  - **API:**
    - Every function calls the right RPC or table with exact parameters.
    - A null `chat_messages` result maps to `page: null`.
    - A 23505 on send is `ok`.
    - A `limit_reached` 42501 maps to `limit_reached`.
    - Deleting someone else's message (empty result) maps to `not_allowed`.
  - **Outbox:**
    - Enqueue persists.
    - A restart restores the queue: re-import the module with the same AsyncStorage mock.
    - `flush` sends in order.
    - Offline keeps the item as `sending`; the NetInfo connect event flushes it.
    - `not_allowed` marks it `failed` and stops retrying.
    - `retry` resends.
    - `discard` removes it.
    - Two concurrent `flush` calls send each message once.
    - A body of whitespace only is refused.
- [ ] **Step 2: Run RED.** Run `cd app && npx jest chat-`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run GREEN**, plus `npm run lint && npx tsc --noEmit`.
- [ ] **Step 5: Commit** with the message `feat(app): chat data layer with offline outbox`.

---

### Task 4: Discussion screen

**Files:**
- Create `app/src/features/chat/{useChat.ts,MessageBubble.tsx,Composer.tsx,MessageActions.tsx}`, `app/src/app/discussions/[activityId].tsx` and `app/__tests__/discussion-screen.test.tsx`.
- Modify `app/src/app/activites/[id].tsx` to add a "Discussion" button for members and the organiser.

**Interfaces:**
- **Consumes:** Task 3, `useSession`, `useRequireAccount()('message')`, and `supabase.channel`.
- **Produces:**
  - `useChat(activityId)` returns `{state: 'loading' | 'not_member' | 'ready' | 'error', archived, messages (server ⊕ pending, newest last, deduped by id), loadOlder(), hasOlder, send(body), retry(id), discard(id), remove(id), muted, toggleMute()}`.
  - It subscribes to the channel `chat:<activityId>` with `postgres_changes` (event `*`, table `messages`, filter `activity_id=eq.<id>`). On INSERT it fetches with `after = newest createdAt`. On DELETE it drops the id locally. It unsubscribes on unmount.
  - It calls `markRead` on open and after new messages arrive while the screen is focused.
- **Screen:**
  - A header with the activity title and a mute toggle.
  - An inverted list: the bubble shows the sender's first name and photo for others, with time in Europe/Paris through the existing `formatSessionDate` style helper. The user's own messages align right.
  - Pending messages show "Envoi…" or "Non envoyé — touchez pour réessayer".
  - A long press opens `MessageActions`:
    - On your own message: "Supprimer le message", with a confirmation.
    - On others: "Signaler" (with a reason picker) and "Bloquer {{prenom}}" (with a confirmation; afterwards the list reloads).
  - **Composer:** a multiline input with a 2000-character limit and a character count shown after 1800. "Envoyer" is disabled when the trimmed text is empty.
  - **Special states:**
    - A signed-out user opening the screen gets the account gate (`message`).
    - A non-member sees "Rejoignez l'activité pour participer à la discussion." and a button back to the activity.
    - An archived activity shows the read-only notice instead of the composer.
    - `limit_reached` shows the limit message.
  - URLs render as plain text, with no auto-link.
- [ ] **Step 1: Failing tests:**
  - Loading shows the messages with the sender's first name, and the user's own messages have no name.
  - Sending shows the bubble at once as "Envoi…", then as sent.
  - An offline send shows "Envoi…" and is sent after the NetInfo connect event.
  - A realtime INSERT event triggers a fetch `after` the newest message and appends exactly once, even if the same message is already pending locally.
  - A DELETE event removes the bubble.
  - Scrolling to the top calls `loadOlder` with `before` = the oldest message.
  - A non-member state shows the join text.
  - Archived hides the composer.
  - Long-pressing your own message offers only "Supprimer le message", and others' messages offer "Signaler" and "Bloquer".
  - Reporting sends the chosen reason.
  - The mute toggle calls `setMuted`.
  - `markRead` is called on open.
  - The channel is removed on unmount.
  - The activity page shows "Discussion" to a member and not to a visitor.
- [ ] **Step 2: Run RED.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run GREEN**, plus lint and tsc.
- [ ] **Step 5: Commit** with the message `feat(app): activity discussion screen with realtime, report, block and mute`.

---

### Task 5: Messages tab, notification tap and full check

**Files:**
- Replace `app/src/app/(tabs)/messages.tsx`.
- Modify `app/src/app/(tabs)/_layout.tsx` (unread badge), `app/src/features/notifications/responses.ts`, and `README.md` (a "Group chat" paragraph on Realtime, retention and limits).
- Create `app/__tests__/messages-tab.test.tsx`.
- Extend `app/__tests__/notification-responder.test.tsx`.

**Interfaces:**
- **Consumes:** `myChats()` from Task 3, and the `/discussions/[activityId]` route from Task 4.
- **Produces:**
  - **The Messages tab:**
    - One row per `ChatSummary`: the title, the last message as "{{prenom}} : {{texte}}" (one line, truncated), a relative time, an unread count badge, and a muted icon with a label.
    - Tapping a row opens `/discussions/<id>`.
    - The list refreshes on focus.
    - **Empty state:** "Aucune discussion pour l'instant" and "Rejoignez une activité pour discuter avec le groupe.", with an "Explorer" button.
    - **Signed out:** the same empty state, without an RPC call.
  - **Tab badge:** the sum of `unreadCount`, refreshed on focus and on app foreground. It shows "99+" above 99, with an accessibility label.
  - **Notification tap:** a notification whose `data.kind` is `chat_message` opens `/discussions/<activity_id>` instead of the activity page.
- [ ] **Step 1: Failing tests:**
  - The empty state is shown.
  - The rows are sorted as returned, with unread badges.
  - Tapping a row navigates.
  - A muted row shows its label.
  - The tab badge sums the unread counts.
  - A `chat_message` notification tap navigates to the discussion.
- [ ] **Step 2: Run RED.** Then **Step 3: Implement**, and **Step 4: Run GREEN**.
- [ ] **Step 5: Run all suites:**
  - `npm run db:reset && npm run db:test`
  - `npx --yes deno@2 test supabase/functions` (delete `deno.lock` afterwards)
  - `cd importer && uv run pytest`
  - `cd app && npm test && npm run lint && npx tsc --noEmit`
- [ ] **Step 6: Commit** with the message `feat(app): Messages tab with unread counts; chat notification taps`.
