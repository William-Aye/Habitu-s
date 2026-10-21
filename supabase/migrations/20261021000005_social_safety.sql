-- Messages, blocks, reports, safety tips, session feedback, organiser trust, feedback form,
-- saved searches, search misses, notification log.

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid references public.activities on delete cascade,
  sender_id uuid not null references public.profiles on delete cascade,
  recipient_id uuid references public.profiles on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint messages_one_target check (num_nonnulls(activity_id, recipient_id) = 1)
);
create index messages_activity_created on public.messages (activity_id, created_at);
create index messages_recipient_created on public.messages (recipient_id, created_at);
create index messages_sender on public.messages (sender_id);

create table public.blocks (
  blocker_id uuid not null references public.profiles on delete cascade,
  blocked_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked on public.blocks (blocked_id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles on delete set null,
  target_type text not null check (target_type in ('user', 'activity', 'message', 'association')),
  target_id uuid not null,
  reason text not null check (reason in
    ('unsafe_place', 'inappropriate_behaviour', 'fake_or_spam', 'did_not_happen', 'other')),
  details text,
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  decision text,
  statement_of_reasons text,
  decided_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint reports_decision_has_reasons check (status = 'open' or coalesce(char_length(statement_of_reasons), 0) > 0)
);
create index reports_status_created on public.reports (status, created_at);
create index reports_reporter on public.reports (reporter_id);

create table public.safety_tips_seen (
  user_id uuid not null references public.profiles on delete cascade,
  tip_id text not null,
  primary key (user_id, tip_id)
);

create table public.ambiance_words (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label_fr text not null,
  label_en text not null,
  sort_order int not null default 0
);

create table public.session_feedback (
  session_id uuid not null references public.sessions on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  went_well boolean not null,
  ambiance_word_ids uuid[] not null default '{}' check (cardinality(ambiance_word_ids) <= 3),
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index session_feedback_user on public.session_feedback (user_id);

create table public.organiser_stats (
  user_id uuid primary key references public.profiles on delete cascade,
  sessions_held int not null default 0,
  distinct_participants int not null default 0,
  positive_count int not null default 0,
  feedback_count int not null default 0,
  late_cancel_rate numeric not null default 0,
  badge_status text not null default 'none' check (badge_status in ('none', 'active', 'suspended', 'revoked')),
  revoked_until timestamptz,
  updated_at timestamptz not null default now()
);

-- Owner-privileged on purpose (no security_invoker): exposes only the public trust fields,
-- never feedback counts. The Supabase advisor warning about security-definer views is expected.
create view public.organiser_badges as
  select user_id, sessions_held, distinct_participants, badge_status from public.organiser_stats;

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles on delete set null,
  type text not null check (type in ('idea', 'problem', 'other')),
  body text not null check (char_length(body) between 1 and 5000),
  screenshot_path text,
  app_version text,
  device_model text,
  status text not null default 'new' check (status in ('new', 'planned', 'done', 'wont_do')),
  created_at timestamptz not null default now()
);

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  query text not null,
  filters jsonb not null default '{}',
  center geography(Point, 4326) not null,
  radius_km int not null check (radius_km in (5, 10, 25, 50)),
  alert boolean not null default true,
  created_at timestamptz not null default now()
);
create index saved_searches_user on public.saved_searches (user_id);

create table public.search_misses (
  id bigserial primary key,
  query text not null,
  area_label text,
  created_at timestamptz not null default now()
);

create table public.notification_log (
  id bigserial primary key,
  user_id uuid not null references public.profiles on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now()
);
create index notification_log_user on public.notification_log (user_id, sent_at);

-- Feedback gate: the caller must have a confirmed attendance at a session that has started
-- and was not cancelled.
-- Security definer, caller-only (no user parameter) so it cannot be used as an oracle.
create function public.has_confirmed_attendance(p_session uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.attendances a join public.sessions s on s.id = a.session_id
                  where a.session_id = p_session and a.user_id = auth.uid()
                    and a.status = 'confirmed' and s.starts_at < now()
                    and s.status in ('scheduled', 'held'));
$$;
revoke all on function public.has_confirmed_attendance(uuid) from public, anon;
grant execute on function public.has_confirmed_attendance(uuid) to authenticated;

-- Blocking hides both users from each other. Caller-scoped (auth.uid()), no user-pair oracle.
create function public.is_blocked_between(p_other uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.blocks b
                  where (b.blocker_id = auth.uid() and b.blocked_id = p_other)
                     or (b.blocker_id = p_other and b.blocked_id = auth.uid()));
