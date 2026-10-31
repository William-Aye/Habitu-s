-- DB-1 (pre-launch security review): activities.welcome_member_id names a member of the activity,
-- and membership is never public (spec 18.1). get_activity already shows the welcome person to
-- members only; the table itself let anyone (anon included) read the column. The table-level SELECT
-- becomes a column grant of every other column, for anon and authenticated alike. Nothing in the app
-- or the web pages reads the column directly: the organiser writes it, get_activity reads it.
--
-- Keep in mind: a column added to activities later is NOT readable by anon or authenticated until
-- a migration grants it (column grants do not cover new columns).
revoke select on public.activities from anon, authenticated;

do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'activities' and column_name <> 'welcome_member_id';
  execute format('grant select (%s) on public.activities to anon, authenticated', v_cols);
end $$;
