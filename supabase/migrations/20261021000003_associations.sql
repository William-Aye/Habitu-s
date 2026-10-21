-- Association directory (imported monthly by service role + community-added), tags, ownership claims.

create table public.associations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  purpose text,
  rna_id text unique,
  osm_id text unique,
  address text,
  location geography(Point, 4326),
  website text,
  phone text,
  email text,
  opening_hours text,
  embedding vector(384),
  confidence smallint not null default 0 check (confidence between 0 and 100),
  likely_not_public boolean not null default false,
  source text not null check (source in ('rna', 'osm', 'rna+osm', 'community')),
  claimed_by uuid references public.profiles on delete set null,
  verified boolean not null default false,
  locked_fields text[] not null default '{}',  -- fields edited by a claimant; importer never overwrites them
  attribution jsonb not null default '{}',
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index associations_location_gist on public.associations using gist (location);
create index associations_embedding_hnsw on public.associations using hnsw (embedding vector_cosine_ops);
create index associations_name_trgm on public.associations using gin (name gin_trgm_ops);

create table public.association_tags (
  association_id uuid not null references public.associations on delete cascade,
  tag_id uuid not null references public.tags on delete cascade,
  primary key (association_id, tag_id)
);

create table public.association_claims (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations on delete cascade,
  claimant_id uuid not null references public.profiles on delete cascade,
  proof_method text not null check (proof_method in ('domain_email', 'document')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.associations enable row level security;
alter table public.association_tags enable row level security;
alter table public.association_claims enable row level security;

-- Table privileges (truncate/references/trigger already stripped by default privileges).
revoke all on public.associations, public.association_tags, public.association_claims from anon;
grant select on public.associations, public.association_tags to anon;
revoke truncate, references, trigger on
  public.associations, public.association_tags, public.association_claims
  from anon, authenticated;

-- Normal DML privileges for API roles; RLS policies and the guard trigger gate who may do what.
grant select, insert, update, delete on
  public.associations, public.association_tags, public.association_claims to authenticated;

-- Column restriction for non-admin API users on insert/update (admins need every column, so a
-- trigger rather than column grants). Service role / postgres are not restricted.
create function public.associations_guard_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if tg_op = 'INSERT' then
      if new.rna_id is not null or new.osm_id is not null or new.embedding is not null
         or new.claimed_by is not null or new.verified or new.confidence <> 0
         or new.likely_not_public or new.locked_fields <> '{}' or new.attribution <> '{}'::jsonb then
        raise exception 'column not settable' using errcode = '42501';
      end if;
    elsif (new.id, new.name, new.rna_id, new.osm_id, new.address, new.location, new.embedding::text,
        new.confidence, new.likely_not_public, new.source, new.claimed_by, new.verified,
        new.attribution, new.created_by, new.created_at)
       is distinct from
       (old.id, old.name, old.rna_id, old.osm_id, old.address, old.location, old.embedding::text,
        old.confidence, old.likely_not_public, old.source, old.claimed_by, old.verified,
        old.attribution, old.created_by, old.created_at) then
      raise exception 'column not editable' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger associations_guard_update before insert or update on public.associations
  for each row execute function public.associations_guard_update();

-- associations
create policy associations_select on public.associations for select to anon, authenticated using (true);
create policy associations_insert on public.associations for insert to authenticated
  with check (source = 'community' and verified = false and claimed_by is null and created_by = auth.uid());
create policy associations_update_claimant on public.associations for update to authenticated
  using (claimed_by = auth.uid()) with check (claimed_by = auth.uid());
create policy associations_admin on public.associations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- association_tags
create policy association_tags_select on public.association_tags for select to anon, authenticated using (true);
create policy association_tags_admin on public.association_tags for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- association_claims
create policy claims_insert on public.association_claims for insert to authenticated
  with check (claimant_id = auth.uid() and status = 'pending');
create policy claims_select_own on public.association_claims for select to authenticated
  using (claimant_id = auth.uid());
create policy claims_admin on public.association_claims for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
