begin;
\ir helpers.inc
select plan(102);
select tests.create_user('org@ch.fr', 'Olivier') as org \gset
select tests.create_user('m1@ch.fr', 'Marie') as m1 \gset
select tests.create_user('m2@ch.fr', 'Marc') as m2 \gset
select tests.create_user('pe@ch.fr', 'Paul') as pe \gset
select tests.create_user('re@ch.fr', 'Remi') as re \gset
select tests.create_user('ou@ch.fr', 'Hugo') as ou \gset
select tests.create_user('rl@ch.fr', 'Rita') as rl \gset
select tests.create_user('sp@ch.fr', 'Sam') as sp \gset
select tests.create_user('nm@ch.fr', 'Nina') as nm \gset
select tests.create_user('lf@ch.fr', 'Leo') as lf \gset
select tests.create_user('ad@ch.fr', 'Adam') as ad \gset
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');

insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, max_size, archived_at) values
  ('00000000-0000-0000-0000-0000000000a1', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go du soir', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', 30, null),
  ('00000000-0000-0000-0000-0000000000a2', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go archive', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', 30, now()),
  ('00000000-0000-0000-0000-0000000000a3', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go bloque', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', 30, null),
  ('00000000-0000-0000-0000-0000000000a4', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go pagine', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', 30, null),
  ('00000000-0000-0000-0000-0000000000a5', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go vide', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', 30, null);
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000a1', :'m1', 'member'),
  ('00000000-0000-0000-0000-0000000000a1', :'m2', 'member'),
  ('00000000-0000-0000-0000-0000000000a1', :'pe', 'pending'),
  ('00000000-0000-0000-0000-0000000000a1', :'re', 'removed'),
  ('00000000-0000-0000-0000-0000000000a1', :'rl', 'member'),
  ('00000000-0000-0000-0000-0000000000a2', :'m1', 'member'),
  ('00000000-0000-0000-0000-0000000000a3', :'m1', 'member'),
  ('00000000-0000-0000-0000-0000000000a3', :'m2', 'member'),
  ('00000000-0000-0000-0000-0000000000a4', :'sp', 'member');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, max_size) values
  ('00000000-0000-0000-0000-0000000000a6', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go egalite', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', 30),
  ('00000000-0000-0000-0000-0000000000a7', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go nouveaux', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', 30);
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000a6', :'sp', 'member'),
  ('00000000-0000-0000-0000-0000000000a7', :'nm', 'member'),
  ('00000000-0000-0000-0000-0000000000a7', :'lf', 'member');
