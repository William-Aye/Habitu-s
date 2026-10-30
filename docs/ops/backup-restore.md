# Backup and restore

Last updated: 2026-10-30

This page explains where the database backups are, how to restore one, and how to prove that a backup can really be restored. Do the proof once before launch and then every quarter.

## 1. Where the backups are

Supabase Pro takes a backup of the whole database every day, automatically. You do not need to switch anything on.

- Where: Supabase dashboard, your project, "Database", then "Backups", then "Scheduled backups".
- How long they are kept: 7 days on the Pro plan. After that the oldest one disappears. The plan page in the dashboard shows the current number; check it matches.
- What is not in them: files stored in Storage (profile photos). The backup holds the list of files, not the files. Deleted photos cannot be recovered from a database backup.
- Point-in-time recovery (restoring to a chosen minute) is a paid add-on. It is not switched on by default. Decide before launch whether you want it.

## 2. Restore a backup in the dashboard

Restoring replaces the live database. Everything written after the backup was taken is lost, including accounts created and messages sent since. Only do it for a real disaster, never to "try it out" on the live project.

1. Open the dashboard, "Database", "Backups", "Scheduled backups".
2. Pick the backup (the date and time you want to go back to).
3. Click "Restore" and confirm. The project is unavailable while it restores (minutes for a small database).
4. When it is back: open the app, sign in, and check a few screens.
5. Check the scheduled jobs are back with the SQL editor: `select jobname, active from cron.job order by jobname;` There should be 11 jobs.
6. Tell the testers or users what happened if anything was lost.

If you only want to try a restore, use section 3 instead: it never touches the live project.

## 3. Prove a backup works: the restore check

The script `scripts/restore-check.sh` copies a database (roles, schema and data) into an empty scratch database on your own machine, and then checks the copy against the original:

- the exact number of rows in every `public` table;
- the number of tables with row level security;
- the installed extensions;
- the number of categories.

It exits with 0 only when everything matches. If anything differs it exits with 1 and shows the differences. It never prints the connection strings.

### What you need

- Docker Desktop, with local Supabase running (`npx supabase start`). The first run downloads a Postgres image and can take several minutes.
- Node.js (for `npx supabase`), and a bash shell (Git Bash on Windows).
- `psql`, the PostgreSQL client. If it is not installed the script uses the one inside the local Supabase database container, which works for the local scratch database. GitHub's Ubuntu runners already have `psql`.

### Run it against the hosted project

1. Get the hosted connection string: dashboard, "Project Settings", "Database", "Connection string", the "Session pooler" tab. Put your database password in it. Treat it as a secret: do not paste it in a chat, a commit or a document.
2. Create an empty scratch database on the local server. Its name must start with `restore`:

   ```
   docker exec supabase_db_Friend_app psql -U postgres -c "create database restore_scratch"
   ```

3. Run the check (in Git Bash, from the repository folder). The connection strings stay in the shell and are not saved anywhere:

   ```
   export RESTORE_SOURCE_DB_URL='<the hosted connection string, percent-encoded>'
   export RESTORE_TARGET_DB_URL='postgresql://postgres:postgres@127.0.0.1:55322/restore_scratch'
   bash scripts/restore-check.sh
   ```

   The hosted password must be percent-encoded in the URL (for example `@` becomes `%40`).
4. Read the last lines. `restore-check: OK` means the backup data can be restored and matches. Write the result in the table below.
5. Drop the scratch database:

   ```
   docker exec supabase_db_Friend_app psql -U postgres -c "drop database restore_scratch with (force)"
   ```

`bash scripts/restore-check.sh --compare-only` skips the dump and restore and only compares the two databases again.

### Good to know

- The script refuses to restore into a database whose name does not start with `restore`, into a database that already has tables, and into the source itself. It cannot damage the live project.
- A scratch database is not a Supabase project. The script adds the few Supabase objects the app refers to (`auth.users`, `auth.uid()` and similar, `storage.foldername`, the realtime publication). Accounts (`auth` data) and stored files are therefore not part of this check; the row counts cover everything in `public`, `importer`, `private` and `search`.
- The roles file is dumped but not applied by default: roles belong to the whole server, not to the scratch database. Set `RESTORE_ROLES=1` to apply it; only "already exists" errors are then tolerated.
- Scheduled jobs (`cron.job`) are shown for information only. A dump does not contain them (migrations create them), and pg_cron can only live in the `postgres` database, so the scratch database has none. After a real dashboard restore, check them as in section 2.
- Every table is compared with an exact row count, so a copy taken while people use the app can differ by a few rows. Run it at a quiet hour, or run it again.
- Test it yourself: `RESTORE_TEST=1 npm run scripts:test` creates the scratch database `restore_test` on local Supabase, restores into it, then empties a table and checks that the script notices. Without `RESTORE_TEST` that test is skipped, as in CI.

## 4. Restore tests

Fill in one line each time you run the check.

| Date | Who | Result |
| --- | --- | --- |
|  |  |  |
|  |  |  |
|  |  |  |