$$;
revoke all on function public.is_blocked_between(uuid) from public, anon;
grant execute on function public.is_blocked_between(uuid) to authenticated;

alter table public.messages enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.safety_tips_seen enable row level security;
alter table public.ambiance_words enable row level security;
alter table public.session_feedback enable row level security;
alter table public.organiser_stats enable row level security;
alter table public.feedback enable row level security;
alter table public.saved_searches enable row level security;
alter table public.search_misses enable row level security;
alter table public.notification_log enable row level security;

revoke all on public.messages, public.blocks, public.reports, public.safety_tips_seen,
  public.ambiance_words, public.session_feedback, public.organiser_stats, public.organiser_badges,
  public.feedback, public.saved_searches, public.search_misses, public.notification_log
  from anon, authenticated;
-- RLS (not grants) gates authenticated access, so in-app admins can work through their JWT.
grant select, insert, update, delete on
  public.messages, public.blocks, public.reports, public.safety_tips_seen,
  public.ambiance_words, public.session_feedback, public.organiser_stats,
  public.feedback, public.saved_searches, public.search_misses, public.notification_log
  to authenticated;
grant select on public.organiser_badges to anon, authenticated;
grant select on public.ambiance_words to anon;
-- anon may submit feedback; select is granted but no policy matches, so it reads zero rows.
grant select, insert on public.feedback to anon;

-- messages
create policy messages_select_group on public.messages for select to authenticated
  using (activity_id is not null and public.is_activity_member(activity_id)
    and not public.is_blocked_between(sender_id));
create policy messages_select_private on public.messages for select to authenticated
  using (recipient_id is not null and (sender_id = auth.uid() or recipient_id = auth.uid())
    and not public.is_blocked_between(case when sender_id = auth.uid() then recipient_id else sender_id end));
create policy messages_insert_group on public.messages for insert to authenticated
  with check (activity_id is not null and recipient_id is null and sender_id = auth.uid()
    and public.is_activity_member(activity_id));
-- admins moderate: read and delete only, never post
create policy messages_admin_select on public.messages for select to authenticated
  using (public.is_admin());
create policy messages_admin_delete on public.messages for delete to authenticated
  using (public.is_admin());

-- blocks, safety_tips_seen, saved_searches: own rows; admin may read
create policy blocks_own on public.blocks for all to authenticated
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());
create policy blocks_admin on public.blocks for select to authenticated using (public.is_admin());
create policy tips_own on public.safety_tips_seen for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy tips_admin on public.safety_tips_seen for select to authenticated using (public.is_admin());
create policy saved_searches_own on public.saved_searches for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy saved_searches_admin on public.saved_searches for select to authenticated using (public.is_admin());

-- reports
create policy reports_insert_own on public.reports for insert to authenticated
  with check (reporter_id = auth.uid() and status = 'open' and decision is null
    and statement_of_reasons is null and decided_by is null and decided_at is null);
create policy reports_select_own on public.reports for select to authenticated
  using (reporter_id = auth.uid());
create policy reports_admin on public.reports for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ambiance_words
create policy ambiance_select on public.ambiance_words for select to anon, authenticated using (true);
create policy ambiance_admin on public.ambiance_words for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- session_feedback: write-only for participants; only admins read
create policy session_feedback_insert on public.session_feedback for insert to authenticated
  with check (user_id = auth.uid() and public.has_confirmed_attendance(session_id)
    and not public.is_session_organiser(session_id));
create policy session_feedback_admin on public.session_feedback for select to authenticated
  using (public.is_admin());

-- organiser_stats
create policy organiser_stats_own on public.organiser_stats for select to authenticated
  using (user_id = auth.uid());
create policy organiser_stats_admin on public.organiser_stats for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- feedback
create policy feedback_insert_anon on public.feedback for insert to anon
  with check (user_id is null and status = 'new');
create policy feedback_insert_auth on public.feedback for insert to authenticated
  with check ((user_id is null or user_id = auth.uid()) and status = 'new');
create policy feedback_admin on public.feedback for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- search_misses, notification_log: service role writes, admins read
create policy search_misses_admin on public.search_misses for select to authenticated using (public.is_admin());
create policy notification_log_admin on public.notification_log for select to authenticated using (public.is_admin());

revoke truncate, references, trigger on
  public.messages, public.blocks, public.reports, public.safety_tips_seen,
  public.ambiance_words, public.session_feedback, public.organiser_stats, public.organiser_badges,
  public.feedback, public.saved_searches, public.search_misses, public.notification_log
  from anon, authenticated;
