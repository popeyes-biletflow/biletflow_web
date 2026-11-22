# FS-15 evidence: admin web console

Base: `feature/FS-14-organizer-operations`. Backend contract: `backend/routers/admin.py` (FS-03, Baibol Makhatuly). The shared-file fixes below are narrow and should be reviewed by the owner.

## Pre-existing (not new work)
All `/api/admin/*` endpoints and `require_platform_admin` (403 for any other role), suspension of events/users, fee setting, operational export. The support case API, which lets `platform_admin` open any case.

## Backend fixes needed to expose the console safely (`routers/admin.py`, `schemas.py`)
| Issue found in source review | Fix | Test |
|---|---|---|
| Event unsuspend set paid sales ACTIVE for every event, even ones that never activated (paid tickets would become purchasable without activation) | Restores ACTIVE only if a completed simulated activation payment exists, otherwise NONE | `test_unsuspend_*` |
| Audit writes were swallowed; success did not mean a recorded audit entry | Responses carry `audit_recorded`; UI shows a warning when false | `test_suspend_reports_when_the_audit_write_failed` |
| Suspension reason optional | Reason (3+ chars) required server-side for user and event suspension | `test_suspend_requires_a_reason...` |
| Search endpoints capped at 100 with no offset | `offset` added, newest first; payments gain `status` filter | `test_lists_support_offset...`, `test_payments_can_be_filtered...` |
| Export revenue summed only `completed` orders (new checkout writes `paid`) | Counts `paid` and `completed` | `test_export_revenue...` |

## Frontend
| File | Change |
|---|---|
| `pages/admin/AdminConsole.tsx` | Tabs: Users, Events, Orders, Payments, Support, Campaigns, Settings. Search/filters, paging (50), stale-response guard, suspend with required reason, unsuspend, audit warning, support links to `/support/{id}`, paid-sales filter, failed-payment filter, fee change with confirmation, events/orders CSV export (ids, status, amounts, dates only; no emails/payout/user ids). |
| `hooks/useAdminList.ts`, `services/admin.ts` | Keyed list loader and typed client. |
| `App.tsx` | `/admin` route (`RequireAuth roles=['platform_admin']`), nav link for `platform_admin` only. |
| locales | kk/ru/en strings. |

## Commands run
| Command | Result |
|---|---|
| `pytest -q` (backend) | 167 passed (149 baseline + 18 new across FS-12/13/15) |
| `npm run build` | exit 0 |
| `npm test` | 12 passed |
| `npm run lint` | exit 0; 10 warnings, same count as untouched `main`, none in new files |
| `node docs/evidence/FS-15/browser-check.js` (Playwright, Vite dev, **stubbed API**) | 18/18 PASS (attendee, organizer, platform_admin) |

## Acceptance
| Criterion | Status |
|---|---|
| Protected nav/routes | PASS in UI (stubbed). The UI guard is not the control: the server check is proven by `test_non_admins_are_denied_everywhere` (attendee and organizer get 403 on every admin endpoint) |
| Search users/events/orders/payments with paging | PASS (UI stubbed; API tests). Orders/payments filters differ per endpoint (orders: status, user id; payments: status, event id) |
| Reported events / support escalations open the right thread | PASS (link to `/support/{id}`, stubbed). Disputes are the same support cases |
| Activation review | PARTIAL: read-only state via the paid-sales filter; the platform has no manual approval workflow |
| Campaigns | BLOCKED: no admin campaign API exists; the tab says so |
| Fee settings affect documented activation | PASS at API level: fee set here is what `GET /api/organizer/events/{id}/activation` and activation use (`platform_settings`); not run end-to-end |
| Exports | PASS (minimized columns, stubbed) |
| Failed-payment / suspension state | PASS (payments `status` filter, suspended badges) |
| Suspend with reason, audit verified, backend sales blocking | Reason + audit flag: PASS (API tests). Sales blocking: existing test `test_final_sprint_fs01_fs05.py` (admin suspends event, purchase refused) |
| Real browser run against a live backend and database | NOT RUN |

## Known gaps
- Users search is substring over all rows fetched by the API (the endpoint loads then filters); fine at demo scale.
- Admin export endpoint still returns full records; the console only writes minimized columns, but the API response itself includes them.
- No event-level "reported" flag exists; reports are support cases.
