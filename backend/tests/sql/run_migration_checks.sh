#!/usr/bin/env bash
# Applies migrations 019 and 020 to a local PostgreSQL, runs migration_checks.sql, then 20 simultaneous scans.
# Needs PostgreSQL server binaries.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../../migrations"
PGBIN="$(pg_config --bindir 2>/dev/null || ls -d /usr/lib/postgresql/*/bin | tail -1)"
WORK="$(mktemp -d /tmp/biletflow-sqlcheck.XXXXXX)"
PORT="${PGPORT:-54399}"
chmod 755 "$WORK"
cp "$HERE"/*.sql "$MIGRATIONS"/008_staff_atomic_admission_moderation.sql \
   "$MIGRATIONS"/019_atomic_checkin_staff_access.sql "$MIGRATIONS"/020_paid_sales_guard.sql "$WORK"/
chmod 644 "$WORK"/*.sql

# PostgreSQL refuses to run as root: drop to the postgres user when needed.
if [ "$(id -u)" -eq 0 ]; then RUN() { su postgres -c "$*"; }; else RUN() { bash -c "$*"; }; fi
if [ "$(id -u)" -eq 0 ]; then chown postgres "$WORK"; fi

cleanup() { RUN "$PGBIN/pg_ctl -D $WORK/data stop -m immediate >/dev/null 2>&1" || true; rm -rf "$WORK"; }
trap cleanup EXIT

RUN "$PGBIN/initdb -D $WORK/data -A trust >/dev/null"
RUN "$PGBIN/pg_ctl -D $WORK/data -o '-p $PORT -k $WORK' -l $WORK/log -w start >/dev/null"
PSQL="$PGBIN/psql -h $WORK -p $PORT -v ON_ERROR_STOP=1 -q"
RUN "$PSQL -d postgres -c 'create database t'"
RUN "$PSQL -d t -f $WORK/stub_supabase.sql"
# 008 also creates tables the stand-ins do not model; only its two functions are needed here.
awk '/CREATE OR REPLACE FUNCTION checkin_ticket_atomic/{p=1} p' "$WORK/008_staff_atomic_admission_moderation.sql" > "$WORK/008_functions.sql"
chmod 644 "$WORK/008_functions.sql"
RUN "$PSQL -d t -f $WORK/008_functions.sql"
for pass in 1 2; do   # twice: the migrations must be re-runnable
  RUN "$PSQL -d t -f $WORK/019_atomic_checkin_staff_access.sql 2>&1 | grep -v NOTICE || true"
  RUN "$PSQL -d t -f $WORK/020_paid_sales_guard.sql 2>&1 | grep -v NOTICE || true"
done
echo "migrations applied twice without error"

if ! RUN "$PSQL -d t -f $WORK/migration_checks.sql 2>&1" > "$WORK/checks.out"; then
  cat "$WORK/checks.out"; echo "migration checks FAILED"; exit 1
fi
grep -E "PASS|^==" "$WORK/checks.out" | sed 's/^psql:[^ ]* NOTICE:  //'

RUN "$PSQL -d t -c \"insert into tickets(id,event_id,user_id,status) values ('00000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000f1','valid')\""
RESULTS="$WORK/results.txt"; : > "$RESULTS"; chmod 666 "$RESULTS"
for i in $(seq 20); do
  RUN "$PSQL -At -d t -f $WORK/scan_once.sql | tail -1 >> $RESULTS" &
done
wait
echo "20 simultaneous scans of one ticket:"; sort "$RESULTS" | uniq -c
ADMITTED="$(grep -c '^ADMITTED$' "$RESULTS")"
[ "$ADMITTED" -eq 1 ] || { echo "FAIL: expected exactly 1 admission, got $ADMITTED"; exit 1; }
echo "PASS: exactly one admission"
