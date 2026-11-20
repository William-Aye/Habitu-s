begin;
\ir helpers.inc
select plan(5);

-- TM-14: admins hear about failed scheduled jobs once a day.
select tests.create_user('jh-admin@example.test', 'Ada') as admin \gset
select tests.create_user('jh-user@example.test', 'Ugo') as member \gset
update public.profiles set role = 'admin' where id = :'admin';
delete from cron.job_run_details;

select is(private.notify_failed_jobs(), 0, 'no failure, no notification');
select is((select count(*) from public.notification_outbox where kind = 'job_failed')::int, 0, 'nothing queued');

insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
values (1, 999001, 1, 'postgres', 'postgres', 'select 1', 'failed', 'boom', now() - interval '1 hour', now() - interval '1 hour'),
       (1, 999002, 1, 'postgres', 'postgres', 'select 1', 'failed', 'old', now() - interval '3 days', now() - interval '3 days');
select is(private.notify_failed_jobs(), 1, 'only failures of the last 24 hours count');
select private.notify_failed_jobs();
select results_eq($$ select user_id from public.notification_outbox where kind = 'job_failed' $$,
  array[:'admin'::uuid], 'one notification, to the admin only, even when run twice');
select ok(exists (select 1 from cron.job where jobname = 'job-health'), 'the check runs daily');

select * from finish();
rollback;
