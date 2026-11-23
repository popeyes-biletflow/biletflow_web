# Live acceptance run, FS-11 to FS-15

Run on 2026-11-23 against the real Supabase project, with `main` at `021f54f` plus the fixes on this branch. Backend run locally, browser run with Playwright (Chromium, desktop 1200px and mobile 375px). Accounts: two organizers, one platform admin, two attendees (synthetic test accounts). All test events were created by the run, titled `ZZ-TEST ...`, and cancelled afterwards; the activation fee was restored to its original value. Test orders, tickets, campaigns and one simulated activation payment remain as records.

## Results
| Suite | Result |
|---|---|
| Backend unit/API tests | 226 passed |
| Frontend unit tests | 12 passed |
| Live API run (login, FS-11 to FS-15) | 83 PASS, 3 FAIL (all three need migration 018) |
| Live refund run | 14 PASS, 0 FAIL |
| Live browser run (all roles) | 33 PASS, 2 FAIL (both need migration 018) |

## Defects found by the live run
| # | Finding | Status |
|---|---|---|
| 1 | Creating an event failed with HTTP 500 for every organizer: the live `events` table requires `event_date` (and has a legacy `venue` column) that the create API never filled | Fixed in this branch (mirrored from `starts_at` / `venue_name`), verified live |
| 2 | Admin suspension returned success and wrote an audit entry but changed nothing, because row-level security gives platform admins no update right on `events` / `profiles` | API now reports a clear 403 instead of a false success; the real fix is migration 018, not applied |
| 3 | Organizers cannot read their own campaign rows, so the tracking link and campaign state disappear after a reload | UI now says so and keeps the disable control; real fix is migration 018, not applied |
| 4 | An organizer can write `paid_sales_status` / `paid_sales_active` on their own event directly through the database API and skip the activation fee; an attendee could then buy a paid ticket | NOT fixed; needs a database-level protection (owner decision) |
| 5 | Suspended events were still listed by `GET /api/events` and the free-ticket checkout did not check suspension | Fixed in this branch, verified live |
| 6 | Event create/publish/unpublish/cancel are not written to the audit log, so history is nearly empty for ordinary events | Not fixed (history/audit owner) |
| 7 | After a full refund, analytics shows net -500 for a 10,000 order (refunded fee counted against revenue) | Not fixed (analytics owner) |

## What was verified live
FS-11: public list (30 events) on desktop and mobile, search, details with KZT tiers, calendar download, not-found state, purchase offered only for published events, no horizontal scroll.
FS-12: draft create/edit/reload, validation, two tiers, publish/unpublish, hide tier, tier counts, attendee and other-organizer denial.
FS-13: activation status uses the admin fee, activation with terms, idempotent retry, percent and fixed-KZT tier-scoped campaigns, server discount quote (10% of 5,000 = 500), campaign link redirect, disabled campaign rejected with a specific code.
FS-14: roster, CSV, history tab, duplicate (new draft, no attendees, paid sales reset), paid order and retry, refund, repeat refund, inventory restored, refund policies, payout estimate, analytics and roster denial for other organizers.
FS-15: admin denials for attendee and organizer on every admin endpoint, search, paging, payments, export, suspend reason required, fee change visible to organizers and restored, suspended-state blocking of new holds, free registration, order confirmation, direct link and public list (suspended state simulated as the owner because defect 2 blocks the admin write).

## Still blocked or open
- Migration 018 (`backend/migrations/018_admin_moderation_and_campaign_policies.sql`) must be reviewed and applied by the database owner: admin suspension, campaign links/state.
- Defect 4 needs a database-level fix before paid sales can be trusted.
