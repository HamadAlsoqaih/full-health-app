#!/usr/bin/env bash
# Applies 0001_init.sql to a throwaway Postgres database and exercises its
# constraints and row-level security policies.
#
# RLS is the one protection the credential-free Vitest suite cannot cover — there
# is no live Postgres there to evaluate auth.uid() against. This script closes
# that gap. It needs a reachable Postgres and nothing else; no Supabase project,
# no credentials, no network.
#
#   Local:  ./backend/supabase/verify-migration.sh
#   CI:     runs against the postgres service container (see ci.yml)
#
# Connection comes from the standard PG* variables, defaulting to a local server.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="${VERIFY_DB:-fha_schema_verify}"

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"

echo "==> Recreating database '$DB' on $PGHOST:$PGPORT"
psql -q -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists $DB" >/dev/null
psql -q -d postgres -v ON_ERROR_STOP=1 -c "create database $DB" >/dev/null

echo "==> Applying Supabase stand-ins (auth schema, auth.uid(), roles)"
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/test-prelude.sql"

echo "==> Applying migrations"
for f in "$HERE"/migrations/*.sql; do
  echo "    $(basename "$f")"
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f"
done

echo "==> Verifying constraints and row-level security"
# Notices carry the PASS lines; an assertion failure raises and -v ON_ERROR_STOP aborts.
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/verify-schema.sql" 2>&1 |
  grep -E '^(NOTICE|ERROR|psql)' |
  sed -E 's/^NOTICE:  //'

echo "==> Schema verification passed"
