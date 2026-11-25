# Demo run checklist

One integrated journey, two rejection cases, and the fields to record what actually happened. Fill the **Result** column during a real run on the version being demonstrated; leave nothing as "expected" in the report. A row without a recorded result counts as not verified.

| Field | Value |
| --- | --- |
| Web/backend version | `biletflow_web` tag / commit: |
| Mobile version | `biletflow_mobile` tag / commit: |
| Date and operator | |
| Database | Supabase project, `docs/pre-demo-db-check.sql` all true (migrations 008, 018, 019, 020 applied): yes / no |
| Backend reachable at | `http://<LAN address>:8000` (phone and laptop on the same network) |
| Device | phone model, OS, Expo Go or build |
| Simulated | payment (`MockPay`), identity check, activation fee, email delivery to a local mailbox |

## Accounts (synthetic addresses only)

| Role | Account | Starting state |
| --- | --- | --- |
| Organizer | | owns the demo event, payout info set |
| Attendee | | no tickets |
| Event admin (door staff) | | assigned to the demo event by the organizer (otherwise sees no events) |
| Platform admin | | optional, for the suspension step |

Starting data: the seeded catalogue (`seed_events*.sql`), plus one new event created in step 1. Record order, ticket and check-in counts before the run so the change is visible afterwards.

## Journey

| # | Role | Action | Expected visible result | Persisted state to show | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | Organizer | Create a draft event, add a free and a paid ticket type (KZT), preview | Event in organizer list as draft; not in public discovery | row in organizer list after refresh | |
| 2 | Organizer | Open the activation checklist, fix what is missing, activate paid sales | Missing prerequisites are named; after activation the paid tier is purchasable | event shows paid sales active; one simulated payment recorded | |
| 3 | Organizer | Publish; create a promo campaign | Event appears in discovery (KK / RU / EN switch); campaign link shown | campaign still listed after reload | |
| 4 | Attendee | Find the event, apply the promo code, pay (simulated) | Server-calculated price (not a client value), order confirmation | order in My Orders after refresh; inventory decreased | |
| 5 | Attendee | Open the ticket | QR ticket and PDF | ticket status `valid` | |
| 6 | Event admin | Sign in on the phone, pick the event, scan the QR | "Valid" result, counter increases | ticket `checked_in`; web ticket and organizer count agree | |
| 7 | Event admin | **Rejection 1:** scan the same QR again | "Already used"; counter unchanged | still one admission (audit log has one `TICKET_CHECKIN`) | |
| 8 | Anyone | **Rejection 2:** try one of: a QR for another event, an edited QR, a refunded ticket, or a paid ticket before activation | Specific refusal, no state change | ticket status unchanged | |
| 9 | Event admin | Undo the check-in (only if the assignment allows it) | Ticket back to valid | audit log has `TICKET_CHECKIN_REVERSED` | |

## Evidence to keep

- Screenshots or the recording of steps 2, 6 and 7, labelled with the version and date.
- The shared scan log from the mobile app (latency per online scan).
- Output of `docs/pre-demo-db-check.sql` and of `cd backend && python -m pytest -q` on the demonstrated version.
- Anything that failed, with the cause. Do not hide it; the report must list it.

## Before going on stage

1. Run `docs/pre-demo-db-check.sql`; every row `true`.
2. Sign in as each role once on the demonstrated version.
3. Confirm the door staff account is assigned to the event (it sees an empty list otherwise).
4. Phone and laptop on the same network; open `http://<LAN address>:8000/docs` on the phone.
5. Print or display the QR on a second screen so the scan can be shown from the phone.
6. Have the labelled backup recording ready; playback counts toward the time.
