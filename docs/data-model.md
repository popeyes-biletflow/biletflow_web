# BiletFlow data model, migrations and API shapes

Owner: Ibragim Mukashev. Currency: KZT only, whole tenge, no real card data (all payments and refunds are simulated).

## 1. Migration order

The migrations alter tables that predate them (`profiles`, `events`, `ticket_types`, `orders`, `tickets`). The base schema of those tables is not stored in the repository (see section 9), so a fresh database first needs the base tables from the Supabase project, then the files below in this exact order:

| # | File | Purpose |
|---|---|---|
| 1 | `pb8_events_columns.sql` | event columns used by discovery (category, starts_at, venue_name, ...) |
| 2 | `events_ticket_types.sql` | event status/visibility/capacity, ticket type columns |
| 3 | `001_support_cases.sql` | support cases and messages |
| 4 | `002_paid_sales_activation.sql` | paid-sales flags, `payments`, `audit_log`, `activate_paid_sales` |
| 5 | `pb19_orders_pricing_and_analytics.sql` | legacy order price columns, organizer read policies |
| 6 | `003_campaigns_orders.sql` | campaigns, promo codes, scans, holds, order columns, order status constraint |
| 7 | `004_checkout_rpc.sql` | `create_ticket_hold`, `finalize_order`, `create_campaign`, `register_campaign_scan` |
| 8 | `005_campaign_stats.sql` | `campaign_stats` |
| 9 | `006_promo_lookup.sql` | `lookup_promo_code` |
| 10 | `007_history_duplicate.sql` | `event_history`, `duplicate_event` |
| 11 | `008_staff_atomic_admission_moderation.sql` | staff, notifications, atomic check-in |
| 12 | `009_fs17_checkout.sql` | idempotent `finalize_order`, attendee data, `release_ticket_hold` |
| 13 | `010_fs20_notifications.sql` | notification dedupe, email outbox |
| 14 | `011_refunds.sql` | `refunds`, `events.refund_policy` |
| 15 | `012_refund_order.sql` | atomic `refund_order` |
| 16 | `013_campaign_upgrade.sql` | discount type/value, tier scope, disabled flag |
| 17 | `014_campaign_logic.sql` | `create_campaign_v2`, `set_campaign_disabled`, new `create_ticket_hold` |
| 18 | `015_organizer_finance.sql` | `organizer_payout_estimate`, `organizer_attendees` |
| 19 | `016_event_metrics_activity.sql` | `event_metrics`, `event_activity`, audit_log is read-only for clients |
| 20 | `017_followups.sql` | `duplicate_event` copies refund policy, legacy order reconciliation |
| 21 | `seed_events.sql` | demo events and tiers (idempotent, edit the organizer email first) |

All files are idempotent (`if not exists`, `create or replace`) and safe to re-run.

## 2. Data ownership and access

Writes to money and inventory tables happen only inside `SECURITY DEFINER` functions that check `auth.uid()`. Clients never write these tables directly.

| Table | Written by | Read by |
|---|---|---|
| `events`, `ticket_types` | organizer API (owner only) | public (published), owner |
| `campaigns`, `promo_codes`, `campaign_scans` | `create_campaign_v2`, `set_campaign_disabled`, `register_campaign_scan` | RLS on, no direct policy: via RPC only |
| `ticket_holds` | `create_ticket_hold`, `finalize_order`, `release_ticket_hold` | the buyer (own holds) |
| `orders` | `finalize_order`, `refund_order` | buyer (own), organizer (own events) |
| `tickets` | `finalize_order`, `refund_order`, check-in functions | holder (own), organizer (own events) |
| `refunds` | `refund_order` | requester (own), organizer through metrics |
| `payments` | `activate_paid_sales`, `refund_order` | platform admin search |
| `audit_log` | RPCs and API, append only (update/delete revoked from clients) | organizer through `event_history` / `event_activity` |

## 3. Money model

- `subtotal = price x quantity`; `discount` = percent of subtotal or fixed KZT, never above subtotal.
- `fee = round(5% of (subtotal - discount))`, added on top, kept by the platform.
- `total = subtotal - discount + fee`.
- Organizer payout estimate = `sum(subtotal - discount)` over paid, non-refunded orders.
- A refund returns the full `total` including the fee; `refunds.fee_refunded_kzt` shows the fee part.
- Free orders: total 0, status `completed`, no payment record.

## 4. Status contracts

- Ticket: `valid` -> `checked_in`; `refunded` (paid order) or `cancelled` (free order). Admission rejects `refunded` and `cancelled`.
- Order: `paid` / `completed` -> `refunded` (paid) or `cancelled` (free).
- Hold: `active` -> `converted` | `released` | `expired`.
- Inventory: free seats = `quantity - tickets in (valid, checked_in) - active unexpired holds`. Changing a ticket status releases the seat exactly once; no counter is decremented.
- Promo redemptions = orders in (`paid`, `completed`) with the code + active holds, so a refund frees the redemption.

## 5. API shapes (organizer and checkout)

