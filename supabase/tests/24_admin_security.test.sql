begin;
\ir helpers.inc
select plan(47);
select tests.create_user('adm@as.fr', 'Admin') as adm \gset
select tests.create_user('usr@as.fr', 'Ugo') as usr \gset
select tests.create_user('bad@as.fr', 'Bad') as bad \gset
select tests.create_user('nxt@as.fr', 'Next') as nxt \gset
update profiles set role = 'admin' where id = :'adm';
update profiles set age_confirmed = true, created_at = now() - interval '2 days';
insert into categories (id, slug, name_fr, name_en, icon) values ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, max_size) values
  ('00000000-0000-0000-0000-0000000000a1', :'bad', '00000000-0000-0000-0000-0000000000c1', 'Go du mechant', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', 10);
insert into reports (reporter_id, target_type, target_id, reason) values (:'usr', 'user', :'bad', 'other');
insert into collectifs (id, name, town_label, town_point, created_by) values ('00000000-0000-0000-0000-00000000c0a1', 'Les Mechants', 'Lyon', 'POINT(4.85 45.77)', :'bad');
insert into collectif_members (collectif_id, user_id, role, status, accepted_at) values ('00000000-0000-0000-0000-00000000c0a1', :'nxt', 'organiser', 'active', now());
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, max_size) values
  ('00000000-0000-0000-0000-0000000000a2', :'usr', '00000000-0000-0000-0000-0000000000c1', 'Go de Ugo', 'Cafe', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '19:00', 10);
insert into activity_members (activity_id, user_id, status) values ('00000000-0000-0000-0000-0000000000a2', :'bad', 'pending');
update activity_members set status = 'member' where user_id = :'bad';
insert into sessions (activity_id, starts_at) select '00000000-0000-0000-0000-0000000000a2', now() + interval '3 days' where not exists (select 1 from sessions where activity_id = '00000000-0000-0000-0000-0000000000a2' and starts_at > now());
insert into attendances (session_id, user_id, status) select id, :'bad', 'confirmed' from sessions where activity_id = '00000000-0000-0000-0000-0000000000a2' and starts_at > now() limit 1;
insert into messages (activity_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000a2', :'bad', 'Message du banni'), ('00000000-0000-0000-0000-0000000000a2', :'usr', 'Message de Ugo');
insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), :'bad', now(), now());
insert into auth.refresh_tokens (instance_id, token, user_id, revoked, created_at, updated_at) values ('00000000-0000-0000-0000-000000000000', 'tok-bad', :'bad', false, now(), now());
select is((select count(*) from attendances where user_id = :'bad')::int, 1, 'setup: banned-to-be has a future attendance');

-- the 2FA rule
select tests.act_as_aal1(:'adm');
select is(public.is_admin(), false, 'admin with aal1 is not admin');
select is((select count(*) from reports)::int, 0, 'admin with aal1 cannot read reports');
select tests.act_as(:'adm');
select is(public.is_admin(), false, 'admin with no aal claim is not admin');
select tests.act_as_admin(:'adm');
select is(public.is_admin(), true, 'admin with aal2 is admin');
select is((select count(*) from reports)::int, 1, 'admin with aal2 reads reports');
select tests.act_as_admin(:'usr');
select is(public.is_admin(), false, 'non-admin with aal2 is not admin');
select tests.act_as_anon();
select is(public.is_admin(), false, 'anon is not admin');

-- audit log
select tests.act_as_superuser();
select has_table('public', 'admin_audit_log', 'audit table exists');
select is((select relrowsecurity from pg_class where oid = 'public.admin_audit_log'::regclass), true, 'audit RLS on');
insert into admin_audit_log (admin_id, action, target_type, target_id, created_at) values
  (:'adm', 'old_action', 'user', :'bad', now() - interval '2 days'),
  (:'adm', 'new_action', 'user', :'bad', now() - interval '1 day');
