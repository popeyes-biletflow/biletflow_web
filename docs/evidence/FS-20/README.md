# FS-20 evidence: demo notifications and ticket delivery

Synthetic users only (`buyer@example.com`, `friend@example.com`, `org@example.com`). Payments are simulated.

## How it was captured

`mailbox/` holds the raw messages (`.eml`) a local SMTP server (aiosmtpd, the same role Mailpit plays in a
demo) actually received while running the real API endpoints (`POST /api/orders`,
`POST /api/support/cases/{id}/messages`, event cancellation hook) against an in-memory database.
`mailbox/delivery-log.txt` is the run log:

| Scenario | Result |
|---|---|
| Free registration (kk) | 1 confirmation (`01_registration_free_kk.eml`) with the ticket link |
| Paid purchase, then the same request again | 1 confirmation to the buyer with both ticket links (`02`), 1 ticket email to the second attendee (`03`); the retry returned the same order (`replayed=True`) and sent nothing new |
| Declined demo payment | `Payment failed` email (`04`), no order created, hold kept |
| Organizer replies in a support case | email to the attendee with the case link (`05`) |
| Event cancelled | one email per ticket holder (`06`) |
| SMTP down during purchase | order and 2 tickets issued anyway, outbox row `failed`; `retry_pending()` delivered it once (`07`), a second retry sent nothing |

`templates/` — HTML previews of every template in kk / ru / en (`python notify.py previews <dir>`):
registration, purchase, ticket delivery, payment failure, event update, event cancellation, refund,
payout status, support (created / reply / status / assignment / escalation).

Automated: `backend/tests/test_fs20_notifications.py` (11 tests with a real local SMTP server).

## Supabase email verification / reset (FS-01 / FS-16)

These two emails are sent by Supabase Auth itself. To exercise them in the demo:
Supabase → Authentication → URL Configuration → add `http://localhost:5173/auth/callback` and
`http://localhost:5173/auth/reset-password` to Redirect URLs. With "Confirm email" on, sign-up sends the
verification link, and "Forgot password" sends the reset link (screenshots to be added from the demo mailbox).
