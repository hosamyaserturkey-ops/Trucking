#!/usr/bin/env bash
# Apply all migrations, the demo seed and the SQL tests to a throwaway local
# Postgres database. Needs a running local Postgres; set PGHOST/PGPORT/PGUSER.
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres pnpm db:test
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${TEST_DB:-trucking_test}"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "ok  $1"; }
run supabase/tests/_shim.sql
for f in supabase/migrations/*.sql; do run "$f"; done
if [ "${SKIP_SEED:-0}" != "1" ]; then run supabase/seed.sql; fi
status=0
for f in supabase/tests/[0-9]*.sql; do
  if out=$(psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1); then echo "ok  $f"; else echo "FAIL $f"; status=1; fi
  echo "$out" | grep -E 'PASS|FAIL|ERROR' | sed -E 's/^.*(NOTICE|ERROR):  /    /'
done
exit $status
