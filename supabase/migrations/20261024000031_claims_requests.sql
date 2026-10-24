-- Claims, community clubs, category requests, feedback and the collectif link.
-- Every admin RPC is security definer, refuses unless is_admin() (a two-factor session) and is audited.

-- ---------------------------------------------------------------------------------------------
-- Associations: review and removal state.
alter table public.associations
  add column reviewed_at timestamptz,
  add column removed_at timestamptz;

-- ---------------------------------------------------------------------------------------------
-- Claims
alter table public.association_claims
  add column role_in_association text not null default 'Non précisé',
  add column contact_email text,
  add column document_path text,
  add column admin_note text,
  add column decided_at timestamptz;
alter table public.association_claims alter column role_in_association drop default;
alter table public.association_claims
  add constraint association_claims_role_len check (char_length(role_in_association) between 2 and 80),
  add constraint association_claims_email_shape check (contact_email is null
    or (char_length(contact_email) <= 254 and contact_email ~ '^[^@\s]+@[^@\s]+$')),
  add constraint association_claims_path_shape check (document_path is null
    or document_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,100}$'),
  -- not valid: claims filed before this migration (none in production) keep their old shape
  add constraint association_claims_proof check (contact_email is not null or document_path is not null) not valid;

drop policy claims_insert on public.association_claims;
create policy claims_insert on public.association_claims for insert to authenticated
  with check (claimant_id = auth.uid() and status = 'pending'
    and admin_note is null and decided_at is null
    and (document_path is null or (storage.foldername(document_path))[1] = auth.uid()::text));

-- The admin note is for admins only (they read it through the RPCs).
revoke select on public.association_claims from authenticated;
grant select (id, association_id, claimant_id, proof_method, status, created_at, role_in_association,
              contact_email, document_path, decided_at)
  on public.association_claims to authenticated;

-- One pending claim per person and association (a decided claim does not block a new one).
create unique index association_claims_one_pending on public.association_claims (association_id, claimant_id)
  where status = 'pending';

create function public.association_claims_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('role', true) in ('anon', 'authenticated') then
    if not exists (select 1 from public.associations a where a.id = new.association_id and a.removed_at is null) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    perform public.take_limit('claim', 3, interval '1 day');
  end if;
  return new;
end $$;
revoke all on function public.association_claims_limit() from public, anon, authenticated;
create trigger association_claims_limit before insert on public.association_claims
  for each row execute function public.association_claims_limit();

-- Private buckets: owners upload into their own folder; only admins read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('claim-documents', 'claim-documents', false, 10485760, '{application/pdf,image/jpeg,image/png}')
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-screenshots', 'feedback-screenshots', false, 5242880, '{image/jpeg,image/png,image/webp}')
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy claim_documents_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'claim-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy claim_documents_select_admin on storage.objects for select to authenticated
  using (bucket_id = 'claim-documents' and public.is_admin());
create policy feedback_screenshots_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'feedback-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy feedback_screenshots_select_admin on storage.objects for select to authenticated
  using (bucket_id = 'feedback-screenshots' and public.is_admin());

create function public.admin_claims(
  p_status text default 'pending', p_before_at timestamptz default null, p_before_id uuid default null,
  p_limit int default 50
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.created_at desc, x.id desc)
      from (
        select c.id, c.created_at, jsonb_build_object(
            'id', c.id, 'created_at', c.created_at, 'status', c.status,
            'association', jsonb_build_object('id', a.id, 'name', a.name, 'city', a.city),
            'claimant_first_name', (select p.first_name from public.profiles p where p.id = c.claimant_id),
            'role', c.role_in_association, 'contact_email', c.contact_email,
            'has_document', c.document_path is not null) as j
          from public.association_claims c
          join public.associations a on a.id = c.association_id
         where (p_status = 'all' or c.status = p_status)
           and (p_before_at is null or (c.created_at, c.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
         order by c.created_at desc, c.id desc
         limit greatest(1, least(coalesce(p_limit, 50), 100))) x), '[]'::jsonb);
end $$;
revoke all on function public.admin_claims(text, timestamptz, uuid, int) from public, anon;
grant execute on function public.admin_claims(text, timestamptz, uuid, int) to authenticated;

