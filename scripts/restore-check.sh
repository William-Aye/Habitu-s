#!/usr/bin/env bash
# Backup restore check: dump the source database, restore it into an empty scratch database and
# prove the two match (row count per public table, RLS, extensions, categories). Runbook:
# docs/ops/backup-restore.md.
#
# Usage:   RESTORE_SOURCE_DB_URL=... RESTORE_TARGET_DB_URL=... scripts/restore-check.sh [--compare-only]
# Exit:    0 the two databases match; 1 they differ (differences are printed); 2 setup or restore error.
#
# Connection strings are read from the environment only and are never printed (all output is masked).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
check_sql="$here/restore-check.sql"
compare_only=0
case "${1:-}" in
  '') ;;
  --compare-only) compare_only=1 ;;
  *) echo "restore-check: unknown argument (only --compare-only is supported)" >&2; exit 2 ;;
esac

src="${RESTORE_SOURCE_DB_URL:-}"
dst="${RESTORE_TARGET_DB_URL:-}"
if [ -z "$src" ] || [ -z "$dst" ]; then
  echo "restore-check: set RESTORE_SOURCE_DB_URL and RESTORE_TARGET_DB_URL" >&2
  exit 2
fi
export RC_MASK_A="$src" RC_MASK_B="$dst"

# Replace every occurrence of a connection string (and its password) in the text that passes through.
mask() {
  awk '
    function rep(s, needle,   out, i) {
      if (needle == "") return s
      out = ""
      while ((i = index(s, needle)) > 0) { out = out substr(s, 1, i - 1) "***"; s = substr(s, i + length(needle)) }
      return out s
    }
    function pw(u,   m) { if (match(u, /\/\/[^:@\/]*:[^@]*@/)) { m = substr(u, RSTART, RLENGTH); sub(/^\/\/[^:]*:/, "", m); sub(/@$/, "", m); return m } return "" }
    BEGIN { a = ENVIRON["RC_MASK_A"]; b = ENVIRON["RC_MASK_B"]; pa = pw(a); pb = pw(b) }
    { $0 = rep($0, a); $0 = rep($0, b); $0 = rep($0, pa); $0 = rep($0, pb); print }
  '
}
die() { echo "restore-check: $*" | mask >&2; exit 2; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# --- psql: the host client if there is one, else the one inside the local Supabase DB container ---
psql_mode=host
container=""
if ! command -v psql >/dev/null 2>&1; then
  command -v docker >/dev/null 2>&1 || die "psql is not installed (install the PostgreSQL client, or Docker with local Supabase running)"
  container="${RESTORE_PSQL_CONTAINER:-$(docker ps --format '{{.Names}}' 2>/dev/null | grep '^supabase_db_' | head -n 1 || true)}"
  [ -n "$container" ] || die "psql is not installed and no supabase_db_* container is running"
  psql_mode=docker
fi

# Inside the container the local server listens on 5432, not on the published port.
container_url() {
  case "$1" in
    *@127.0.0.1:*/*|*@localhost:*/*|*@\[::1\]:*/*) printf '%s' "$1" | sed -E 's#@(127\.0\.0\.1|localhost|\[::1\]):[0-9]+/#@127.0.0.1:5432/#' ;;
    *) die "psql is not installed and this database is not on this machine; install the PostgreSQL client" ;;
  esac
}

psql_run() { # psql_run <url> <psql args...>; SQL comes on stdin
  local url="$1"; shift
  if [ "$psql_mode" = host ]; then
    psql "$url" -X "$@"
  else
    local cu; cu="$(container_url "$url")"
    RC_PGURL="$cu" MSYS_NO_PATHCONV=1 docker exec -i -e RC_PGURL "$container" sh -c 'exec psql "$RC_PGURL" -X "$@"' sh "$@"
  fi
}

# Run restore-check.sql on one database and print its output.
run_check() { psql_run "$1" -A -t -q -v ON_ERROR_STOP=1 -f - < "$check_sql"; }

dbname() { local u="${1%%\?*}"; printf '%s' "${u##*/}"; }
where()  { local u="${1%%\?*}"; u="${u#*@}"; printf '%s' "${u%%/*}/${u##*/}"; }

# Feed SQL from stdin to the target; stop at the first error (ON_ERROR_STOP) and show it, masked.
restore_sql() {
  if ! psql_run "$dst" -q -v ON_ERROR_STOP=1 -f - > "$tmp/restore.log" 2>&1; then
    mask < "$tmp/restore.log" >&2
    die "$1 restore failed"
  fi
}

if [ "$compare_only" -eq 0 ]; then
  # A restore replaces what is in the target, so insist it really is a scratch database.
  case "$(dbname "$dst")" in
    restore*) ;;
    *) die "the target database name must start with 'restore' (it is a scratch database)" ;;
  esac
  [ "$(where "$src")" != "$(where "$dst")" ] || die "source and target are the same database"
  n="$(printf "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')" \
        | psql_run "$dst" -A -t -q -v ON_ERROR_STOP=1 -f - 2>&1 | mask)" || die "cannot connect to the target: $n"
  [ "$n" = "0" ] || die "the target database is not empty (public has $n tables); create a fresh scratch database"

  echo "restore-check: dumping roles, schema and data from the source"
  dump() { # dump <name> <flags...>
    local name="$1"; shift
    npx supabase db dump --db-url "$src" "$@" -f "$tmp/$name.sql" 2>&1 | mask | grep -iE 'error|failed' >&2 || true
    [ -s "$tmp/$name.sql" ] || die "the $name dump is empty or failed"
  }
  dump roles --role-only
  dump schema
  dump data --data-only --use-copy --schema public,importer,private,search

  echo "restore-check: restoring into the scratch database"
  # A scratch database is not a Supabase project: add the few managed objects the app schema refers to
  # (every statement is a no-op where the real ones already exist).
  restore_sql "bootstrap" <<'SQL'
