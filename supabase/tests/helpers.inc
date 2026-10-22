-- pgTAP is a test-only dependency: installed per test transaction, never by a migration.
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

create or replace function tests.create_user(
  p_email text,
  p_first_name text default 'Test',
  p_phone_verified boolean default false
) returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, '', '{}'::jsonb, jsonb_build_object('first_name', p_first_name), now(), now()
  );
  update public.profiles set phone_verified = p_phone_verified where id = v_id;
  return v_id;
end $$;

create or replace function tests.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

create or replace function tests.act_as_anon() returns void language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;

create or replace function tests.act_as_superuser() returns void language plpgsql as $$
begin
  reset role;
end $$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;