-- The admin client signs the path itself (storage.createSignedUrl(path, 300)); asking is audited.
create function public.admin_claim_document_path(p_claim uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_path text;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select c.document_path into v_path from public.association_claims c where c.id = p_claim;
  if v_path is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.admin_log('claim_document_viewed', 'claim', p_claim, '{}'::jsonb);
  return v_path;
end $$;
revoke all on function public.admin_claim_document_path(uuid) from public, anon;
grant execute on function public.admin_claim_document_path(uuid) to authenticated;

create function public.admin_decide_claim(p_claim uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.association_claims;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  o record;
  v_displaced int := 0;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_approve is null or char_length(coalesce(v_note, '')) > 1000 then
    raise exception 'invalid_decision' using errcode = '23514';
  end if;
  select * into c from public.association_claims where id = p_claim for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if c.status <> 'pending' then
    raise exception 'already_decided' using errcode = '42501';
  end if;
  if p_approve then
    if not exists (select 1 from public.associations a where a.id = c.association_id and a.removed_at is null) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    update public.associations set claimed_by = c.claimant_id, verified = true where id = c.association_id;
    update public.association_claims set status = 'approved', admin_note = v_note, decided_at = now() where id = p_claim;
    for o in
      update public.association_claims set status = 'rejected', decided_at = now(), admin_note = 'superseded'
       where association_id = c.association_id and status = 'pending' and id <> p_claim
      returning id, claimant_id
    loop
      v_displaced := v_displaced + 1;
      perform public.notify_user(o.claimant_id, 'claim_decided', 'Demande traitée',
        'Ouvrez l''application pour voir le détail.', 'Request handled', 'Open the app to see the details.',
        jsonb_build_object('kind', 'claim_decided', 'claim_id', o.id), 'claim_decided:' || o.id);
    end loop;
  else
    update public.association_claims set status = 'rejected', admin_note = v_note, decided_at = now() where id = p_claim;
  end if;
  perform public.notify_user(c.claimant_id, 'claim_decided', 'Demande traitée',
    'Ouvrez l''application pour voir le détail.', 'Request handled', 'Open the app to see the details.',
    jsonb_build_object('kind', 'claim_decided', 'claim_id', p_claim), 'claim_decided:' || p_claim);
  perform public.admin_log('claim_decision', 'claim', p_claim,
    jsonb_build_object('approved', p_approve, 'association_id', c.association_id, 'displaced', v_displaced));
end $$;
revoke all on function public.admin_decide_claim(uuid, boolean, text) from public, anon;
grant execute on function public.admin_decide_claim(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Community clubs
create function public.admin_community_clubs(
  p_before_at timestamptz default null, p_before_id uuid default null, p_limit int default 50
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.created_at desc, x.id desc)
      from (
        select a.id, a.created_at, jsonb_build_object(
            'id', a.id, 'name', a.name, 'city', a.city, 'purpose', a.purpose, 'created_at', a.created_at,
            'created_by_first_name', (select p.first_name from public.profiles p where p.id = a.created_by),
            'activity_count', (select count(*)::int from public.activities x where x.organised_by_association_id = a.id)) as j
          from public.associations a
         where a.source = 'community' and a.reviewed_at is null and a.removed_at is null
           and (p_before_at is null or (a.created_at, a.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
         order by a.created_at desc, a.id desc
         limit greatest(1, least(coalesce(p_limit, 50), 100))) x), '[]'::jsonb);
end $$;
revoke all on function public.admin_community_clubs(timestamptz, uuid, int) from public, anon;
grant execute on function public.admin_community_clubs(timestamptz, uuid, int) to authenticated;

create function public.admin_decide_club(
  p_id uuid, p_action text, p_into uuid default null, p_note text default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_moved int := 0;
  v_claimed uuid;
  v_report uuid;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('approve', 'merge', 'reject') then
    raise exception 'invalid_decision' using errcode = '23514';
  end if;
  select a.claimed_by into v_claimed from public.associations a
   where a.id = p_id and a.source = 'community' and a.removed_at is null for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- A club someone owns is no longer a raw community addition: it goes through a report instead.
  if p_action <> 'approve' and v_claimed is not null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_action = 'approve' then
    update public.associations set reviewed_at = coalesce(reviewed_at, now()) where id = p_id;
  elsif p_action = 'reject' then
    -- Open reports on the club are closed as a removal, with the admin's note as the statement and
    -- the same notices as any report decision (admin_decide_report closes every open report on it).
    select r.id into v_report from public.reports r
     where r.target_type = 'association' and r.target_id = p_id and r.status = 'open'
     order by r.created_at, r.id limit 1;
    if v_report is not null then
      perform public.admin_decide_report(v_report, 'remove', p_note);
    end if;
    update public.associations set removed_at = coalesce(removed_at, now()) where id = p_id;
  else
    if p_into is null or p_into = p_id
       or not exists (select 1 from public.associations a where a.id = p_into and a.removed_at is null) then
      raise exception 'invalid_target' using errcode = '23514';
    end if;
    update public.activities set organised_by_association_id = p_into where organised_by_association_id = p_id;
    get diagnostics v_moved = row_count;
    update public.association_claims c set association_id = p_into
     where c.association_id = p_id and c.status = 'pending'
       and not exists (select 1 from public.association_claims d
                        where d.association_id = p_into and d.claimant_id = c.claimant_id and d.status = 'pending');
    insert into public.association_waiters (association_id, user_id)
      select p_into, w.user_id from public.association_waiters w where w.association_id = p_id
      on conflict do nothing;
    insert into public.association_tags (association_id, tag_id)
      select p_into, t.tag_id from public.association_tags t where t.association_id = p_id
      on conflict do nothing;
    update public.reports set target_id = p_into, target_owner = public.report_target_owner('association', p_into)
     where target_type = 'association' and target_id = p_id and status = 'open';
    delete from public.associations where id = p_id;
  end if;
  perform public.admin_log('club_decision', 'association', p_id,
    jsonb_build_object('action', p_action, 'into', p_into, 'activities_moved', v_moved));
end $$;
revoke all on function public.admin_decide_club(uuid, text, uuid, text) from public, anon;
grant execute on function public.admin_decide_club(uuid, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Category requests
alter table public.category_requests add column decided_at timestamptz;

create function public.admin_category_requests(
  p_before_at timestamptz default null, p_before_id uuid default null, p_limit int default 50
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.created_at desc, x.id desc)
      from (
        select r.id, r.created_at, jsonb_build_object(
            'id', r.id, 'requested_name', r.requested_name, 'created_at', r.created_at,
            'requester_first_name', (select p.first_name from public.profiles p where p.id = r.user_id)) as j
          from public.category_requests r
         where r.status = 'pending'
           and (p_before_at is null or (r.created_at, r.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
         order by r.created_at desc, r.id desc
         limit greatest(1, least(coalesce(p_limit, 50), 100))) x), '[]'::jsonb);
end $$;
revoke all on function public.admin_category_requests(timestamptz, uuid, int) from public, anon;
grant execute on function public.admin_category_requests(timestamptz, uuid, int) to authenticated;

create function public.admin_decide_category(
  p_id uuid, p_action text, p_parent uuid default null, p_name_en text default null,
  p_into uuid default null, p_note text default null
) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  r public.category_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_name_en text := btrim(coalesce(p_name_en, ''));
  v_slug text;
  v_base text;
  v_n int := 1;
  v_icon text;
  v_category uuid;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('approve', 'merge', 'reject') or char_length(coalesce(v_note, '')) > 1000 then
    raise exception 'invalid_decision' using errcode = '23514';
  end if;
  select * into r from public.category_requests where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'already_decided' using errcode = '42501';
  end if;
  if p_action = 'approve' then
    select c.icon into v_icon from public.categories c where c.id = p_parent and c.parent_id is null;
    if p_parent is null or v_icon is null or char_length(v_name_en) not between 2 and 80 then
      raise exception 'invalid_category' using errcode = '23514';
    end if;
    v_base := btrim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, r.requested_name)),
                                   '[^a-z0-9]+', '-', 'g'), '-');
    if v_base = '' then
      v_base := 'categorie';
    end if;
    v_slug := v_base;
    while exists (select 1 from public.categories c where c.slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := v_base || '-' || v_n;
    end loop;
    insert into public.categories (parent_id, slug, name_fr, name_en, icon, sort_order)
    values (p_parent, v_slug, r.requested_name, v_name_en, v_icon,
            coalesce((select max(c.sort_order) from public.categories c where c.parent_id = p_parent), 0) + 1)
    returning id into v_category;
    update public.category_requests set status = 'approved', admin_note = v_note, decided_at = now() where id = p_id;
  elsif p_action = 'merge' then
    if p_into is null or not exists (select 1 from public.categories c where c.id = p_into) then
      raise exception 'invalid_category' using errcode = '23514';
    end if;
    update public.category_requests set status = 'merged', decided_at = now(),
           admin_note = 'merged_into:' || p_into::text || coalesce(' ' || v_note, '')
     where id = p_id;
  else
    update public.category_requests set status = 'rejected', admin_note = v_note, decided_at = now() where id = p_id;
  end if;
  perform public.notify_user(r.user_id, 'category_decided', 'Demande traitée',
    'Ouvrez l''application pour voir le détail.', 'Request handled', 'Open the app to see the details.',
    jsonb_build_object('kind', 'category_decided', 'request_id', p_id), 'category_decided:' || p_id);
  perform public.admin_log('category_decision', 'category_request', p_id,
    jsonb_build_object('action', p_action, 'category_id', v_category, 'into', p_into));
end $$;
revoke all on function public.admin_decide_category(uuid, text, uuid, text, uuid, text) from public, anon;
grant execute on function public.admin_decide_category(uuid, text, uuid, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Feedback: signed-in app senders only through the API; anonymous ones go through the
-- submit-feedback Edge Function (Turnstile), which writes with the service role.
alter table public.feedback add column source text not null default 'app' check (source in ('app', 'anonymous'));
alter table public.feedback add constraint feedback_anonymous_shape
  check (source <> 'anonymous' or (user_id is null and screenshot_path is null));
alter table public.feedback alter column user_id set default auth.uid();
alter table public.feedback add constraint feedback_screenshot_shape check (screenshot_path is null
  or screenshot_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$');

drop policy feedback_insert_anon on public.feedback;
drop policy feedback_insert_auth on public.feedback;
revoke all on public.feedback from anon;
create policy feedback_insert_auth on public.feedback for insert to authenticated
  with check (user_id = auth.uid() and status = 'new' and source = 'app'
    and (screenshot_path is null or screenshot_path like auth.uid()::text || '/%'));

create function public.admin_feedback(
  p_status text default 'new', p_before_at timestamptz default null, p_before_id uuid default null,
  p_limit int default 50
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.created_at desc, x.id desc)
      from (
        select f.id, f.created_at, jsonb_build_object(
            'id', f.id, 'created_at', f.created_at, 'type', f.type, 'body', f.body, 'source', f.source,
            'status', f.status, 'app_version', f.app_version, 'device_model', f.device_model,
            'has_screenshot', f.screenshot_path is not null,
            'sender_first_name', (select p.first_name from public.profiles p where p.id = f.user_id)) as j
          from public.feedback f
         where (p_status = 'all' or f.status = p_status)
           and (p_before_at is null or (f.created_at, f.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
         order by f.created_at desc, f.id desc
         limit greatest(1, least(coalesce(p_limit, 50), 100))) x), '[]'::jsonb);
end $$;
revoke all on function public.admin_feedback(text, timestamptz, uuid, int) from public, anon;
grant execute on function public.admin_feedback(text, timestamptz, uuid, int) to authenticated;

create function public.admin_feedback_screenshot_path(p_id uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_path text;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select f.screenshot_path into v_path from public.feedback f where f.id = p_id;
  if v_path is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.admin_log('feedback_screenshot_viewed', 'feedback', p_id, '{}'::jsonb);
  return v_path;
end $$;
revoke all on function public.admin_feedback_screenshot_path(uuid) from public, anon;
grant execute on function public.admin_feedback_screenshot_path(uuid) to authenticated;

create function public.admin_set_feedback_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('new', 'planned', 'done', 'wont_do') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;
  update public.feedback set status = p_status where id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.admin_log('feedback_status', 'feedback', p_id, jsonb_build_object('status', p_status));
end $$;
revoke all on function public.admin_set_feedback_status(uuid, text) from public, anon;
grant execute on function public.admin_set_feedback_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- A collectif that became an association: its responsable, who holds the verified claim, moves the
-- collectif's activities under the association. The collectif stays. (An activity has one organising
-- body, so the collectif link is cleared as the association link is set.)
create function public.link_collectif_to_association(p_collectif uuid, p_association uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
begin
  if v_uid is null
     or not exists (select 1 from public.collectif_members m
                     where m.collectif_id = p_collectif and m.user_id = v_uid
                       and m.role = 'responsable' and m.status = 'active')
     or not exists (select 1 from public.associations a
                     where a.id = p_association and a.claimed_by = v_uid and a.verified and a.removed_at is null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.activities set organised_by_association_id = p_association, organised_by_collectif_id = null
   where organised_by_collectif_id = p_collectif;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.link_collectif_to_association(uuid, uuid) from public, anon;
grant execute on function public.link_collectif_to_association(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The guard of migration 6, plus the two review columns: only admins (definer functions) set them.
create or replace function public.associations_guard_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  c_import_owned constant text[] := array['insee_code', 'postcode', 'city', 'geocode_precision',
                                          'embedding_hash', 'last_import_run', 'rna_published_on'];
begin
  new.updated_at := now();
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if tg_op = 'INSERT' then
      if new.rna_id is not null or new.osm_id is not null or new.embedding is not null
         or new.claimed_by is not null or new.verified or new.confidence <> 0
         or new.likely_not_public or new.locked_fields <> '{}' or new.attribution <> '{}'::jsonb
         or new.insee_code is not null or new.geocode_precision is not null or new.embedding_hash is not null
         or new.last_import_run is not null or new.rna_published_on is not null
         or new.reviewed_at is not null or new.removed_at is not null then
        raise exception 'column not settable' using errcode = '42501';
      end if;
    elsif (new.id, new.name, new.rna_id, new.osm_id, new.address, new.location, new.embedding::text,
        new.confidence, new.likely_not_public, new.source, new.claimed_by, new.verified,
        new.attribution, new.created_by, new.created_at,
        new.insee_code, new.postcode, new.city, new.geocode_precision, new.embedding_hash,
        new.last_import_run, new.rna_published_on, new.reviewed_at, new.removed_at)
       is distinct from
       (old.id, old.name, old.rna_id, old.osm_id, old.address, old.location, old.embedding::text,
        old.confidence, old.likely_not_public, old.source, old.claimed_by, old.verified,
        old.attribution, old.created_by, old.created_at,
        old.insee_code, old.postcode, old.city, old.geocode_precision, old.embedding_hash,
        old.last_import_run, old.rna_published_on, old.reviewed_at, old.removed_at)
       or exists (select 1 from unnest(new.locked_fields) l
                  where l = any(c_import_owned) and not l = any(old.locked_fields)) then
      raise exception 'column not editable' using errcode = '42501';
    else
      -- A claimant's edit locks the column: later imports keep the claimant's value.
      new.locked_fields := new.locked_fields || array(
        select c from (values (1, 'purpose', new.purpose is distinct from old.purpose),
                              (2, 'website', new.website is distinct from old.website),
                              (3, 'phone', new.phone is distinct from old.phone),
                              (4, 'email', new.email is distinct from old.email),
                              (5, 'opening_hours', new.opening_hours is distinct from old.opening_hours)) v(n, c, changed)
        where changed and not c = any(new.locked_fields)
        order by n);
    end if;
  end if;
  return new;
end $$;

-- Notification texts: migration 30's set plus the two request kinds (generic).
create or replace function public.notif_text(p_kind text, p_lang text) returns table (title text, body text)
language sql immutable set search_path = public, pg_temp as $$
  select case when p_lang = 'en' then t.title_en else t.title_fr end,
         case when p_lang = 'en' then t.body_en else t.body_fr end
    from (values
      ('session_reminder', 'Rappel', 'Vous avez une activité demain. Serez-vous là ?',
                           'Reminder', 'You have an activity tomorrow. Will you be there?'),
      ('new_member', 'Nouveau membre', 'Quelqu''un a rejoint votre activité.',
                     'New member', 'Someone joined your activity.'),
      ('join_request', 'Nouvelle demande', 'Une personne souhaite rejoindre votre activité.',
                       'New request', 'Someone would like to join your activity.'),
      ('request_accepted', 'Demande acceptée', 'Votre demande a été acceptée.',
                           'Request accepted', 'Your request was accepted.'),
      ('late_cancellation', 'Désistement tardif', 'Une personne ne viendra pas à une prochaine séance.',
                             'Late cancellation', 'Someone can no longer make an upcoming session.'),
      ('session_cancelled', 'Séance annulée', 'Une séance de votre activité est annulée.',
                             'Session cancelled', 'A session of your activity is cancelled.'),
      ('session_moved', 'Séance modifiée', 'Une séance de votre activité a changé.',
                         'Session changed', 'A session of your activity has changed.'),
      ('session_rule_changed', 'Séance modifiée', 'Une séance de votre activité a changé.',
                                'Session changed', 'A session of your activity has changed.'),
      ('collectif_invitation', 'Invitation', 'Vous êtes invité à organiser un collectif.',
                                'Invitation', 'You are invited to organise a collective.'),
      ('chat_message', 'Nouveau message', 'Nouveau message dans une de vos activités.',
                       'New message', 'New message in one of your activities.'),
      ('report_handled', 'Information de modération', 'Ouvrez l''application pour voir le détail.',
                         'Moderation information', 'Open the app to see the details.'),
      ('moderation_notice', 'Information de modération', 'Ouvrez l''application pour voir le détail.',
                            'Moderation information', 'Open the app to see the details.'),
      ('claim_decided', 'Demande traitée', 'Ouvrez l''application pour voir le détail.',
                        'Request handled', 'Open the app to see the details.'),
      ('category_decided', 'Demande traitée', 'Ouvrez l''application pour voir le détail.',
                           'Request handled', 'Open the app to see the details.')
    ) as t(kind, title_fr, body_fr, title_en, body_en)
   where t.kind = p_kind
  union all
  select case when p_lang = 'en' then 'Notification' else 'Notification' end,
         case when p_lang = 'en' then 'Open the app to see the details.' else 'Ouvrez l''application pour voir le détail.' end
   where p_kind not in ('session_reminder', 'new_member', 'join_request', 'request_accepted', 'late_cancellation',
                        'session_cancelled', 'session_moved', 'session_rule_changed', 'collectif_invitation',
                        'chat_message', 'report_handled', 'moderation_notice', 'claim_decided',
                        'category_decided');
$$;

-- search.explore_rows: migration 26's, plus the removed_at predicate.
create or replace function search.explore_rows(
  p_point geography, p_radius_m float8, p_query text, p_query_embedding extensions.vector,
  p_kinds text[], p_weekday smallint, p_newcomer_friendly boolean, p_interest_slugs text[],
  p_discovery_only boolean default false
) returns table (
  kind text, id uuid, distance_m float8, score smallint, keyword boolean, penalty int, is_new boolean,
  source_label text
)
language sql stable
-- No SET clause and every name qualified: PostgreSQL inlines a SQL function only without one, and
-- inlined into search_explore's query the planner sees the caller's values (mode, kinds, filters)
-- and folds the branches they rule out. Called as a function it ran about twice as slow.
as $$
  with p as (
    select prm.*, search.normalise_name(p_query) as q_norm,
           case when p_query is not null
             then pg_catalog.websearch_to_tsquery('french', search.unaccent(p_query)) end as tsq
    from search.params() prm
  ),
  -- Everyone the caller has a block with, in either direction (empty when signed out).
  blk as (
    select coalesce(array_agg(case when b.blocker_id = auth.uid() then b.blocked_id else b.blocker_id end),
                    '{}'::uuid[]) as ids
    from public.blocks b
    where auth.uid() is not null and (b.blocker_id = auth.uid() or b.blocked_id = auth.uid())
  ),
  -- Collectifs with an active member among them: found through the user index, once per search.
  blkc as (
    select coalesce(array_agg(distinct m.collectif_id), '{}'::uuid[]) as ids
    from blk
    cross join lateral unnest(blk.ids) as bu(uid)
    join public.collectif_members m on m.user_id = bu.uid and m.status = 'active'
  ),
  assoc as (
    select 'association'::text as kind, a.id, extensions.ST_Distance(a.town_point, p_point) as distance_m,
           search.penalty(a.likely_not_public, a.confidence, a.source, a.verified) as penalty,
           false as is_new,
           search.is_dormant(a.website, a.osm_id, a.claimed_by, a.rna_published_on, a.source, current_date)
             as dormant,
           search.source_label(a.source, a.verified, a.confidence) as source_label,
           case when p_query is not null then extensions.word_similarity(p.q_norm, a.name_norm) end as name_sim,
           case when p_query is not null then a.search_tsv @@ p.tsq end as fts,
           case when p_query is not null then 1 - (a.embedding operator(extensions.<=>) p_query_embedding) end as sim
    from public.associations a, p
    where 'association' = any(p_kinds) and p_weekday is null and not p_newcomer_friendly
      and not p_discovery_only
      and extensions.ST_DWithin(a.town_point, p_point, p_radius_m)
      and not search.is_hidden(a.confidence, a.source)
      and a.removed_at is null
      and (p_query is not null or cardinality(p_interest_slugs) = 0
           or exists (select 1 from public.association_tags at join public.tags t on t.id = at.tag_id
                      where at.association_id = a.id and t.slug = any(p_interest_slugs)))
  ),
  act as (
    select 'activity'::text, x.id, extensions.ST_Distance(x.place, p_point), 0,
           x.published_at > now() - pg_catalog.make_interval(days => p.new_days),
           false, null::text,
           case when p_query is not null then extensions.word_similarity(p.q_norm, search.normalise_name(x.title)) end,
           case when p_query is not null then x.search_tsv @@ p.tsq end,
           case when p_query is not null then 1 - (x.embedding operator(extensions.<=>) p_query_embedding) end
    from public.activities x, p, blk
    where 'activity' = any(p_kinds)
      and extensions.ST_DWithin(x.place, p_point, p_radius_m)
      and x.archived_at is null and x.published_at <= now()
      and not (x.organiser_id = any(blk.ids))
      and (not p_newcomer_friendly or x.newcomer_friendly)
      and (not p_discovery_only
           or exists (select 1 from public.sessions s
                      where s.activity_id = x.id and s.is_discovery and s.status = 'scheduled'
                        and s.starts_at > now() and s.starts_at <= now() + interval '14 days'))
      and (p_query is not null or cardinality(p_interest_slugs) = 0
           or exists (select 1 from public.categories c
                      where c.id = x.category_id and c.slug = any(p_interest_slugs))
           or exists (select 1 from public.activity_tags at join public.tags t on t.id = at.tag_id
                      where at.activity_id = x.id and t.slug = any(p_interest_slugs)))
      and (p_weekday is null or case x.recurrence_kind
             when 'weekly' then extract(isodow from x.start_date) = p_weekday
             when 'weekdays' then p_weekday = any(x.recurrence_weekdays)
             else true end)
  ),
  -- Collectifs travel with 'association' (the app has two kinds). Like a community listing that is
  -- not verified: penalty_community. They have no tags, so an interest-filtered browse skips them.
  col as (
    select 'collectif'::text, c.id, extensions.ST_Distance(c.town_point, p_point),
           p.penalty_community,
           false, false, 'collectif'::text,
           case when p_query is not null then extensions.word_similarity(p.q_norm, search.normalise_name(c.name)) end,
           case when p_query is not null then c.search_tsv @@ p.tsq end,
           case when p_query is not null then 1 - (c.embedding operator(extensions.<=>) p_query_embedding) end
    from public.collectifs c, p, blkc
    where 'association' = any(p_kinds) and p_weekday is null and not p_newcomer_friendly
      and not p_discovery_only and cardinality(p_interest_slugs) = 0
      and extensions.ST_DWithin(c.town_point, p_point, p_radius_m)
      and not (c.id = any(blkc.ids))
      -- a collectif whose last responsable or organiser is gone (banned, say) is hidden
      and exists (select 1 from public.collectif_members m where m.collectif_id = c.id and m.status = 'active')
  ),
  scored as (
    select c.*, k.keyword,
           case when p_query is not null then
             search.score(c.sim, k.keyword, coalesce(c.name_sim, 0), c.penalty, c.is_new) end as score,
           p.min_score, p.strong, p.name_sim as name_sim_min
    from (select * from assoc union all select * from act union all select * from col) c
    cross join p
    cross join lateral (select coalesce(c.fts, false) or coalesce(c.name_sim, 0) >= p.name_sim as keyword) k
  )
  select s.kind, s.id, s.distance_m, s.score, s.keyword, s.penalty, s.is_new, s.source_label
  from scored s
  where case
    when p_query is null then not s.dormant
    else
      (s.score >= s.min_score or s.keyword)
      and (not s.dormant or coalesce(s.name_sim, 0) >= s.name_sim_min
           or search.base_score(s.sim, s.keyword, coalesce(s.name_sim, 0)) >= s.strong)
    end
$$;

-- get_association: migration 7's, plus the removed_at predicate.
create or replace function public.get_association(p_id uuid) returns jsonb
language sql stable security definer
set search_path = public, search, extensions, pg_temp
as $$
  select jsonb_build_object(
    'id', a.id, 'name', a.name, 'purpose', a.purpose, 'city', a.city, 'postcode', a.postcode,
    'lon', ST_X(a.town_point::geometry), 'lat', ST_Y(a.town_point::geometry),
    'website', a.website, 'phone', a.phone, 'email', a.email, 'opening_hours', a.opening_hours,
    'source', a.source, 'verified', a.verified, 'claimed', a.claimed_by is not null,
    'source_label', search.source_label(a.source, a.verified, a.confidence),
    'attribution_keys', coalesce((select jsonb_agg(k order by k) from jsonb_object_keys(a.attribution) k), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('slug', t.slug, 'label_fr', t.label_fr,
                                                          'label_en', t.label_en) order by t.slug)
                      from association_tags at join tags t on t.id = at.tag_id
                      where at.association_id = a.id), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title)
                                             order by x.start_date, x.id)
                            from activities x
                            where x.organised_by_association_id = a.id and x.archived_at is null
                              and x.published_at <= now()
                              and (auth.uid() is null or not public.is_blocked_between(x.organiser_id))),
                           '[]'::jsonb),
    'can_wait', a.claimed_by is null and a.website is null and a.phone is null and a.email is null,
    'is_waiting', exists (select 1 from association_waiters w
                          where w.association_id = a.id and w.user_id = auth.uid())
  )
  from associations a
  where a.id = p_id and not search.is_hidden(a.confidence, a.source) and a.removed_at is null
$$;
revoke all on function public.get_association(uuid) from public;
grant execute on function public.get_association(uuid) to anon, authenticated;

-- search_linkable_associations: migration 19's, plus the removed_at predicate.
create or replace function public.search_linkable_associations(p_query text, p_limit int default 20)
returns table (id uuid, name text, city text, postcode text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_norm text := search.normalise_name(p_query);
  v_raw text := btrim(coalesce(p_query, ''));
  v_norm_pat text;
  v_raw_pat text;
  v_prefix text;
  v_uid uuid := auth.uid();
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if char_length(v_norm) >= 3 then
    v_norm_pat := '%' || replace(replace(replace(v_norm, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_prefix := substr(v_norm_pat, 2);
  end if;
  if v_norm = '' and char_length(v_raw) >= 3 then
    v_raw_pat := '%' || replace(replace(replace(v_raw, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  if v_norm_pat is null and v_raw_pat is null then
    return;
  end if;
  return query
    select a.id, a.name, a.city, a.postcode
      from public.associations a
     where a.removed_at is null
       and (a.verified = false or a.claimed_by = v_uid)
       and ((v_norm_pat is not null and a.name_norm ilike v_norm_pat)
            or (v_raw_pat is not null and a.name ilike v_raw_pat))
     order by (v_prefix is not null and a.name_norm like v_prefix) desc, a.name, a.id
     limit v_limit;
end $$;
revoke all on function public.search_linkable_associations(text, int) from public, anon;
grant execute on function public.search_linkable_associations(text, int) to authenticated;