create schema if not exists extensions;
create schema if not exists vault;
create schema if not exists auth;
create schema if not exists storage;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select null::text $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select null::jsonb $$;
create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $$ select string_to_array(name, '/') $$;
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
SQL

  if [ "${RESTORE_ROLES:-0}" = "1" ]; then
    # Roles are cluster-wide. Only "already exists" is tolerated; anything else fails.
    out="$(psql_run "$dst" -q -f - < "$tmp/roles.sql" 2>&1 | mask || true)"
    bad="$(printf '%s\n' "$out" | grep 'ERROR' | grep -v 'already exists' || true)"
    [ -z "$bad" ] || die "roles restore failed: $bad"
  else
    echo "restore-check: roles file dumped but not applied (cluster-wide; set RESTORE_ROLES=1 to apply it)"
  fi

  # pg_cron can only be created in the database named by cron.database_name (postgres), so it is left out
  # of the scratch restore; the cron.job comparison is informational (see the runbook).
  sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pg_cron".*)$/-- \1/' "$tmp/schema.sql" > "$tmp/schema.restore.sql"
  restore_sql "schema" < "$tmp/schema.restore.sql"
  restore_sql "data" < "$tmp/data.sql"
fi

echo "restore-check: comparing source and target"
run_check "$src" > "$tmp/source.out" 2> "$tmp/source.err" || { mask < "$tmp/source.err" >&2; die "the check failed on the source"; }
run_check "$dst" > "$tmp/target.out" 2> "$tmp/target.err" || { mask < "$tmp/target.err" >&2; die "the check failed on the target"; }

# Logical dumps carry neither pg_cron nor its jobs (migrations schedule them), so those lines are shown
# but do not decide the result.
strict() { grep -v -E '^(cron |ext pg_cron$)' "$1" | tr -d '\r'; }
strict "$tmp/source.out" > "$tmp/source.strict"
strict "$tmp/target.out" > "$tmp/target.strict"

if diff -u --label source --label target "$tmp/source.strict" "$tmp/target.strict" > "$tmp/diff.out"; then
  tables="$(grep -c '^rows ' "$tmp/source.strict" || true)"
  echo "restore-check: OK - $tables tables, RLS, extensions and categories match"
  src_cron="$(grep -c '^cron ' "$tmp/source.out" || true)"
  tgt_cron="$(grep -c '^cron ' "$tmp/target.out" || true)"
  echo "restore-check: info - cron jobs: source $src_cron, target $tgt_cron (a logical restore does not carry pg_cron jobs)"
  exit 0
fi
echo "restore-check: MISMATCH between source and target" >&2
mask < "$tmp/diff.out" >&2
exit 1
