begin;
\ir helpers.inc
select plan(9);

-- Facts the threat model (docs/security/threat-model.md) relies on. A change here needs a new review.

-- TM-5: Realtime only carries chat messages, and a deleted message's event carries its id only
-- (Realtime does not apply row policies to DELETE events).
select is((select string_agg(schemaname || '.' || tablename, ',' order by tablename)::text
             from pg_publication_tables where pubname = 'supabase_realtime'),
  'public.messages', 'only public.messages is published to Realtime');
select is((select relreplident from pg_class where oid = 'public.messages'::regclass), 'd'::"char",
  'messages keeps the default replica identity (DELETE events carry the id only)');
select ok((select relrowsecurity from pg_class where oid = 'public.messages'::regclass),
  'messages has row-level security, which Realtime applies to INSERT events');

-- TM-1: the only tables a signed-out visitor has a policy on.
select is((select string_agg(distinct tablename::text, ',' order by tablename::text) from pg_policies
             where schemaname = 'public' and roles && '{anon,public}'::name[]),
  'activities,activity_tags,ambiance_words,association_tags,associations,categories,collectifs,sessions,tags',
  'signed-out visitors have policies on public catalogue tables only');

-- TM-3: the columns a signed-out visitor can read. A new column must be added here on purpose.
select is((select string_agg(column_name::text, ',' order by column_name::text) from information_schema.column_privileges
             where table_schema = 'public' and table_name = 'activities' and grantee = 'anon' and privilege_type = 'SELECT'),
  ('approval_mode,archived_at,category_id,chat_history,created_at,description,duration_minutes,id,max_size,'
        || 'min_participants,newcomer_friendly,organised_by_association_id,organised_by_collectif_id,place,'
        || 'place_label,published_at,recurrence_interval_days,recurrence_kind,recurrence_weekdays,'
        || 'removed_by_moderation_at,search_tsv,start_date,start_time,timezone,title'),
  'anon reads only the listed activity columns (no organiser, welcome member or embedding)');
select is((select string_agg(column_name::text, ',' order by column_name::text) from information_schema.column_privileges
             where table_schema = 'public' and table_name = 'collectifs' and grantee = 'anon' and privilege_type = 'SELECT'),
  ('created_at,description,id,name,search_tsv,town_label,town_point'),
  'anon reads only the listed collectif columns (no creator or embedding)');

-- TM-12: nobody but the person (or an admin) reads a home location.
select tests.create_user('tm-ana@example.test', 'Ana') as ana \gset
select tests.create_user('tm-bob@example.test', 'Bob') as bob \gset
update profiles set home_area = 'SRID=4326;POINT(4.83574 45.76402)' where id = :'ana';
select tests.act_as(:'bob');
select is((select count(*) from profiles where id = :'ana')::int, 0, 'another user cannot read a profile row');
select tests.act_as_anon();
select is((select count(*) from profiles)::int, 0, 'signed-out visitors read no profile');
select tests.act_as(:'ana');
select isnt((select home_area from profiles where id = :'ana'), null, 'the person reads their own home area');

select * from finish();
rollback;