-- Everyone joined long before the messages written below, except the a7 members (joined now).
update activity_members set joined_at = now() - interval '1 day' where activity_id <> '00000000-0000-0000-0000-0000000000a7';
insert into activity_members (activity_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000a1', :'ad', 'member'),
  ('00000000-0000-0000-0000-0000000000a2', :'ad', 'member');
update profiles set role = 'admin' where id = :'ad';
update activity_members set joined_at = now() - interval '1 day' where user_id = :'ad';
update activities set created_at = '2025-01-01';

-- Access ----------------------------------------------------------------------------------------
select tests.act_as(:'m1');
select lives_ok(format($q$insert into messages (activity_id, sender_id, body) values (%L, %L, 'Bonjour')$q$, '00000000-0000-0000-0000-0000000000a1', :'m1'), 'a member can write');
select tests.act_as(:'org');
select lives_ok(format($q$insert into messages (activity_id, sender_id, body) values (%L, %L, 'Salut a tous')$q$, '00000000-0000-0000-0000-0000000000a1', :'org'), 'the organiser can write');
select is(jsonb_array_length(public.chat_messages('00000000-0000-0000-0000-0000000000a1')->'messages'), 2, 'the organiser reads both messages');
select tests.act_as(:'m2');
select is(jsonb_array_length(public.chat_messages('00000000-0000-0000-0000-0000000000a1')->'messages'), 2, 'a member reads both messages');
select is((select count(*)::int from messages where activity_id = '00000000-0000-0000-0000-0000000000a1'), 2, 'a member selects directly');

select tests.act_as(:'pe');
select is(public.chat_messages('00000000-0000-0000-0000-0000000000a1'), null, 'pending requester: chat_messages is null');
select is((select count(*)::int from messages where activity_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'pending requester: direct select 0 rows');
select throws_ok(format($q$insert into messages (activity_id, sender_id, body) values (%L, %L, 'x')$q$, '00000000-0000-0000-0000-0000000000a1', :'pe'), '42501', null, 'pending requester cannot write');
select tests.act_as(:'re');
select is(public.chat_messages('00000000-0000-0000-0000-0000000000a1'), null, 'removed member: chat_messages is null');
select is((select count(*)::int from messages where activity_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'removed member: direct select 0 rows');
select throws_ok(format($q$insert into messages (activity_id, sender_id, body) values (%L, %L, 'x')$q$, '00000000-0000-0000-0000-0000000000a1', :'re'), '42501', null, 'removed member cannot write');
select tests.act_as(:'ou');
select is(public.chat_messages('00000000-0000-0000-0000-0000000000a1'), null, 'non-member: chat_messages is null');
select is((select count(*)::int from messages where activity_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'non-member: direct select 0 rows');
select throws_ok(format($q$insert into messages (activity_id, sender_id, body) values (%L, %L, 'x')$q$, '00000000-0000-0000-0000-0000000000a1', :'ou'), '42501', null, 'non-member cannot write');
select tests.act_as_anon();
select throws_ok($q$select count(*) from messages$q$, '42501', null, 'anon cannot read messages');
select throws_ok(format($q$insert into messages (activity_id, sender_id, body) values (%L, %L, 'x')$q$, '00000000-0000-0000-0000-0000000000a1', :'ou'), '42501', null, 'anon cannot write');
select throws_ok($q$select public.chat_messages('00000000-0000-0000-0000-0000000000a1')$q$, '42501', null, 'anon cannot call chat_messages');

-- Pinning and archive ---------------------------------------------------------------------------
select tests.act_as(:'m1');
insert into messages (activity_id, sender_id, body, created_at)
  values ('00000000-0000-0000-0000-0000000000a1', :'m2', 'Usurpe', '2020-01-01');
select tests.act_as_superuser();
select is((select sender_id from messages where body = 'Usurpe'), :'m1'::uuid, 'sender_id is pinned to the caller');
select is((select created_at from messages where body = 'Usurpe'), now(), 'created_at is pinned to now()');
insert into messages (activity_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000a2', :'m1', 'Ancien');
select tests.act_as(:'m1');
select throws_ok(format($q$insert into messages (activity_id, sender_id, body) values (%L, %L, 'x')$q$, '00000000-0000-0000-0000-0000000000a2', :'m1'), '42501', 'not_allowed', 'an archived chat refuses new messages');
select is((public.chat_messages('00000000-0000-0000-0000-0000000000a2')->>'archived')::boolean, true, 'an archived chat is still readable and flagged');
select is(jsonb_array_length(public.chat_messages('00000000-0000-0000-0000-0000000000a2')->'messages'), 1, 'the archived history is returned');
select is((public.chat_messages('00000000-0000-0000-0000-0000000000a1')->>'archived')::boolean, false, 'a live chat is not archived');

-- Rate limit ------------------------------------------------------------------------------------
select tests.act_as(:'rl');
select lives_ok(format($q$insert into messages (activity_id, sender_id, body) select %L, %L, 'r' || g from generate_series(1, 30) g$q$, '00000000-0000-0000-0000-0000000000a1', :'rl'), '30 messages in a minute succeed');
select throws_ok(format($q$insert into messages (activity_id, sender_id, body) values (%L, %L, 'r31')$q$, '00000000-0000-0000-0000-0000000000a1', :'rl'), '42501', 'limit_reached', 'the 31st raises limit_reached');

-- Idempotency -----------------------------------------------------------------------------------
select tests.act_as(:'m2');
select lives_ok(format($q$insert into messages (id, activity_id, sender_id, body) values (%L, %L, %L, 'Une fois')$q$, '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', :'m2'), 'first send with a client id works');
select throws_ok(format($q$insert into messages (id, activity_id, sender_id, body) values (%L, %L, %L, 'Une fois')$q$, '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', :'m2'), '23505', null, 'the same id twice raises 23505');
select is((select count(*)::int from messages where id = '00000000-0000-0000-0000-0000000000d1'), 1, 'only one row exists');

-- Deleting --------------------------------------------------------------------------------------
delete from messages where body = 'Bonjour';
select tests.act_as_superuser();
select is((select count(*)::int from messages where body = 'Bonjour'), 1, 'deleting another member''s message affects 0 rows');
select tests.act_as(:'m2');
delete from messages where id = '00000000-0000-0000-0000-0000000000d1';
select tests.act_as_superuser();
select is((select count(*)::int from messages where id = '00000000-0000-0000-0000-0000000000d1'), 0, 'you can delete your own message');

-- Blocks ----------------------------------------------------------------------------------------
insert into messages (activity_id, sender_id, body) values
  ('00000000-0000-0000-0000-0000000000a3', :'org', 'de org'),
  ('00000000-0000-0000-0000-0000000000a3', :'m1', 'de m1'),
  ('00000000-0000-0000-0000-0000000000a3', :'m2', 'de m2');
insert into blocks (blocker_id, blocked_id) values (:'m1', :'m2');
select tests.act_as(:'m1');
select is((select jsonb_agg(x->>'body' order by x->>'body') from jsonb_array_elements(public.chat_messages('00000000-0000-0000-0000-0000000000a3')->'messages') x), '["de m1","de org"]'::jsonb, 'the blocker no longer sees the blocked sender');
select tests.act_as(:'m2');
select is((select jsonb_agg(x->>'body' order by x->>'body') from jsonb_array_elements(public.chat_messages('00000000-0000-0000-0000-0000000000a3')->'messages') x), '["de m2","de org"]'::jsonb, 'the blocked person no longer sees the blocker');
select tests.act_as(:'org');
select is(jsonb_array_length(public.chat_messages('00000000-0000-0000-0000-0000000000a3')->'messages'), 3, 'a third party still sees everyone');

-- Paging ----------------------------------------------------------------------------------------
select tests.act_as_superuser();
insert into messages (activity_id, sender_id, body, created_at)
  select '00000000-0000-0000-0000-0000000000a4', :'sp', 'm' || n, '2026-01-01'::timestamptz + n * interval '1 second'
    from generate_series(1, 120) n;
select tests.act_as(:'sp');
select set_config('t.p1', public.chat_messages('00000000-0000-0000-0000-0000000000a4')::text, true);
select is(jsonb_array_length(current_setting('t.p1')::jsonb->'messages'), 50, 'the first page holds 50');
select is(current_setting('t.p1')::jsonb->'messages'->0->>'body', 'm120', 'the first page starts with the newest');
select is(current_setting('t.p1')::jsonb->'messages'->49->>'body', 'm71', 'the first page ends at m71');
select set_config('t.p2', public.chat_messages('00000000-0000-0000-0000-0000000000a4',
  (current_setting('t.p1')::jsonb->'messages'->49->>'created_at')::timestamptz, (current_setting('t.p1')::jsonb->'messages'->49->>'id')::uuid)::text, true);
select is(jsonb_array_length(current_setting('t.p2')::jsonb->'messages'), 50, 'the second page holds 50');
select is(current_setting('t.p2')::jsonb->'messages'->0->>'body', 'm70', 'no gap between the pages');
select is(current_setting('t.p2')::jsonb->'messages'->49->>'body', 'm21', 'no overlap, the second page ends at m21');
select is(jsonb_array_length(public.chat_messages('00000000-0000-0000-0000-0000000000a4', null, null, '2026-01-01 00:01:58+00', null)->'messages'), 2, 'p_after returns only newer messages');
select is(public.chat_messages('00000000-0000-0000-0000-0000000000a4', null, null, '2026-01-01 00:01:58+00', null)->'messages'->0->>'body', 'm120', 'p_after is newest first');
select is(jsonb_array_length(public.chat_messages('00000000-0000-0000-0000-0000000000a4', null, null, null, null, 500)->'messages'), 100, 'p_limit is capped at 100');
select is((public.chat_messages('00000000-0000-0000-0000-0000000000a4')->'messages'->0->>'is_mine')::boolean, true, 'is_mine is set on my messages');
select is(public.chat_messages('00000000-0000-0000-0000-0000000000a4')->'messages'->0->'sender'->>'first_name', 'Sam', 'the sender is described');

-- my_chats --------------------------------------------------------------------------------------
select tests.act_as(:'m1');
select is((select x->>'unread_count' from jsonb_array_elements(public.my_chats()) x where x->>'activity_id' = '00000000-0000-0000-0000-0000000000a1'), '31', 'unread counts the others'' messages, not mine');
-- Messages written in one transaction share created_at, so which of them is last is a tie broken by id.
select ok((select x->'last_message'->>'sender_first_name' from jsonb_array_elements(public.my_chats()) x where x->>'activity_id' = '00000000-0000-0000-0000-0000000000a1') is not null, 'the last message is described');
select tests.act_as(:'org');
select is((select x->>'unread_count' from jsonb_array_elements(public.my_chats()) x where x->>'activity_id' = '00000000-0000-0000-0000-0000000000a4'), '99', 'unread is capped at 99');
select tests.act_as(:'sp');
select is((select x->>'unread_count' from jsonb_array_elements(public.my_chats()) x where x->>'activity_id' = '00000000-0000-0000-0000-0000000000a4'), '0', 'own messages never count');
select tests.act_as(:'m1');
select lives_ok($q$select public.mark_chat_read('00000000-0000-0000-0000-0000000000a1')$q$, 'mark_chat_read works for a member');
select is((select x->>'unread_count' from jsonb_array_elements(public.my_chats()) x where x->>'activity_id' = '00000000-0000-0000-0000-0000000000a1'), '0', 'mark_chat_read resets the count');
select lives_ok($q$select public.set_chat_muted('00000000-0000-0000-0000-0000000000a1', true)$q$, 'a member can mute');
select is((select (x->>'muted')::boolean from jsonb_array_elements(public.my_chats()) x where x->>'activity_id' = '00000000-0000-0000-0000-0000000000a1'), true, 'a muted chat reports muted');
select is(jsonb_array_length(public.my_chats()), 3, 'm1 lists a1, a2 (archived with messages) and a3');
select is((select count(*)::int from chat_states), 1, 'a user reads only their own chat state');
select tests.act_as(:'ou');
select throws_ok($q$select public.mark_chat_read('00000000-0000-0000-0000-0000000000a1')$q$, '42501', null, 'a non-member cannot mark read');
select throws_ok($q$select public.set_chat_muted('00000000-0000-0000-0000-0000000000a1', true)$q$, '42501', null, 'a non-member cannot mute');
select is(jsonb_array_length(public.my_chats()), 0, 'a non-member has no chats');
select tests.act_as(:'org');
select is(jsonb_array_length(public.my_chats()), 7, 'the organiser lists all seven activities');
select tests.act_as_anon();
select throws_ok($q$select public.my_chats()$q$, '42501', null, 'anon cannot call my_chats');

-- Fix round ---------------------------------------------------------------------------------------
-- keyset paging with ties: 7 messages share one created_at, pages of 3
select tests.act_as_superuser();
insert into messages (activity_id, sender_id, body, created_at)
  select '00000000-0000-0000-0000-0000000000a6', :'sp', 't' || n, '2026-02-01' from generate_series(1, 7) n;
select tests.act_as(:'sp');
create temp table tie_ids (id uuid);
grant all on tie_ids to authenticated;
do $d$
declare
  v_page jsonb; v_at timestamptz; v_id uuid;
begin
  loop
    v_page := public.chat_messages('00000000-0000-0000-0000-0000000000a6', v_at, v_id, null, null, 3)->'messages';
    exit when jsonb_array_length(v_page) = 0;
    insert into tie_ids select (x->>'id')::uuid from jsonb_array_elements(v_page) x;
    v_at := (v_page->(jsonb_array_length(v_page) - 1)->>'created_at')::timestamptz;
    v_id := (v_page->(jsonb_array_length(v_page) - 1)->>'id')::uuid;
  end loop;
end $d$;
select is((select count(*)::int from tie_ids), 7, 'tied messages across page boundaries: none lost');
select is((select count(distinct id)::int from tie_ids), 7, 'tied messages across page boundaries: none duplicated');

-- unread floors at the join time
select tests.act_as_superuser();
insert into messages (activity_id, sender_id, body, created_at)
  select '00000000-0000-0000-0000-0000000000a7', :'org', 'old' || n, now() - interval '1 hour' from generate_series(1, 5) n;
select tests.act_as(:'nm');
select is((select x->>'unread_count' from jsonb_array_elements(public.my_chats()) x where x->>'activity_id' = '00000000-0000-0000-0000-0000000000a7'), '0', 'a member who joins after 5 messages has 0 unread');
select tests.act_as_superuser();
insert into messages (activity_id, sender_id, body, created_at) values ('00000000-0000-0000-0000-0000000000a7', :'org', 'neuf', now() + interval '1 minute');
select tests.act_as(:'nm');
select is((select x->>'unread_count' from jsonb_array_elements(public.my_chats()) x where x->>'activity_id' = '00000000-0000-0000-0000-0000000000a7'), '1', 'a new message after joining counts');
select tests.act_as(:'lf');
select public.set_chat_muted('00000000-0000-0000-0000-0000000000a7', true);
select is((select x->>'unread_count' from jsonb_array_elements(public.my_chats()) x where x->>'activity_id' = '00000000-0000-0000-0000-0000000000a7'), '1', 'a first mute leaves the unread count unchanged');
select is((select last_read_at > '-infinity' from chat_states where activity_id = '00000000-0000-0000-0000-0000000000a7'), true, 'a first mute never stores -infinity');
select is(public.export_my_data()->>'chat_states' like '%infinity%', false, 'the export never holds infinity');

-- chat_states cannot be written directly
select tests.act_as(:'m1');
select throws_ok(format($q$insert into chat_states (activity_id, user_id) values (%L, %L)$q$, '00000000-0000-0000-0000-0000000000a1', :'m1'), '42501', null, 'chat_states: no direct insert');
select throws_ok($q$update chat_states set muted = false$q$, '42501', null, 'chat_states: no direct update');
select throws_ok($q$delete from chat_states$q$, '42501', null, 'chat_states: no direct delete');
select throws_ok($q$update messages set body = 'hack'$q$, '42501', null, 'messages: no update at all');

-- blocked senders in my_chats (m1 blocked m2 in a3)
select isnt((select x->'last_message'->>'sender_first_name' from jsonb_array_elements(public.my_chats()) x where x->>'activity_id' = '00000000-0000-0000-0000-0000000000a3'), 'Marc', 'a blocked sender never shows as the last message');
select is((select x->>'unread_count' from jsonb_array_elements(public.my_chats()) x where x->>'activity_id' = '00000000-0000-0000-0000-0000000000a3'), '1', 'a blocked sender is not counted as unread');

-- removed and departed members
select tests.act_as(:'re');
select is(jsonb_array_length(public.my_chats()), 0, 'a removed member has no chats');
select tests.act_as_superuser();
delete from activity_members where activity_id = '00000000-0000-0000-0000-0000000000a7' and user_id = :'lf';
select tests.act_as(:'lf');
select is(jsonb_array_length(public.my_chats()), 0, 'a member who left has no chats');

-- guard ordering: a non-member gets not_allowed either way
select tests.act_as(:'ou');
select throws_ok(format($q$insert into messages (activity_id, sender_id, body) values (%L, %L, 'x')$q$, '00000000-0000-0000-0000-0000000000a2', :'ou'), '42501', 'not_allowed', 'non-member on an archived chat: not_allowed');
select throws_ok(format($q$insert into messages (activity_id, sender_id, body) values (%L, %L, 'x')$q$, '00000000-0000-0000-0000-0000000000a1', :'ou'), '42501', 'not_allowed', 'non-member on a live chat: not_allowed');

-- The limit survives deleting messages (insert-only log) --------------------------------------------
select tests.act_as(:'rl');
select lives_ok(format($q$delete from messages where sender_id = %L$q$, :'rl'), 'the sender deletes all their messages');
select throws_ok(format($q$insert into messages (activity_id, sender_id, body) values (%L, %L, 'apres')$q$, '00000000-0000-0000-0000-0000000000a1', :'rl'), '42501', 'limit_reached', 'the 31st is still refused after deleting the 30');
select throws_ok($q$select count(*) from chat_send_log$q$, '42501', null, 'the send log has no API access');
select tests.act_as_superuser();
insert into chat_send_log (user_id, sent_at) values (:'rl', now() - interval '2 hours'), (:'rl', now() - interval '10 minutes');
select public.prune_chat_send_log();
select is((select count(*)::int from chat_send_log where sent_at < now() - interval '1 hour'), 0, 'the hourly prune deletes log rows older than an hour');
select is((select count(*)::int from chat_send_log where user_id = :'rl' and sent_at = now() - interval '10 minutes'), 1, 'prune keeps recent log rows');

-- Admins: pinned and bound by membership and archive, exempt from the limit only ---------------------
select tests.act_as(:'ad');
insert into messages (activity_id, sender_id, body, created_at)
  values ('00000000-0000-0000-0000-0000000000a1', :'m2', 'Admin usurpe', '2020-01-01');
select tests.act_as_superuser();
select is((select sender_id from messages where body = 'Admin usurpe'), :'ad'::uuid, 'an admin''s sender_id is pinned');
select is((select created_at from messages where body = 'Admin usurpe'), now(), 'an admin''s created_at is pinned');
select tests.act_as(:'ad');
select throws_ok(format($q$insert into messages (activity_id, sender_id, body) values (%L, %L, 'x')$q$, '00000000-0000-0000-0000-0000000000a2', :'ad'), '42501', 'not_allowed', 'an admin cannot post in an archived chat');
select throws_ok(format($q$insert into messages (activity_id, sender_id, body) values (%L, %L, 'x')$q$, '00000000-0000-0000-0000-0000000000a3', :'ad'), '42501', 'not_allowed', 'an admin who is not a member cannot post');
select lives_ok(format($q$insert into messages (activity_id, sender_id, body) select %L, %L, 'adm' || g from generate_series(1, 31) g$q$, '00000000-0000-0000-0000-0000000000a1', :'ad'), 'an admin is exempt from the rate limit');

-- Result fields for the app -----------------------------------------------------------------------
select tests.act_as(:'m1');
select is(public.chat_messages('00000000-0000-0000-0000-0000000000a1')->>'title', 'Go du soir', 'chat_messages returns the title');
select is((public.chat_messages('00000000-0000-0000-0000-0000000000a1')->>'organiser_id')::uuid, :'org'::uuid, 'chat_messages returns the organiser');
select public.set_chat_muted('00000000-0000-0000-0000-0000000000a1', false);
select is((public.chat_messages('00000000-0000-0000-0000-0000000000a1')->>'muted')::boolean, false, 'chat_messages reports muted false');
select public.set_chat_muted('00000000-0000-0000-0000-0000000000a1', true);
select is((public.chat_messages('00000000-0000-0000-0000-0000000000a1')->>'muted')::boolean, true, 'chat_messages reports muted true after muting');
select public.set_chat_muted('00000000-0000-0000-0000-0000000000a1', false);
-- Which message is last is a tie within one transaction, so only the presence of the flag is checked.
select ok((select (c->'last_message') ? 'is_mine' from jsonb_array_elements(public.my_chats()) c where c->>'activity_id' = '00000000-0000-0000-0000-0000000000a1'), 'my_chats flags whether the last message is mine');
select ok(public.my_unread_total() > 0 and public.my_unread_total() = (select sum((c->>'unread_count')::int) from jsonb_array_elements(public.my_chats()) c), 'my_unread_total matches the per-chat counts');
select tests.act_as_anon();
select throws_ok($q$select public.my_unread_total()$q$, '42501', null, 'anon cannot call my_unread_total');

-- Retention -------------------------------------------------------------------------------------
select tests.act_as_superuser();
insert into messages (activity_id, sender_id, body, created_at) values
  ('00000000-0000-0000-0000-0000000000a5', :'org', 'vieux', now() - interval '13 months'),
  ('00000000-0000-0000-0000-0000000000a5', :'org', 'recent', now() - interval '11 months');
select is(public.prune_messages(), 1, 'prune_messages reports one deletion');
select is((select count(*)::int from messages where body = 'vieux'), 0, 'a 13-month-old message is pruned');
select is((select count(*)::int from messages where body = 'recent'), 1, 'an 11-month-old message is kept');
select throws_ok($q$set local role authenticated; select public.prune_messages()$q$, '42501', null, 'API roles cannot prune');
reset role;

-- Setup -----------------------------------------------------------------------------------------
select is((select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'), 1, 'messages is published to realtime');
select is((select count(*)::int from cron.job where jobname = 'prune-messages' and schedule = '10 4 * * *'), 1, 'the prune job is scheduled');
select is((select count(*)::int from cron.job where jobname = 'prune-chat-send-log' and schedule = '7 * * * *'), 1, 'the hourly send-log prune is scheduled');
select tests.act_as(:'m1');
select is(public.export_my_data() ? 'chat_states', true, 'the export contains chat_states');
select is(public.export_my_data() ? 'messages_sent' and public.export_my_data() ? 'collectifs_created', true, 'the export keeps earlier keys');
select * from finish();
rollback;
