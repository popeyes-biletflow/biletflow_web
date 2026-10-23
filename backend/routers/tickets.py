import os
import time

import httpx
from fastapi import APIRouter, HTTPException, status
from supabase import create_client, Client, ClientOptions

from crypto import generate_hmac_signature, verify_hmac_signature
from schemas import (
    TicketIssueRequest,
    TicketIssueResponse,
    TicketVerifyRequest,
    TicketVerifyResponse,
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_KEY,
    options=ClientOptions(httpx_client=httpx.Client(verify=False)),
)

router = APIRouter(prefix="/api/tickets", tags=["tickets"])


# ---------------------------------------------------------------------------
# POST /api/tickets/issue
# ---------------------------------------------------------------------------
@router.post("/issue", response_model=TicketIssueResponse, status_code=status.HTTP_200_OK)
def issue_ticket(payload: TicketIssueRequest) -> TicketIssueResponse:
    """Issue (or re-issue) a cryptographically signed QR ticket.

    Steps:
    1. Upsert the ticket row in the ``tickets`` table.
    2. Compute expiry timestamp and HMAC-SHA256 signature.
    3. Build the canonical QR payload string.
    4. Persist the signature and mark status as ``valid``.
    5. Return the QR payload.
    """
    ticket_id = payload.ticket_id
    event_id = payload.event_id
    user_id = payload.user_id
    expires_at: int = int(time.time()) + payload.expires_in_hours * 3600

    # 1. Fetch or insert the ticket row
    try:
        existing = (
            supabase.table("tickets")
            .select("id")
            .eq("id", ticket_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )

    if not existing.data:
        # Insert a new minimal ticket record
        try:
            supabase.table("tickets").insert(
                {
                    "id": ticket_id,
                    "event_id": event_id,
                    "user_id": user_id,
                    "status": "valid",
                }
            ).execute()
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(exc),
            )

    # 2. Compute signature
    signature = generate_hmac_signature(ticket_id, event_id, user_id, expires_at)

    # 3. Build QR payload
    qr_payload = f"{ticket_id}:{event_id}:{user_id}:{expires_at}:{signature}"

    # 4. Persist signature + status
    try:
        supabase.table("tickets").update(
            {
                "status": "valid",
                "qr_code_hash": signature,
                "updated_at": "now()",
            }
        ).eq("id", ticket_id).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )

    return TicketIssueResponse(
        ticket_id=ticket_id,
        qr_payload=qr_payload,
        status="valid",
    )


# ---------------------------------------------------------------------------
# POST /api/tickets/verify
# ---------------------------------------------------------------------------
@router.post("/verify", response_model=TicketVerifyResponse, status_code=status.HTTP_200_OK)
def verify_ticket(payload: TicketVerifyRequest) -> TicketVerifyResponse:
    """Verify a QR payload and check the ticket into an event.

    Steps:
    1. Validate HMAC signature and expiry via ``verify_hmac_signature``.
    2. Confirm the ticket exists in the database.
    3. Guard against double check-in.
    4. Mark ticket as ``checked_in``.
    5. Return success response.
    """
    qr_payload = payload.qr_payload

    # 1. Cryptographic verification
    is_valid, error_reason, parsed = verify_hmac_signature(qr_payload)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_reason,
        )

    ticket_id: str = parsed["ticket_id"]

    # 2. Check existence in DB
    try:
        result = (
            supabase.table("tickets")
            .select("id, status")
            .eq("id", ticket_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticket not found.",
        )

    ticket_row = result.data[0]

    # 3. Guard against double check-in
    if ticket_row["status"] == "checked_in":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ticket has already been used.",
        )

    # 4. Mark as checked_in
    try:
        supabase.table("tickets").update(
            {
                "status": "checked_in",
                "updated_at": "now()",
            }
        ).eq("id", ticket_id).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )

    # 5. Return success
    return TicketVerifyResponse(
        valid=True,
        message="Check-in successful",
        ticket_id=ticket_id,
    )
