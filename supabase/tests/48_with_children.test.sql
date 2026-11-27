-- Activities with children: the flag, forced approval, and the photo and 7-day account rule.
begin;
\ir helpers.inc
select plan(23);

select tests.create_user('org@wc.fr', 'Olivier') as org \gset
select tests.create_user('new@wc.fr', 'Nina') as newbie \gset
select tests.create_user('nop@wc.fr', 'Noé') as nophoto \gset
select tests.create_user('ok@wc.fr', 'Oscar') as ok \gset
select tests.create_user('none@wc.fr', 'Nadia') as neither \gset
select tests.create_user('adm@wc.fr', 'Ada') as adm \gset
update profiles set age_confirmed = true, created_at = now() - interval '10 days';
update profiles set created_at = now() - interval '2 days' where id in (:'newbie', :'neither');
update profiles set photo_url = id::text || '/' || md5(id::text) || '.jpg' where id in (:'org', :'newbie', :'ok', :'adm');
update profiles set role = 'admin' where id = :'adm';
insert into categories (id, slug, name_fr, name_en, icon) values
  ('00000000-0000-0000-0000-0000000000c1', 'go', 'Jeu de go', 'Go', 'grid-3x3');
select id as fam from categories where slug = 'family-sorties-parents-enfants' \gset
select id as family_root from categories where slug = 'family' \gset

select has_column('public', 'activities', 'with_children', 'activities.with_children exists');

-- The Parents tree forces the flag and approval.
select tests.act_as(:'org');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, approval_mode, with_children)
values ('00000000-0000-0000-0000-0000000000f1', :'org', :'fam', 'Sortie au parc', 'Parc', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '10:00', 'open', false);
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, approval_mode, with_children)
values ('00000000-0000-0000-0000-0000000000f2', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go des familles', 'Parc', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '10:00', 'open', true);
select tests.act_as_superuser();
select is((select with_children from activities where id = '00000000-0000-0000-0000-0000000000f1'), true, 'a Parents activity is with children');
select is((select approval_mode from activities where id = '00000000-0000-0000-0000-0000000000f1'), 'approval', 'a Parents activity needs approval');
select is((select approval_mode from activities where id = '00000000-0000-0000-0000-0000000000f2'), 'approval', 'an activity marked with children needs approval');

select tests.act_as(:'org');
update activities set with_children = false where id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2');
select tests.act_as_superuser();
select is((select with_children from activities where id = '00000000-0000-0000-0000-0000000000f1'), true, 'the flag cannot be removed inside the Parents tree');
select is((select with_children from activities where id = '00000000-0000-0000-0000-0000000000f2'), false, 'the flag can be removed outside the Parents tree');

-- An open activity with a member moved into the Parents category.
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time, approval_mode)
values ('00000000-0000-0000-0000-0000000000f3', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go ouvert', 'Parc', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '10:00', 'open'),
       ('00000000-0000-0000-0000-0000000000f4', :'org', '00000000-0000-0000-0000-0000000000c1', 'Go libre', 'Parc', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '11:00', 'open');
insert into activity_members (activity_id, user_id, status) values ('00000000-0000-0000-0000-0000000000f3', :'ok', 'member');
select tests.act_as(:'org');
update activities set category_id = :'family_root' where id = '00000000-0000-0000-0000-0000000000f3';
select tests.act_as_superuser();
select is((select with_children from activities where id = '00000000-0000-0000-0000-0000000000f3'), true, 'moving into the Parents category sets the flag');
select is((select approval_mode from activities where id = '00000000-0000-0000-0000-0000000000f3'), 'approval', 'moving into the Parents category switches approval on');
select is((select status from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f3' and user_id = :'ok'), 'member', 'existing members stay');

-- Organising needs a photo and a 7-day account.
select tests.act_as(:'newbie');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
  values (auth.uid(), (select id from categories where slug = 'family-sorties-parents-enfants'), 'Sortie', 'Parc', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '10:00') $$,
  '42501', 'children_requirements_not_met', 'an account under 7 days cannot organise with children');
select tests.act_as(:'nophoto');
select throws_ok($$ insert into activities (organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
  values (auth.uid(), (select id from categories where slug = 'family-sorties-parents-enfants'), 'Sortie', 'Parc', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '10:00') $$,
  '42501', 'children_requirements_not_met', 'an account without a photo cannot organise with children');
insert into activities (id, organiser_id, category_id, title, place_label, place, recurrence_kind, start_date, start_time)
values ('00000000-0000-0000-0000-0000000000f5', :'nophoto', '00000000-0000-0000-0000-0000000000c1', 'Go de Noé', 'Parc', 'POINT(4.85 45.77)', 'weekly', current_date + 2, '10:00');
select throws_ok($$ update activities set with_children = true where id = '00000000-0000-0000-0000-0000000000f5' $$,
  '42501', 'children_requirements_not_met', 'an account without a photo cannot mark an activity with children');
select tests.act_as_admin(:'adm');
update activities set with_children = true where id = '00000000-0000-0000-0000-0000000000f5';
select tests.act_as(:'nophoto');
select lives_ok($$ update activities set title = 'Go de Noé et Lou' where id = '00000000-0000-0000-0000-0000000000f5' $$,
  'an ordinary edit of an activity already with children is not refused');

-- Joining needs the same.
select tests.act_as(:'ok');
insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', auth.uid());
select tests.act_as_superuser();
select is((select status from activity_members where activity_id = '00000000-0000-0000-0000-0000000000f1' and user_id = :'ok'), 'pending', 'joining an activity with children is a request');
select tests.act_as(:'newbie');
select throws_ok($$ insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', auth.uid()) $$,
  '42501', 'children_requirements_not_met', 'an account under 7 days cannot ask to join');
select tests.act_as(:'nophoto');
select throws_ok($$ insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', auth.uid()) $$,
  '42501', 'children_requirements_not_met', 'an account without a photo cannot ask to join');
select tests.act_as(:'newbie');
select lives_ok($$ insert into activity_members (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000f4', auth.uid()) $$,
  'activities without children are unchanged');

-- What is missing, for the caller.
select tests.act_as(:'nophoto');
select is(public.children_requirements_missing(), '{photo}'::text[], 'missing: photo');
select tests.act_as(:'newbie');
select is(public.children_requirements_missing(), '{account_age}'::text[], 'missing: account age');
select tests.act_as(:'neither');
select is(public.children_requirements_missing(), '{photo,account_age}'::text[], 'missing: both, in order');
select tests.act_as(:'ok');
select is(public.children_requirements_missing(), '{}'::text[], 'nothing missing');
select tests.act_as_admin(:'adm');
select is(public.children_requirements_missing(), '{}'::text[], 'admins are exempt');
select tests.act_as_superuser();
select is(has_function_privilege('anon', 'public.children_requirements_missing()', 'execute'), false, 'anon cannot call it');

select * from finish();
rollback;
