begin;
\ir helpers.inc
select plan(29);
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
select is(jsonb_array_length(admin_audit_page(now() - interval '36 hours')->'items'), 1, 'audit page before filter');

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
select is((select banned_until from auth.users where id = :'bad'), 'infinity'::timestamptz, 'banned_until infinity');
select ok((select banned_at is not null from profiles where id = :'bad'), 'banned_at set');
select ok((select archived_at is not null from activities where id = '00000000-0000-0000-0000-0000000000a1'), 'activities archived');
select is((select user_id from collectif_members where collectif_id = '00000000-0000-0000-0000-00000000c0a1' and role = 'responsable'), :'nxt'::uuid, 'next organiser promoted; banned user removed');
create temp table snap as select (select banned_at from profiles where id = :'bad') b, (select archived_at from activities where id = '00000000-0000-0000-0000-0000000000a1') a;
select public.ban_user(:'bad', 'abus');
select ok((select b = (select banned_at from profiles where id = :'bad') and a = (select archived_at from activities where id = '00000000-0000-0000-0000-0000000000a1') from snap), 'ban is idempotent');
select * from finish();
rollback;