select tests.act_as_admin(:'adm');
select throws_ok($$ select * from admin_audit_log $$, '42501', null, 'admin cannot select audit');
select throws_ok($$ insert into admin_audit_log (action) values ('x') $$, '42501', null, 'admin cannot insert audit');
select throws_ok($$ update admin_audit_log set action = 'x' $$, '42501', null, 'admin cannot update audit');
select throws_ok($$ delete from admin_audit_log $$, '42501', null, 'admin cannot delete audit');
select tests.act_as(:'usr');
select throws_ok($$ select * from admin_audit_log $$, '42501', null, 'user cannot select audit');
select tests.act_as_aal1(:'adm');
select throws_ok($$ select admin_audit_page() $$, '42501', 'not_allowed', 'audit page refuses aal1');
select tests.act_as_admin(:'usr');
select throws_ok($$ select admin_audit_page() $$, '42501', 'not_allowed', 'audit page refuses non-admin');
select tests.act_as_admin(:'adm');
select is(admin_audit_page() #>> '{items,0,action}', 'new_action', 'audit page newest first');
select is(jsonb_array_length(admin_audit_page(now() - interval '36 hours', null)->'items'), 1, 'audit page before filter');

-- internal functions
select tests.act_as(:'usr');
select throws_ok(format($q$ select admin_log('x', 'user', %L) $q$, :'bad'), '42501', null, 'authenticated cannot admin_log');
select throws_ok(format($q$ select ban_user(%L, 'x') $q$, :'bad'), '42501', null, 'authenticated cannot ban_user');
select tests.act_as_admin(:'adm');
select throws_ok(format($q$ select ban_user(%L, 'x') $q$, :'bad'), '42501', null, 'admin cannot call ban_user directly');
select tests.act_as_anon();
select throws_ok($$ select admin_log('x', 'user', null) $$, '42501', null, 'anon cannot admin_log');
select throws_ok(format($q$ select ban_user(%L, 'x') $q$, :'bad'), '42501', null, 'anon cannot ban_user');

-- ban
select tests.act_as_superuser();
select lives_ok(format($q$ select public.ban_user(%L, 'abus') $q$, :'bad'), 'ban_user runs');
select ok((select banned_until is not null and banned_until <> 'infinity'::timestamptz and banned_until > now() + interval '50 years' from auth.users where id = :'bad'), 'banned_until is finite and more than 50 years away');
select ok((select banned_at is not null from profiles where id = :'bad'), 'banned_at set');
select ok((select archived_at is not null from activities where id = '00000000-0000-0000-0000-0000000000a1'), 'activities archived');
select is((select user_id from collectif_members where collectif_id = '00000000-0000-0000-0000-00000000c0a1' and role = 'responsable'), :'nxt'::uuid, 'next organiser promoted; banned user removed');
create temp table snap as select (select banned_at from profiles where id = :'bad') b, (select archived_at from activities where id = '00000000-0000-0000-0000-0000000000a1') a;
select public.ban_user(:'bad', 'abus');
select ok((select b = (select banned_at from profiles where id = :'bad') and a = (select archived_at from activities where id = '00000000-0000-0000-0000-0000000000a1') from snap), 'ban is idempotent');

-- banned person's content
select is((select count(*) from auth.sessions where user_id = :'bad')::int, 1, 'sessions kept (Auth refuses the refresh itself)');
select is((select count(*) from auth.refresh_tokens where user_id = :'bad'::text)::int, 1, 'refresh tokens kept');
select is((select count(*) from activity_members where user_id = :'bad')::int, 0, 'memberships deleted');
select is((select count(*) from attendances where user_id = :'bad')::int, 0, 'future attendance deleted');
select is((select count(*) from messages where sender_id = :'bad')::int, 1, 'banned message row still exists');
select tests.act_as(:'usr');
select is((select count(*) from messages where sender_id = :'bad')::int, 0, 'banned message hidden by select');
select is(jsonb_array_length(public.chat_messages('00000000-0000-0000-0000-0000000000a2')->'messages'), 1, 'chat_messages hides banned sender');
select is((select (c->'last_message'->>'body') from jsonb_array_elements(public.my_chats()) c where c->>'activity_id' = '00000000-0000-0000-0000-0000000000a2'), 'Message de Ugo', 'my_chats last message skips banned');
select is(public.my_unread_total(), 0, 'my_unread_total ignores banned');
select is((select count(*) from public.activity_roster('00000000-0000-0000-0000-0000000000a2'))::int, 0, 'banned absent from roster');
select tests.act_as_superuser();

-- paging with ties
insert into admin_audit_log (id, admin_id, action, created_at) values
  ('00000000-0000-0000-0000-00000000f001', :'adm', 'tie', '2020-01-01'),
  ('00000000-0000-0000-0000-00000000f002', :'adm', 'tie', '2020-01-01'),
  ('00000000-0000-0000-0000-00000000f003', :'adm', 'tie', '2020-01-01');
select tests.act_as_admin(:'adm');
select is((select string_agg(i->>'id', ',') from jsonb_array_elements(
  public.admin_audit_page('2020-01-01', '00000000-0000-0000-0000-00000000f003', 10)->'items') i
  where i->>'action' = 'tie'), '00000000-0000-0000-0000-00000000f002,00000000-0000-0000-0000-00000000f001', 'tie paging keeps rows');
select is(jsonb_array_length(public.admin_audit_page(null, null, 0)->'items'), 1, 'limit 0 clamps to 1');
select is(jsonb_array_length(public.admin_audit_page(null, null, null)->'items') > 1, true, 'null limit defaults');
select tests.act_as_superuser();
insert into admin_audit_log (admin_id, action) select :'adm', 'bulk' from generate_series(1, 210);
select tests.act_as_admin(:'adm');
select is(jsonb_array_length(public.admin_audit_page(null, null, 500)->'items'), 200, 'limit 500 clamps to 200');
select tests.act_as_superuser();
select is(public.is_banned(:'bad'), true, 'is_banned true (for security definer code)');
select tests.act_as_aal1(:'usr');
select throws_ok(format($q$ select is_banned(%L) $q$, :'bad'), '42501', null, 'authenticated cannot is_banned (migration 37)');
select tests.act_as_anon();
select throws_ok(format($q$ select is_banned(%L) $q$, :'bad'), '42501', null, 'anon cannot is_banned');
select * from finish();
rollback;
