# FS-18 evidence: print-ready QR tickets

Synthetic data only (demo attendee, demo event).

| File | What it shows |
|---|---|
| `ticket-valid-kk-grayscale.png` | Server-generated A4 PDF (`GET /api/me/tickets/{id}/pdf?lang=kk`), top half, rendered in grayscale. Kazakh text, seat, attendee, ticket type, QR with quiet zone. No email, price or card data. |
| `ticket-refunded-ru-grayscale.png` | Same ticket after a refund: no QR is issued, the PDF shows "БИЛЕТ НЕДЕЙСТВИТЕЛЕН / Возвращён". |

## QR readability check

The valid PDF was rendered at **100 dpi in grayscale** (roughly a cheap office print/scan) and decoded with
`zxing-cpp`:

```
found 1 QR Code
hmac ok: True  7f3c2a10-5b1e-4c7a-9d2e-1a2b3c4d5e6f
```

The decoded payload passes `crypto.verify_hmac_signature`, the same check the scanner (`/api/mobile/.../validate`) runs.
Screen view (`/tickets/:id`), confirmation page and PDF all build the QR with `crypto.ticket_qr_payload`, so they
carry one ticket ID and one signed payload; admission is decided by ticket status, so a second scan of any copy is
rejected as "already used".

Automated: `backend/tests/test_fs18_tickets.py` (owner scoping, refunded → no QR, PDF in kk/ru/en, no PII/payment text in the PDF).
