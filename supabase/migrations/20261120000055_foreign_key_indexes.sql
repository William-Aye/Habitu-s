-- Plan step 2.5: indexes for foreign keys on read paths and on account deletion. Without them,
-- deleting one profile scanned every referencing table (associations has about a million rows
-- from the directory import), and association and collectif pages scanned activities.
-- Mostly-empty columns get partial indexes, which stay tiny.

create index if not exists activities_organiser_id on public.activities (organiser_id);
create index if not exists activities_by_association on public.activities (organised_by_association_id)
  where organised_by_association_id is not null;
create index if not exists activities_by_collectif on public.activities (organised_by_collectif_id)
  where organised_by_collectif_id is not null;

create index if not exists associations_claimed_by on public.associations (claimed_by) where claimed_by is not null;
create index if not exists associations_created_by on public.associations (created_by) where created_by is not null;
create index if not exists association_tags_tag_id on public.association_tags (tag_id);
create index if not exists activity_tags_tag_id on public.activity_tags (tag_id);

create index if not exists notification_outbox_user_id on public.notification_outbox (user_id);
create index if not exists activity_interests_user_id on public.activity_interests (user_id);
create index if not exists collectifs_created_by on public.collectifs (created_by);
create index if not exists category_requests_user_id on public.category_requests (user_id);
create index if not exists association_claims_claimant_id on public.association_claims (claimant_id);
create index if not exists association_waiters_user_id on public.association_waiters (user_id);
create index if not exists feedback_user_id on public.feedback (user_id) where user_id is not null;
create index if not exists reports_target_owner on public.reports (target_owner) where target_owner is not null;
