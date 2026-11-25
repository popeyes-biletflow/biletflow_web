"""Mobile Event Admin API — SRS 4.8 & FS-04.

Provides dedicated endpoints for Event Admin mobile ticket verification app:
  POST /api/mobile/auth/login
  GET  /api/mobile/events
  POST /api/mobile/events/{event_id}/tickets/validate
  GET  /api/mobile/events/{event_id}/attendance
  GET  /api/mobile/events/{event_id}/attendees
  POST /api/mobile/events/{event_id}/tickets/check-in
  POST /api/tickets/undo-checkin
"""
import os
import uuid
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from checkin import checkin_ticket
from crypto import generate_hmac_signature, verify_hmac_signature
from deps import VERIFY_SSL, db_for_user, get_current_user, sanitize_error, supabase
from routers.tickets import can_undo_for_event
from schemas import (
    CurrentUser,
    ROLE_ATTENDEE,
    ROLE_EVENT_ADMIN,
    ROLE_ORGANIZER,
    ROLE_PLATFORM_ADMIN,
    STAFF_ROLES,
    UserAuthSchema,
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

router = APIRouter(prefix="/api/mobile", tags=["mobile"])


def assert_staff(user: CurrentUser) -> None:
    role = (user.role or "").strip().lower().replace(" ", "_").replace("-", "_")
    if role not in STAFF_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Event staff access is required. Contact your organizer to check your account role.",
        )


def assert_staff_assigned_to_event(event_id: str, current_user: CurrentUser, client: Any = None) -> None:
    """Enforce that staff member is explicitly assigned or authorized for this specific event."""
    assert_staff(current_user)
    role = (current_user.role or "").strip().lower().replace(" ", "_").replace("-", "_")
    if role in (ROLE_PLATFORM_ADMIN, "admin"):
        return

    sb = client if client is not None else db_for_user(current_user.access_token)

    # 1. Organizer owning the event
    if role == ROLE_ORGANIZER:
        try:
            ev = sb.table("events").select("organizer_id").eq("id", event_id).execute()
            if ev.data and str(ev.data[0].get("organizer_id")) == current_user.id:
                return
        except Exception:
            pass

    # 2. Staff explicitly assigned to this event
    try:
        st_res = sb.table("event_staff").select("*").eq("event_id", event_id).execute()
        for r in st_res.data or []:
            if "user_id" in r and "status" not in r and str(r.get("user_id")) == current_user.id:
                return
    except Exception:
        pass

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You are not assigned to manage check-ins for this event.",
    )


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class MobileLoginResponse(BaseModel):
    accessToken: str
    access_token: str
    token_type: str = "bearer"


class MobileEventItem(BaseModel):
    id: str
    name: str
    venue: str
    startsAt: str


class MobileEventsResponse(BaseModel):
    events: list[MobileEventItem]


class MobileValidateRequest(BaseModel):
    qrPayload: Optional[str] = None
    qr_payload: Optional[str] = None


class MobileValidateResponse(BaseModel):
    valid: bool
    ticketId: Optional[str] = None
    ticket_id: Optional[str] = None
    message: str


class AttendanceResponse(BaseModel):
    checkedIn: int
    total: int
    canUndoCheckIn: bool = True


class AttendeeItem(BaseModel):
    ticketId: str
    name: str
    email: str
    checkedIn: bool


class AttendeesResponse(BaseModel):
    attendees: list[AttendeeItem]
    nextCursor: Optional[str] = None


class CheckInRequest(BaseModel):
    ticketId: Optional[str] = None
    ticket_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/auth/login", response_model=MobileLoginResponse)
async def mobile_login(credentials: UserAuthSchema) -> MobileLoginResponse:
    """Mobile sign-in returning accessToken for Event Admin / staff."""
    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    headers = {
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json",
    }
    payload = {
        "email": credentials.email,
        "password": credentials.password,
    }

    try:
        async with httpx.AsyncClient(verify=VERIFY_SSL) as client:
            response = await client.post(url, json=payload, headers=headers)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Authentication service error: {sanitize_error(exc)}",
        )

    data = response.json()
    if response.status_code != 200 or "access_token" not in data:
        error_msg = data.get("error_description") or "Invalid email or password."
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=error_msg,
        )

    token = data["access_token"]
    return MobileLoginResponse(
        accessToken=token,
        access_token=token,
    )


@router.get("/events", response_model=MobileEventsResponse)
def get_mobile_events(
    current_user: CurrentUser = Depends(get_current_user),
) -> MobileEventsResponse:
    """List events scoped to the authenticated staff member's assignments."""
    assert_staff(current_user)

    db = db_for_user(current_user.access_token)
    role = (current_user.role or "").strip().lower().replace(" ", "_").replace("-", "_")

    event_rows = []
    try:
        if role in (ROLE_PLATFORM_ADMIN, "admin"):
            res = db.table("events").select("*").execute()
            event_rows = res.data or []
        elif role == ROLE_ORGANIZER:
            res_owned = db.table("events").select("*").eq("organizer_id", current_user.id).execute()
            owned = res_owned.data or []
            assigned_ids = []
            try:
                assigned_res = db.table("event_staff").select("event_id").eq("user_id", current_user.id).execute()
                assigned_ids = [str(r["event_id"]) for r in (assigned_res.data or [])]
            except Exception:
                pass
            extra = []
            if assigned_ids:
                extra = db.table("events").select("*").in_("id", assigned_ids).execute().data or []
            seen = {str(e["id"]): e for e in (owned + extra)}
            event_rows = list(seen.values())
        else:
            # Event admin / staff
            assigned_ids = []
            try:
                assigned_res = db.table("event_staff").select("event_id").eq("user_id", current_user.id).execute()
                assigned_ids = [str(r["event_id"]) for r in (assigned_res.data or [])]
            except Exception:
                pass
            if assigned_ids:
                event_rows = db.table("events").select("*").in_("id", assigned_ids).execute().data or []
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=sanitize_error(exc),
        )

    events = [
        MobileEventItem(
            id=str(row["id"]),
            name=row.get("title") or row.get("name") or "Untitled Event",
            venue=row.get("venue_name") or row.get("venue") or row.get("location") or "",
            startsAt=str(row.get("starts_at") or row.get("start_time") or row.get("date") or ""),
        )
        for row in event_rows
    ]
    return MobileEventsResponse(events=events)