| Endpoint | Notes |
|---|---|
| `POST /api/checkout/apply-promo` | `{ticket_type_id, quantity, code?}` -> hold with `subtotal_kzt, discount_kzt, discount_type, discount_percent, fee_kzt, total_kzt, hold_expires_at` |
| `POST /api/orders` | `{hold_id, currency, payment_outcome, attendees[]}`; retrying the same hold returns the same order |
| `POST /api/me/orders/{id}/refund` | `{reason?}` -> `{refund_id, amount_kzt, fee_refunded_kzt, ticket_ids, status, already_refunded}` |
| `POST /api/organizer/orders/{id}/refund` | organizer of the event, bypasses the refund policy for other people's orders |
| `PATCH /api/organizer/events/{id}/refund-policy` | `none`, `full_until_start`, `full_24h_before` |
| `POST /api/campaigns` | `discount_type` (`percent` / `fixed_kzt`), `discount_value`, optional `ticket_type_id`; returns `qr_link` |
| `PATCH /api/campaigns/{id}/disabled` | `{disabled}` |
| `GET /c/{slug}` | records a visit, redirects to the event with `?promo=CODE`; disabled/expired links return 404 |
| `GET /api/organizer/campaigns/stats` | visits, orders, discounts, net per campaign |
| `GET /api/organizer/payout-estimate?event_id=` | gross, discounts, fees, captured, refunded, estimated payout |
| `GET /api/organizer/events/{id}/attendees` | `status`, `limit`, `offset` |
| `GET /api/organizer/events/{id}/metrics` | capacity, attendance, revenue with refunds, daily series, tiers, campaigns; filters `date_from`, `date_to`, `ticket_type_id` |
| `GET /api/organizer/events/{id}/activity` | audit timeline, filters `action`, `date_from`, `date_to`, `limit`, `offset` |
| `GET /api/organizer/events/{id}/history` | full timeline, oldest first |
| `POST /api/organizer/events/{id}/duplicate` | new draft with tiers and refund policy; no orders, tickets, check-ins, campaigns, support cases or history |
| `GET /api/organizer/analytics` | alias of the PB-19 dashboard / event analytics |

Common errors: `NOT_EVENT_OWNER` 403, `EVENT_NOT_FOUND` 404, `SOLD_OUT` 409, `PROMO_NOT_FOUND` 404, `PROMO_DISABLED` / `PROMO_EXPIRED` / `PROMO_NOT_STARTED` / `PROMO_WRONG_TIER` / `PROMO_EXHAUSTED` 400, `REFUND_NOT_ALLOWED` 403, `REFUND_WINDOW_CLOSED` / `TICKET_ALREADY_USED` / `ORDER_NOT_REFUNDABLE` 409.

## 6. Existing rows (reconciliation)

Orders created before the checkout rewrite have no `event_id`, `ticket_type_id`, `quantity`, `subtotal_kzt`. `017_followups.sql` fills them from `tickets` and from the legacy columns. Run before and after and record the numbers:

```sql
select count(*) as orders_total,
       count(*) filter (where event_id is null) as without_event,
       count(*) filter (where subtotal_kzt is null) as without_amounts
from orders;
```

Before: `orders_total = 7`, `without_event = 3`, `without_amounts = 3`.
After: `orders_total = 7`, `without_event = 1`, `without_amounts = 0`.
Orders that have no tickets stay without an event and are excluded from organizer metrics.

## 7. SQLite demo data

Before the migration the demo promo/order data lived in `backend/promo.db` (SQLite, tracked by mistake): two ticket types (Standard 5000 KZT, VIP 15000 KZT), campaigns, promo codes and test orders. They were local test fixtures and were not linked to real events or organizers, so they are not imported.

- Reseeded: the two tiers are replaced by the tiers in `seed_events.sql`.
- Recoverable: the file is still in git history.

```bash
git log --diff-filter=D --format=%h -- backend/promo.db
git show <hash>^:backend/promo.db > promo_old.db
sqlite3 promo_old.db "select * from campaigns;"
```
Old campaigns can be recreated through `POST /api/campaigns`, because a Supabase campaign needs an event and an organizer that SQLite never had.

## 8. Checks and recovery

Actor-based isolation check (run in the Supabase SQL editor, replace the ids; the second call must fail with `NOT_EVENT_OWNER`):

```sql
select set_config('request.jwt.claims', '{"sub":"<OWNER_ID>","role":"authenticated"}', true),
       event_metrics('<EVENT_ID>');
select set_config('request.jwt.claims', '{"sub":"<OTHER_ORGANIZER_ID>","role":"authenticated"}', true),
       event_metrics('<EVENT_ID>');
```

Recovery: every migration can be re-run. To undo a refund test, set the order and tickets back to `paid` / `valid` and delete the row from `refunds` (and its `payments` / `audit_log` rows). Before any change on staging, take a backup (`pg_dump` or the Supabase dashboard backup).

## 9. Known gaps

- The base schema (`profiles`, `events`, `ticket_types`, `orders`, `tickets` before the migrations) is not in the repository. Export it with `pg_dump --schema-only` and add it as `000_base.sql` before claiming a clean fresh-database apply.
- The PB-19 dashboard reads legacy order columns (`subtotal_amount`, `discount_amount`, `fee_amount`, `promo_code`), so checkout-created orders show zero discounts there. The exact numbers are in `GET /api/organizer/events/{id}/metrics`.
- Concurrency (two buyers for the last ticket or last redemption) is guaranteed by row locks in the database functions; it was checked by reading the functions and by manual tests, not by an automated parallel test.