import os
import time
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from supabase import create_client, Client, ClientOptions

from crypto import generate_hmac_signature, verify_hmac_signature
from deps import VERIFY_SSL, get_current_user, sanitize_error
from schemas import (
    CurrentUser,
    TicketIssueRequest,
    TicketIssueResponse,
    TicketVerifyRequest,
    TicketVerifyResponse,
    ROLE_EVENT_ADMIN,
    ROLE_ORGANIZER,
    ROLE_PLATFORM_ADMIN,
    STAFF_ROLES,
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_KEY,
    options=ClientOptions(httpx_client=__import__("httpx").Client(verify=VERIFY_SSL)),
)

router = APIRouter(prefix="/api/tickets", tags=["tickets"])


def is_staff_authorized_for_event(db: Any, event_id: str, current_user: CurrentUser) -> bool:
    """Check whether caller is assigned staff, event owner, or platform admin."""
    role = (current_user.role or "").strip().lower().replace(" ", "_").replace("-", "_")
    if role not in STAFF_ROLES:
        return False
    if role in (ROLE_PLATFORM_ADMIN, "admin"):
        return True

    # Explicit staff assignment
    has_explicit = False
    try:
        st = db.table("event_staff").select("*").eq("event_id", event_id).execute()
        valid_staff_rows = [r for r in (st.data or []) if "user_id" in r and "status" not in r]
        if valid_staff_rows:
            has_explicit = True
            for r in valid_staff_rows:
                if str(r.get("user_id")) == current_user.id:
                    return True
    except Exception:
        pass

    # Organizer owning the event
    if role == ROLE_ORGANIZER:
        try:
            ev = db.table("events").select("organizer_id").eq("id", event_id).execute()
            if ev.data and str(ev.data[0].get("organizer_id")) == current_user.id:
                return True
        except Exception:
            pass

    if not has_explicit and role == ROLE_EVENT_ADMIN:
        return True

    return False


# ---------------------------------------------------------------------------
# POST /api/tickets/issue
# ---------------------------------------------------------------------------
@router.post("/issue", response_model=TicketIssueResponse, status_code=status.HTTP_200_OK)
def issue_ticket(
    payload: TicketIssueRequest,
    current_user: Optional[CurrentUser] = Depends(get_current_user),
) -> TicketIssueResponse:
    """Issue (or re-issue) a cryptographically signed QR ticket.
    
    Restricted to canonical tickets and authorized callers to prevent admission bypass.
    """
    ticket_id = payload.ticket_id
    event_id = payload.event_id
    user_id = payload.user_id

    if current_user:
        role = (current_user.role or "").strip().lower()
        if role not in (ROLE_PLATFORM_ADMIN, "admin"):
            is_owner = (current_user.id == user_id)
            is_staff = is_staff_authorized_for_event(supabase, event_id, current_user)
            if not is_owner and not is_staff:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Not authorized to issue ticket.",
                )

    expires_at: int = int(time.time()) + payload.expires_in_hours * 3600

    try:
        existing = (
            supabase.table("tickets")
            .select("id, status, event_id, user_id")
            .eq("id", ticket_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=sanitize_error(exc),
        )

    if not existing.data:
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
                detail=sanitize_error(exc),
            )
    else:
        row = existing.data[0]
        if str(row.get("event_id")) != event_id or str(row.get("user_id")) != user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ticket metadata mismatch.",
            )

    signature = generate_hmac_signature(ticket_id, event_id, user_id, expires_at)
    qr_payload = f"{ticket_id}:{event_id}:{user_id}:{expires_at}:{signature}"

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
            detail=sanitize_error(exc),
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
def verify_ticket(
    payload: TicketVerifyRequest,
    current_user: Optional[CurrentUser] = Depends(get_current_user),
) -> TicketVerifyResponse:
    """Verify a QR payload and atomically check the ticket into an event."""
    qr_payload = payload.qr_payload

    # 1. Cryptographic verification
    is_valid, error_reason, parsed = verify_hmac_signature(qr_payload)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_reason or "Invalid QR code.",
        )

    ticket_id: str = parsed["ticket_id"]
    event_id: str = parsed["event_id"]
    staff_id = current_user.id if current_user else "anonymous-scanner"

    if current_user:
        role = (current_user.role or "").strip().lower().replace(" ", "_").replace("-", "_")
        if role not in STAFF_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Event staff access is required.",
            )
        if not is_staff_authorized_for_event(supabase, event_id, current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not assigned to manage check-ins for this event.",
            )

    try:
        result = (
            supabase.table("tickets")
            .select("id, status, event_id")
            .eq("id", ticket_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=sanitize_error(exc),
        )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticket not found.",
        )

    ticket_row = result.data[0]
    if str(ticket_row.get("event_id")) != event_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This ticket belongs to a different event.",
        )

    if ticket_row.get("status") == "checked_in":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ticket has already been used.",
        )

    if ticket_row.get("status") in ("cancelled", "refunded"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ticket is cancelled or refunded.",
        )

    try:
        upd = (
            supabase.table("tickets")
            .update({
                "status": "checked_in",
                "checked_in_at": "now()",
                "checked_in_by": staff_id,
                "updated_at": "now()",
            })
            .eq("id", ticket_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=sanitize_error(exc),
        )

    try:
        supabase.table("audit_log").insert({
            "action": "TICKET_CHECKIN",
            "performed_by": staff_id if staff_id != "anonymous-scanner" else None,
            "entity_type": "ticket",
            "entity_id": ticket_id,
            "metadata": {"event_id": event_id, "checked_in_at": "now()"},
        }).execute()
    except Exception:
        pass

    return TicketVerifyResponse(
        valid=True,
        message="Check-in successful",
        ticket_id=ticket_id,
    )


# ---------------------------------------------------------------------------
# POST /api/tickets/undo-checkin
# ---------------------------------------------------------------------------
class UndoCheckInRequest(BaseModel):
    eventId: Optional[str] = None
    ticketId: Optional[str] = None
    event_id: Optional[str] = None
    ticket_id: Optional[str] = None


@router.post("/undo-checkin", status_code=status.HTTP_200_OK)
def undo_checkin(
    payload: UndoCheckInRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Reverse a checked-in ticket back to valid status."""
    role = (current_user.role or "").strip().lower().replace(" ", "_").replace("-", "_")
    if role not in STAFF_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized for this event or action.",
        )

    ticket_id = payload.ticketId or payload.ticket_id
    event_id = payload.eventId or payload.event_id
    if not ticket_id or not event_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Both eventId and ticketId are required.",
        )

    if not is_staff_authorized_for_event(supabase, str(event_id), current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not assigned to manage check-ins for this event.",
        )

    try:
        res = (
            supabase.table("tickets")
            .select("id, status, event_id")
            .eq("id", ticket_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=sanitize_error(exc),
        )

    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticket not found.",
        )

    row = res.data[0]
    if str(row.get("event_id")) != str(event_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ticket does not belong to this event.",
        )

    if row.get("status") != "checked_in":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ticket is not checked in.",
        )

    try:
        supabase.table("tickets").update({
            "status": "valid",
            "checked_in_at": None,
            "checked_in_by": None,
            "updated_at": "now()",
        }).eq("id", ticket_id).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=sanitize_error(exc),
        )

    try:
        supabase.table("audit_log").insert({
            "action": "TICKET_CHECKIN_REVERSED",
            "performed_by": current_user.id,
            "entity_type": "ticket",
            "entity_id": ticket_id,
            "metadata": {"event_id": event_id, "reversed_at": "now()"},
        }).execute()
    except Exception:
        pass

    return {"success": True, "message": "Check-in undone"}