@router.post("/events/{event_id}/tickets/validate", response_model=MobileValidateResponse)
def validate_mobile_ticket(
    event_id: str,
    payload: MobileValidateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> MobileValidateResponse:
    """Validate QR payload and atomically check in the ticket."""
    db = db_for_user(current_user.access_token)
    assert_staff_assigned_to_event(event_id, current_user, client=db)

    qr_payload = payload.qrPayload or payload.qr_payload
    if not qr_payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="QR payload is required.",
        )

    # 1. Cryptographic check
    is_valid, error_reason, parsed = verify_hmac_signature(qr_payload)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_reason or "Invalid ticket QR code.",
        )

    ticket_id = parsed["ticket_id"]
    payload_event_id = parsed["event_id"]

    # Reject foreign-event ticket
    if str(payload_event_id) != str(event_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This ticket belongs to a different event.",
        )

    # 2. Admit the ticket atomically in the database (one admission per ticket)
    checkin_ticket(db, ticket_id, event_id, current_user.id)

    return MobileValidateResponse(
        valid=True,
        ticketId=str(ticket_id),
        ticket_id=str(ticket_id),
        message="Check-in successful",
    )


@router.get("/events/{event_id}/attendance", response_model=AttendanceResponse)
def get_mobile_attendance(
    event_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> AttendanceResponse:
    """Return checked-in and total valid tickets for an event."""
    db = db_for_user(current_user.access_token)
    assert_staff_assigned_to_event(event_id, current_user, client=db)

    try:
        t_res = (
            db.table("tickets")
            .select("id, status")
            .eq("event_id", event_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=sanitize_error(exc),
        )

    rows = t_res.data or []
    valid_tickets = [r for r in rows if r.get("status") not in ("cancelled", "refunded")]
    checked_in = sum(1 for r in valid_tickets if r.get("status") == "checked_in")
    total = len(valid_tickets)

    return AttendanceResponse(
        checkedIn=checked_in,
        total=total,
        canUndoCheckIn=can_undo_for_event(db, event_id, current_user),
    )


@router.get("/events/{event_id}/attendees", response_model=AttendeesResponse)
def get_mobile_attendees(
    event_id: str,
    search: str = Query("", description="Search by name, email, or ticket ID"),
    cursor: str = Query("", description="Pagination cursor"),
    limit: int = Query(50, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
) -> AttendeesResponse:
    """List and search attendees for an event."""
    db = db_for_user(current_user.access_token)
    assert_staff_assigned_to_event(event_id, current_user, client=db)

    try:
        t_res = (
            db.table("tickets")
            .select("id, status, user_id, event_id")
            .eq("event_id", event_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=sanitize_error(exc),
        )

    tickets = [r for r in (t_res.data or []) if r.get("status") not in ("cancelled", "refunded")]
    user_ids = list({r["user_id"] for r in tickets if r.get("user_id")})
    profiles_by_id = {}
    if user_ids:
        try:
            p_res = supabase.table("profiles").select("id, full_name, email").in_("id", user_ids).execute()
            for p in (p_res.data or []):
                profiles_by_id[str(p["id"])] = p
        except Exception:
            try:
                p_res = db.table("profiles").select("id, full_name, email").in_("id", user_ids).execute()
                for p in (p_res.data or []):
                    profiles_by_id[str(p["id"])] = p
            except Exception:
                pass

    items: list[AttendeeItem] = []
    q = search.strip().lower()

    for r in tickets:
        ticket_id = str(r["id"])
        uid = str(r.get("user_id", ""))
        prof = profiles_by_id.get(uid, {})
        name = prof.get("full_name") or "Attendee"
        email = prof.get("email") or f"{uid[:8]}@user.biletflow"
        is_checked_in = (r.get("status") == "checked_in")

        if q:
            matches = (
                q in ticket_id.lower()
                or q in name.lower()
                or q in email.lower()
            )
            if not matches:
                continue

        items.append(AttendeeItem(
            ticketId=ticket_id,
            name=name,
            email=email,
            checkedIn=is_checked_in,
        ))

    return AttendeesResponse(
        attendees=items[:limit],
        nextCursor=None,
    )


@router.post("/events/{event_id}/tickets/check-in", status_code=status.HTTP_200_OK)
def manual_check_in_attendee(
    event_id: str,
    payload: CheckInRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Manually check in an attendee by ticket ID."""
    db = db_for_user(current_user.access_token)
    assert_staff_assigned_to_event(event_id, current_user, client=db)

    ticket_id = payload.ticketId or payload.ticket_id
    if not ticket_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ticketId is required.",
        )

    checkin_ticket(
        db, ticket_id, event_id, current_user.id,
        overrides={
            "NOT_FOUND": (status.HTTP_404_NOT_FOUND, "Ticket not found for this event."),
            "WRONG_EVENT": (status.HTTP_404_NOT_FOUND, "Ticket not found for this event."),
        },
    )

    return {"success": True, "ticketId": ticket_id}
