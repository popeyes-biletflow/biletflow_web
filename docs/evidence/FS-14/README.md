# FS-14 evidence: organizer operations

Base: `feature/FS-13-activation-campaigns`. Roster, refunds and enhanced activity depend on open PRs #25 (refunds, ibragim-m) and #26 (attendees/metrics/activity, ibragim-m); they are not merged and not assumed deployed.

## Pre-existing (not new work)
Dashboard with phase tabs (upcoming / active / completed / cancelled), per-event analytics with date and ticket-type filters, `GET /api/organizer/events/{id}/history`, `POST /api/organizer/events/{id}/duplicate` (RPC creates a draft; copies details and ticket types only, paid sales reset), organizer-only authorization in the RPCs.
Roster API, refund API and refund policy are #25/#26 and are not reimplemented here.

## Changes in this ticket
| File | Change |
|---|---|
| `OrganizerDashboard.tsx` | Analytics filter race fixed: results are bound to the filter set that requested them, late responses ignored, an old filter's numbers are never shown as the current ones, errors replace stale data. |
| `HistoryPanel.tsx` (tab "History") | Filter by action and date range, newest first, paged 20 at a time, retry on failure, readable after cancellation (history is retained). Uses the existing history endpoint; paging/filtering is client-side because that endpoint returns the whole list. |
| `EventManagePage.tsx` | "Duplicate" action (optional title and new start) opens the new editable draft; hint states what is not copied. New tabs History and Attendees. |
| `AttendeesPanel.tsx` (tab "Attendees") | Roster with status filter and server pagination (50), stale-response protection, CSV export of all rows for the active filter (same columns as the table), refund-order action with confirmation. Shown only when the API's `/openapi.json` lists #26's attendees route; refund button only when #25's refund route is listed. Otherwise a notice says what is missing. |
| `services/csv.ts` + tests | RFC 4180 quoting, formula-injection guard (`= + - @ TAB CR`), BOM, CRLF. |
| `services/organizer.ts`, locales | Client methods/types; kk/ru/en strings. |

Privacy: the roster and CSV include name, ticket type, status and check-in time. Email is returned by the #26 endpoint but is not displayed or exported.

## Commands run
| Command | Result |
|---|---|
| `npm run build` | exit 0 |
| `npm test` | 12 passed (9 events/calendar + 3 CSV) |
| `npm run lint` | exit 0, no warnings in new files; remaining warnings pre-date this work |
| `node docs/evidence/FS-14/browser-check.js` (Playwright, Vite dev, **stubbed API**) | 19/19 PASS, both with and without the roster/refund routes. The analytics race check was also run against the previous dashboard code and FAILED there, so it detects the bug. |

## Acceptance
| Criterion | Status |
|---|---|
| Phase navigation, retained/cancelled records | Pre-existing; not re-exercised against a real backend |
| Filtered analytics without out-of-order results | PASS (stubbed, regression-checked) |
| Paginated/filterable history | PASS (stubbed); client-side paging, not server-side (see gaps) |
| Duplicate opens a new editable draft, copies no attendees/orders/payments/support/history | UI PASS (stubbed); the copy rules are in the existing SQL RPC (`007_history_duplicate.sql`), not executed here |
| Authorized roster + matching CSV; CSV escaping/formula safety/minimization | PASS (stubbed + unit tests); BLOCKED for real data until #26 is merged and migrations 013-017 applied |
| Refund updates ticket state/totals on reload | BLOCKED until #25 is merged and its migrations applied; UI flow verified with a stub only |
| Cross-organizer denial | Server-side in the RPCs (`NOT_EVENT_OWNER`) and the existing owner checks; not run against a database |
| Refund policy copied on duplicate | BLOCKED (#26) |

## Known gaps
- History is not server-paginated (#26 adds `/events/{id}/activity` with offset/limit and filters; switch to it after merge).
- Refund is per order; the confirmation says so.
- Real-database verification was not performed.
