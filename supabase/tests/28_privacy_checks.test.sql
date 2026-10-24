begin;
\ir helpers.inc
select plan(16);
select tests.create_user('aa@pc.fr', 'Alice') as alice \gset
select tests.create_user('bb@pc.fr', 'Bob') as bob \gset
select tests.create_user('ad@pc.fr', 'Admin') as adm \gset
update profiles set role = 'admin' where id = :'adm';

-- 1. No API path lists users.
select is((select string_agg(column_name, ',' order by column_name)
             from information_schema.column_privileges
            where table_schema = 'public' and table_name = 'public_profiles'
              and grantee = 'anon' and privilege_type = 'SELECT'),
          'bio,created_at,first_name,id,photo_url', 'anon sees exactly these public_profiles columns');
select is((select string_agg(column_name, ',' order by column_name)
             from information_schema.column_privileges
            where table_schema = 'public' and table_name = 'public_profiles'
              and grantee = 'authenticated' and privilege_type = 'SELECT'),
          'bio,created_at,first_name,id,photo_url', 'authenticated sees exactly these public_profiles columns');
select is((select string_agg(column_name, ',' order by column_name)
             from information_schema.column_privileges
            where table_schema = 'public' and table_name = 'profiles'
              and grantee = 'authenticated' and privilege_type = 'UPDATE'),
          'age_confirmed,bio,first_name,home_area,home_area_label,language,photo_url',
          'authenticated can update only these profiles columns (never role, banned_at, phone_verified)');
select ok(not exists (select 1 from information_schema.table_privileges
                       where table_schema = 'public' and table_name = 'profiles'
                         and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'DELETE', 'TRUNCATE')),
          'API roles cannot insert, delete or truncate profiles');
select ok(not exists (select 1 from information_schema.table_privileges
                       where table_schema = 'public' and table_name = 'public_profiles'
                         and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'),
          'public_profiles is read-only for API roles');

set local role anon;
select is((select count(*) from public.profiles)::int, 0, 'anon reads no row of profiles');
reset role;
select tests.act_as(:'alice');
select is((select count(*) from public.profiles)::int, 1, 'a signed-in user reads only their own profiles row');
select is((select id from public.profiles), :'alice'::uuid, 'and it is their own');
reset role;

-- 2. Admin rights need the second factor.
select tests.act_as_aal1(:'adm');
select ok(not public.is_admin(), 'is_admin() is false at aal1');
reset role;
select tests.act_as_admin(:'adm');
select ok(public.is_admin(), 'is_admin() is true at aal2 (control)');
reset role;

-- 3. The export covers every personal table.
-- Deliberately excluded: admin_audit_log (admin actions kept 3 years as accountability evidence, not data the
-- person provided), limit_log and chat_send_log (anti-abuse counters purged within a day, no content),
-- organiser_badges (a view derived from organiser_stats, which is exported).
create temp table export_excluded(table_name text primary key, reason text not null);
insert into export_excluded values
  ('admin_audit_log', 'admin accountability log, 3 years, not the data subject''s data'),
  ('limit_log', 'rate-limit counters purged daily, no content'),
  ('chat_send_log', 'rate-limit counters purged daily, no content');
select is((select coalesce(string_agg(t.table_name, ',' order by t.table_name), '')
             from (select distinct c.table_name
                     from information_schema.columns c
                     join information_schema.tables t using (table_schema, table_name)
                    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
                      and c.column_name in ('user_id', 'sender_id', 'claimant_id', 'reporter_id', 'blocker_id',
                                            'organiser_id', 'created_by', 'claimed_by')) t
            where t.table_name not in (select table_name from export_excluded)
              and position('public.' || t.table_name in pg_get_functiondef('public.export_my_data()'::regprocedure)) = 0),
          '', 'export_my_data reads every table that has a person column (except the documented exclusions)');
select ok((select bool_and(length(reason) > 10) from export_excluded), 'each exclusion has a reason');

-- the export returns a user's community club
insert into associations (name, source, confidence, city, location, created_by)
  values ('Club Alice', 'community', 50, 'Lyon', 'SRID=4326;POINT(4.85 45.77)', :'alice');
select tests.act_as(:'alice');
select is(jsonb_array_length(public.export_my_data() -> 'associations_added'), 1, 'the export lists the clubs the person added');
reset role;
select tests.act_as(:'bob');
select is(jsonb_array_length(public.export_my_data() -> 'associations_added'), 0, 'and nothing about other people''s clubs');
reset role;

-- 4. Home areas are stored as rounded commune-level points (0.01 degree grid, about 1 km), whatever the client sends.
update profiles set home_area = 'SRID=4326;POINT(4.8512345 45.7712345)' where id = :'alice';
select is((select ST_AsText(home_area::geometry) from profiles where id = :'alice'), 'POINT(4.85 45.77)',
          'a precise home area is snapped to the 0.01 degree grid');
select ok(not exists (select 1 from profiles where home_area is not null
                       and (round(ST_X(home_area::geometry)::numeric, 2) <> ST_X(home_area::geometry)::numeric
                         or round(ST_Y(home_area::geometry)::numeric, 2) <> ST_Y(home_area::geometry)::numeric)),
          'no stored home area is more precise than the grid');
select * from finish();
rollback;
