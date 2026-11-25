#!/usr/bin/env bash
# Applies every migration to an empty local PostgreSQL twice, then runs docs/pre-demo-db-check.sql.
# Needs PostgreSQL server binaries.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../../migrations"
CHECK="$HERE/../../../docs/pre-demo-db-check.sql"
PGBIN="$(pg_config --bindir 2>/dev/null || ls -d /usr/lib/postgresql/*/bin | tail -1)"
WORK="$(mktemp -d /tmp/biletflow-fresh.XXXXXX)"
PORT="${PGPORT:-54398}"
ORDER=(000_base_schema pb8_events_columns events_ticket_types 001_support_cases 002_paid_sales_activation
  pb19_orders_pricing_and_analytics 003_campaigns_orders 004_checkout_rpc 005_campaign_stats 006_promo_lookup
  007_history_duplicate 008_staff_atomic_admission_moderation 009_fs17_checkout 009_ticket_types_rls_policies
  010_events_nullable_event_date 010_fs20_notifications 011_refunds 012_refund_order 013_campaign_upgrade
  014_campaign_logic 015_organizer_finance 016_event_metrics_activity 017_followups
  018_admin_moderation_and_campaign_policies 019_atomic_checkin_staff_access 020_paid_sales_guard)

chmod 755 "$WORK"
cp "$MIGRATIONS"/*.sql "$HERE/fresh_install_stub.sql" "$CHECK" "$WORK"/
chmod 644 "$WORK"/*.sql
if [ "$(id -u)" -eq 0 ]; then RUN() { su postgres -c "$*"; }; chown postgres "$WORK"; else RUN() { bash -c "$*"; }; fi
cleanup() { RUN "$PGBIN/pg_ctl -D $WORK/data stop -m immediate >/dev/null 2>&1" || true; rm -rf "$WORK"; }
trap cleanup EXIT

RUN "$PGBIN/initdb -D $WORK/data -A trust >/dev/null"
RUN "$PGBIN/pg_ctl -D $WORK/data -o '-p $PORT -k $WORK' -l $WORK/log -w start >/dev/null"
PSQL="$PGBIN/psql -h $WORK -p $PORT -q"
RUN "$PSQL -d postgres -c 'create database f'"
RUN "$PSQL -v ON_ERROR_STOP=1 -d f -f $WORK/fresh_install_stub.sql"

fail=0
for pass in 1 2; do
  for m in "${ORDER[@]}"; do
    errors="$(RUN "$PSQL -d f -f $WORK/$m.sql 2>&1 | grep -E 'ERROR|FATAL' || true")"
    if [ -n "$errors" ]; then echo "pass $pass  $m.sql: $errors"; fail=1; fi
  done
  echo "pass $pass: ${#ORDER[@]} files applied"
done
[ "$fail" -eq 0 ] || { echo "FAIL: migration errors above"; exit 1; }

RUN "$PSQL -At -F ' | ' -d f -f $WORK/pre-demo-db-check.sql" > "$WORK/check.out" 2>&1 || true
cat "$WORK/check.out"
if grep -q ' | f$' "$WORK/check.out" || ! grep -q ' | t$' "$WORK/check.out"; then
  echo "FAIL: pre-demo check has a false row"; exit 1
fi
echo "PASS: fresh install applies twice without error and the pre-demo check is all true"
