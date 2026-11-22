# FS-12 evidence: organizer event and tier editor

Base: `feature/FS-11-discovery-release` (stacked on `main` `7a89773`).

## Pre-existing (not new work)
Draft create/edit, preview, publish/unpublish/cancel, visibility/capacity/registration windows, free/paid
tier create/edit/hide, role-gated routes (`RequireAuth roles=['organizer']`), backend owner checks
(`load_owned_event`), event lifecycle tests (`test_pb18.py`). PB-13 / PB-18.

## Changes in this ticket
| File | Change |
|---|---|
| `backend/main.py` | Organizer ticket-type list now also returns `reserved` (unexpired active holds), `refunded`, `checked_in` per tier. Ownership is checked before the service client reads holds. Existing `sold` / `available` unchanged. |
| `backend/tests/test_fs12_tier_counts.py` | Counts, other-organizer denial (403), attendee denial (403). |
| `frontend/src/components/organizer/TicketTypeManager.tsx` | Shows available / reserved / sold / refunded / checked-in per tier. |
| `frontend/src/pages/EventManagePage.tsx` | A 403/404 from another organizer's event URL shows "does not exist or you do not manage it", not a generic load error. |
| `frontend/src/services/organizer.ts`, locales | New optional count fields, new strings in kk/ru/en. |

## Commands run
| Command | Result |
|---|---|
| `pytest -q` (backend) | 152 passed (149 baseline + 3 new) |
| `npm run build` (frontend) | exit 0 |
| `npm run lint` | exit 0, no new warnings |

## Acceptance
| Criterion | Status |
|---|---|
| Counts available/reserved/sold/refunded/checked-in | PASS at API level (fake DB); UI not exercised in a browser |
| Save and reload values | NOT RUN (needs live backend) |
| Inputs preserved on validation error | Source: form state is held in the editor and not reset on validation failure; NOT RUN in a browser |
| Attendee denial / cross-organizer API denial | PASS (backend tests, 403) |
| Cross-organizer URL denial in UI | Implemented; NOT RUN in a browser |

## Known gaps
- `reserved` counts holds through the service client; a deployed database must allow it (the backend already uses that client for public reads).
- Event date inputs assume UTC+5 (Asia/Almaty); events saved in another timezone would display shifted. Not changed.
- Real-database verification was not performed.
