# BiletFlow

Event ticketing for Kazakhstan: attendees discover events in Kazakh, Russian or English, pay in tenge (simulated payment), and enter with a signed QR ticket. Organizers create events and ticket types, activate paid sales, run promo campaigns and read live analytics. Event staff check tickets in on a phone.

This repository holds the **FastAPI backend** (`backend/`) and the **React web app** (`frontend/`). The phone scanner app is a separate repository: [popeyes-biletflow/biletflow_mobile](https://github.com/popeyes-biletflow/biletflow_mobile). Both talk to the same backend; the database is Supabase (PostgreSQL + Auth).

| Part | Where | Stack |
| --- | --- | --- |
| API | `backend/` | FastAPI, supabase-py, HMAC-signed QR tickets |
| Web app | `frontend/` | React, TypeScript, Vite, Tailwind, i18next (KK/RU/EN) |
| Database | `backend/migrations/` | Supabase PostgreSQL, SQL migrations |
| Mobile scanner | [biletflow_mobile](https://github.com/popeyes-biletflow/biletflow_mobile) | Expo / React Native |

## What is simulated

Payments, the identity check and the activation fee are simulated (`MockPay`, rows marked `simulated = true`). No real money moves and no real card data is stored.

## Run it locally

You need Python 3 (the tests were run on 3.13), Node 20+, and a Supabase project (URL, anon key, and optionally the service-role key).

1. **Database.** Apply the files in `backend/migrations/` in the order given in [docs/data-model.md](docs/data-model.md) (`000_base_schema.sql` first), using the Supabase SQL editor. Then paste [docs/pre-demo-db-check.sql](docs/pre-demo-db-check.sql); every row must be `true`.
2. **Backend.**
   ```bash
   cd backend
   cp .env.example .env        # fill SUPABASE_URL, SUPABASE_KEY, QR_SECRET (long random value)
   python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```
   API docs: <http://localhost:8000/docs>. Never commit `.env`; `QR_SECRET` signs every ticket.
3. **Web app.**
   ```bash
   cd frontend
   cp .env.example .env        # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL=http://localhost:8000
   npm install
   npm run dev                 # http://localhost:5173
   ```
4. **Demo data (optional).** `backend/migrations/seed_events.sql` and `seed_events_batch2.sql` add demo events and ticket types. Edit the organizer email at the top of the first file to an organizer account you created.
5. **Mobile scanner.** See the mobile repository's README. Point `EXPO_PUBLIC_API_URL` at this backend (use the computer's LAN address for a physical phone).

## Accounts and roles

Create users on the sign-up page, then set `profiles.role` to one of `attendee` (default), `organizer`, `event_admin` or `platform_admin`. An `event_admin` only sees events they are **assigned to**: the organizer assigns them in the mobile app (*Manage event > Check-in staff*) or through `POST /api/organizer/events/{id}/staff` (optional `can_undo`, default `true`). The web app has no staff-assignment screen. Use synthetic email addresses for demos.

## Tests

| What | Command | What it checks |
| --- | --- | --- |
| Backend API | `cd backend && python -m pytest -q` | Auth and roles, checkout, orders, refunds, promo campaigns, tickets, mobile scanner endpoints, support, analytics (in-memory database) |
| Web app | `cd frontend && npm test` | CSV export and event helpers |
| Web build | `cd frontend && npm run build` | TypeScript and production bundle |
| Migrations on PostgreSQL | `backend/tests/sql/run_migration_checks.sh` | Atomic check-in (20 simultaneous scans, one admission), staff access, undo permission, paid-sales guard. Needs PostgreSQL server binaries |
| Fresh database | `backend/tests/sql/run_fresh_install_check.sh` | An empty database rebuilds from `backend/migrations/` twice without error and passes the pre-demo check |

The backend tests use an in-memory stand-in for Supabase, so they do not exercise the real database; the two SQL scripts cover that part, and the live acceptance run in [docs/evidence/live-acceptance-2026-11-23.md](docs/evidence/live-acceptance-2026-11-23.md) covers the deployed project. Per-feature evidence is in `docs/evidence/`.

## How check-in works

The QR code holds `ticket id : event id : user id : expiry : HMAC signature`. The scanner sends it to the API, which verifies the signature and expiry, checks that the caller is the event's organizer, a platform admin or assigned staff, and then calls the database function `checkin_ticket_atomic`. That function locks the ticket row and admits it once; a second scan gets `409 Ticket has already been used`. Refunded and cancelled tickets are refused. Undo (`POST /api/tickets/undo-checkin`) needs the organizer, an admin, or staff whose assignment has `can_undo`. Scanning needs a connection: there is no offline admission.

## Known limitations

- Payments and payouts are simulated; no real payment provider is integrated.
- Row-level security is disabled on several tables in the live project (see [docs/data-model.md](docs/data-model.md) section 9). The API authorizes every request, but the tables are readable with the public anon key.
- `backend/migrations/000_base_schema.sql` is rebuilt from table metadata, not a `pg_dump`.
- The attendee list in the mobile scanner returns the first 50 matches without paging.
- Frontend unit tests cover only CSV and event helpers; the screens are checked by the browser runs recorded in `docs/evidence/`.

## Documentation

- [docs/data-model.md](docs/data-model.md): migration order, data ownership, API shapes, recovery.
- [docs/pre-demo-db-check.sql](docs/pre-demo-db-check.sql): read-only database readiness check.
- [docs/demo-run-checklist.md](docs/demo-run-checklist.md): the end-to-end demo journey with result fields.
- [docs/evidence/](docs/evidence/): per-feature evidence and the live acceptance run.
