-- TM-14 (threat model): a scheduled job (retention, cleanup, notifications) could fail every night
-- without anyone noticing. Once a day, if any pg_cron run failed in the last 24 hours, every admin
-- gets one push notification. Limits: it cannot arrive while send-push itself is broken, and a
-- call queued with net.http_post counts as a success even if the Edge Function then fails.

create or replace function private.notify_failed_jobs() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_failed int;
  r record;
begin
  select count(*) into v_failed
    from cron.job_run_details d
   where d.status = 'failed' and d.start_time > now() - interval '24 hours';
  if v_failed = 0 then
    return 0;
  end if;
  for r in select p.id from public.profiles p where p.role = 'admin' and p.banned_at is null loop
    perform public.notify_user(r.id, 'job_failed', 'Tâche planifiée en échec',
      'Au moins une tâche planifiée a échoué ces dernières 24 heures. Voir cron.job_run_details.',
      'Scheduled job failed', 'At least one scheduled job failed in the last 24 hours. See cron.job_run_details.',
      jsonb_build_object('kind', 'job_failed'), 'job_failed:' || r.id || ':' || current_date);
  end loop;
  return v_failed;
end $$;
revoke all on function private.notify_failed_jobs() from public, anon, authenticated;

select cron.schedule('job-health', '50 6 * * *', $$ select private.notify_failed_jobs() $$);
