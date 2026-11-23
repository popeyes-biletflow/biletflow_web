# FS-11 evidence: public discovery and event details

Base: `7a89773c01dc0ac97a2038f72de504b91c149687` (`main`). Branch: `feature/FS-11-discovery-release`.
Implementation SHA: see the branch tip (this doc ships in the same commit).

## Pre-existing (not new work)
Discovery list with search/category URL state, KK/RU/EN labels and dates, KZT, details page with tiers,
venue map, seating layout, `.ics` export, cancelled/preview banners (PB-3, PB-8, PB-13, PB-18 —
authorship per `git log`/PR diffs; this change does not claim them). `App.tsx` already wires promo
persistence, `CheckoutModal`, `SupportDialog` and the auth/order/ticket/support routes; untouched.

## Integration / hardening in this change
| File | Change |
|---|---|
| `frontend/src/services/events.ts` | No invented start date (record without a valid one is dropped / rejected); unknown status → non-public `draft`, not `published`; remaining stock uses backend `available` only (no `quantity`/`stock` fallback); list also filters visibility/suspended; id is URL-encoded. |
| `frontend/src/hooks/useEvent.ts` (new) | One loader for details + purchase button: result bound to the requested id (no stale/old-event retention), late responses ignored, 404 = not found, other failures = retryable error. |
| `frontend/src/pages/EventDetailsPage.tsx` | Loading (`role=status`), not-found, error + retry (`role=alert`), registration-not-open/closed banner, per-tier "sales ended". |
| `frontend/src/App.tsx` | `EventPurchase` uses `useEvent` (no purchase action for another event while loading; checkout stays mounted on token refresh). |
| `frontend/src/pages/EventsPage.tsx` | Error with retry, stale-response guard, numeric date sort, live-region status. |
| `i18n/locales/{en,ru,kk}.json` | 4 new `details.*` keys in all three languages. |
| `frontend/package.json` | `vitest` dev dependency + `npm test` (no frontend test runner existed). |

## Commands actually run (frontend/)
| Command | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm run build` (before / after) | exit 0 / exit 0 |
| `npm run lint` (before / after) | exit 0, warnings only; no new warnings in changed files |
| `npm test` | 9 passed |
| `backend: pytest -q` (baseline, unchanged code) | 149 passed |
| `node docs/evidence/FS-11/browser-check.js <outdir>` (Playwright, Chromium, Vite dev, **API stubbed**) | 20/20 PASS (1280px and 375px) |

## Acceptance
| Criterion | Status | Evidence |
|---|---|---|
| Search/filter in URL, refresh keeps state | PASS (stubbed API) | browser check |
| KK/RU/EN copy, KZT, date formats | PARTIAL: keys present in 3 languages; only EN exercised in browser | |
| Map and `.ics` preserved; calendar download | PASS | browser check parses downloaded `.ics`; unit test |
| Loading / empty / error / direct-link states | PASS (stubbed) | 404 vs 500 vs success |
| Cancelled / missing events have no purchase action | PASS (stubbed) | browser check |
| Stale navigation A→B | PASS (stubbed) | browser check |
| Published/unlisted/private/owner-preview vs real backend | NOT RUN | needs live backend + Supabase + owner/other-user tokens |
| Desktop/mobile against real data | NOT RUN | stubbed data only |

## Known gaps / dependencies
- `GET /api/events` returns raw event rows without ticket tiers, so list cards show no "from" price.
  Needs a small backend change (owner: Baibol, FS-02 event API); frontend already renders it when present.
- `EventDetailsPage` and `EventPurchase` still issue two requests for one event (correct, not minimal).
- Date helpers elsewhere default to UTC+5; not changed here.
- No real-backend, deployed-schema or CORS verification was performed.

## Follow-up: venue map purchase action (after the venue-map merge)
The seat map added later has its own "Book ticket" button that opened checkout without checking the event status, so cancelled and draft events showed a purchase action. The map now shows and handles that button only for published events. Checked in a browser with a stubbed API: before the change cancelled and draft showed the button, after it only published does. The server already refuses such purchases; this removes the misleading control.
