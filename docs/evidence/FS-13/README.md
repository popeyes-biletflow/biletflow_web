# FS-13 evidence: paid-sales activation and campaigns

Base: `feature/FS-12-organizer-editor`. Depends on open PR #26 (campaign upgrade) for fixed-KZT, tier scope and disable; not merged and not assumed deployed.

## Pre-existing (not new work)
Activation request and checklist errors (`POST /api/organizer/events/{id}/activate-paid-sales`, PB-16), payout save, suspended/active presentation, admin fee setting, percent campaign creation, `/c/{slug}` redirect, `campaign_stats` RPC, hold-based server discount quote at checkout (FS-17).
Fixed-KZT / tier-scoped / disable campaign logic belongs to #26 (ibragim-m) and is not reimplemented here.

## Changes in this ticket
| File | Change |
|---|---|
| `backend/routers/organizer.py` | `GET /api/organizer/events/{id}/activation`: owner-checked, returns the real activation fee, paid-tier and payout state, active state, and flags identity/fee as simulated. Organizers no longer need the admin fee endpoint. |
| `backend/orders.py` | `campaigns/stats` rows now include tracking link, start/expiry, disabled flag, discount type/value, tier scope and a computed state (active / scheduled / expired / disabled). Works with the current schema; extra fields appear once #26's columns exist. |
| `backend/tests/test_fs13_activation_campaigns.py` | 5 tests: fee and checklist, active state, denial (other organizer, attendee), campaign link/state. |
| `PaidSalesActivation.tsx` | Fee from the backend (no 5000 constant); identity shown as a demo item from backend state, not a local pass; activate disabled until the fee is known; status error with retry. |
| `CampaignManager.tsx` (new tab "Campaigns") | Create (percent works on `main`), list with state, redemptions vs limit, link visits, discount given, net revenue; copy link; downloadable QR PNG; destination text; validation that keeps inputs. Fixed-KZT, tier scope and enable/disable are enabled only when the backend's `/openapi.json` exposes `PATCH /api/campaigns/{id}/disabled`; otherwise a notice explains why. |
| `services/organizer.ts`, locales | Client methods and types; strings in kk/ru/en. |

## Commands run
| Command | Result |
|---|---|
| `pytest -q` (backend) | 157 passed |
| `npm run build` | exit 0 |
| `npm run lint` | exit 0, no warnings in new/changed files |
| `node docs/evidence/FS-13/browser-check.js` (Playwright, Vite dev, **stubbed API**) | 23/23 PASS in both backend modes (with and without upgrade); also covers FS-12 tier counts and cross-organizer URL |

## Acceptance
| Criterion | Status |
|---|---|
| Activation checklist reflects backend state; fee from backend | PASS (API tests; stubbed UI) |
| Demo verification/fee labelled as simulated | PASS |
| Terms acceptance persisted per event | NOT DONE: terms live in the activation request only; persisting needs a new column and migration (not applied) |
| Campaign percent / fixed-KZT, scope, expiry | percent: PASS (stubbed); fixed/scope: BLOCKED on #26 |
| Saved disabled / expired state | PASS in stats API tests; disable action BLOCKED on #26 |
| Copy link, downloadable trackable QR | PASS (stubbed); real redirect and discount quote NOT RUN against a live server |
| Server discount quote | existing checkout hold flow, not re-verified here |

## Known gaps
- Partial activation progress is not persisted server-side (see above).
- Link visits and redemptions are shown as the backend reports them; #26 separates visits from redemptions more strictly.
- The `/openapi.json` probe returns "unsupported" if the API hides its schema.
