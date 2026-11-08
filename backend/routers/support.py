"""Support Cases router — PB-16.

Endpoints
---------
POST   /api/support/cases                        – open a new case
GET    /api/support/cases                        – list cases (paginated)
GET    /api/support/cases/{case_id}              – fetch case + messages
POST   /api/support/cases/{case_id}/messages     – add a message
PATCH  /api/support/cases/{case_id}/status       – update status (platform_admin or owning organizer on attendee cases)

Access control matrix (assert_can_access_case)
----------------------------------------------
attendee        → own cases only
event_admin     → own cases only (check-in staff only, no support-case staff rights)
organizer       → own cases + attendee cases for events they manage
platform_admin  → all cases, and the only one who handles organizer-opened cases
"""
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from deps import db_for_user, get_current_user, supabase
from schemas import (
    CurrentUser,
    SupportCaseCreateRequest,
    SupportMessageCreateRequest,
    SupportCaseStatusUpdateRequest,
    ROLE_ATTENDEE,
    ROLE_ORGANIZER,
    ROLE_EVENT_ADMIN,
    ROLE_PLATFORM_ADMIN,
)

router = APIRouter(prefix="/api/support", tags=["support"])

VALID_CATEGORIES = {
    "ticket_delivery",
    "payment",
    "refund",
    "seating",
    "event_information",
    "check_in",
    "account",
    "technical",
}

VALID_STATUSES = {"OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED"}

# Categories an organizer may use for platform-support cases (not event-linked)
ORGANIZER_PLATFORM_CATEGORIES = {"account", "payment", "technical"}


# ---------------------------------------------------------------------------
# Reusable Access-control & Event-derivation helpers
# ---------------------------------------------------------------------------

def _organizer_owns_event(event_id: str, organizer_id: str, client: Any = None) -> bool:
    """Return True if the given organizer owns the event."""
    sb = client if client is not None else supabase
    try:
        res = (
            sb.table("events")
            .select("id")
            .eq("id", event_id)
            .eq("organizer_id", organizer_id)
            .execute()
        )
        return bool(res.data)
    except Exception:
        return False


def _derive_event_id_for_case(case: dict[str, Any], client: Any) -> str | None:
    """Derive event_id for a case from its event_id, ticket_id, or order_id via tickets."""
    if case.get("event_id"):
        return str(case["event_id"])

    sb = client if client is not None else supabase

    # If ticket_id exists, look up tickets.event_id
    if case.get("ticket_id"):
        try:
            t_res = sb.table("tickets").select("event_id").eq("id", case["ticket_id"]).limit(1).execute()
            if t_res.data and t_res.data[0].get("event_id"):
                return str(t_res.data[0]["event_id"])
        except Exception:
            pass

    # If order_id exists, derive event_id via tickets (tickets.order_id -> tickets.event_id)
    if case.get("order_id"):
        try:
            t_res = sb.table("tickets").select("event_id").eq("order_id", case["order_id"]).limit(1).execute()
            if t_res.data and t_res.data[0].get("event_id"):
                return str(t_res.data[0]["event_id"])
        except Exception:
            pass

    return None


def assert_can_access_case(
    case: dict[str, Any],
    current_user: CurrentUser,
    client: Any = None,
) -> None:
    """Single reusable authorization helper enforcing the PB-16 support matrix.

    - Attendee: own cases only.
    - Event Admin: own cases only (check-in staff only, no support staff rights).
    - Organizer: attendee cases for events they manage, plus their own platform-support cases.
    - Platform Admin: all cases, and the only one who handles organizer-opened cases.
    - Others get 403 (or 404 to avoid revealing existence).
    """
    role = (current_user.role or ROLE_ATTENDEE).strip().lower()
    requester_id = str(case.get("requester_id", ""))
    is_requester = (requester_id == current_user.id)

    # Platform Admin has access to all cases
    if role == ROLE_PLATFORM_ADMIN:
        return

    # Attendee or Event Admin: own cases only
    if role in (ROLE_ATTENDEE, ROLE_EVENT_ADMIN):
        if is_requester:
            return
        # Use 404 to avoid revealing case existence to unauthorized users
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    # Organizer: attendee cases for events they manage, plus their own platform-support cases
    if role == ROLE_ORGANIZER:
        if is_requester:
            return

        sb = client if client is not None else supabase
        event_id = _derive_event_id_for_case(case, sb)
        if not event_id:
            # Platform-support cases opened by others are invisible to this organizer
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

        # Organizer must manage the event linked to this case
        owns_event = _organizer_owns_event(str(event_id), current_user.id, client=sb)
        if not owns_event:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not manage this event.")

        # Platform Admin is the only one who handles organizer-opened cases
        try:
            prof = sb.table("profiles").select("role").eq("id", requester_id).execute()
            if prof.data:
                requester_role = (prof.data[0].get("role") or "").strip().lower()
                if requester_role in (ROLE_ORGANIZER, ROLE_PLATFORM_ADMIN):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Only platform admins can handle organizer-opened cases.",
                    )
        except HTTPException:
            raise
        except Exception:
            pass

        return

    # Any other unrecognized role
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


# ---------------------------------------------------------------------------
# POST /api/support/cases
# ---------------------------------------------------------------------------

@router.post("/cases", status_code=status.HTTP_201_CREATED)
async def create_case(
    payload: SupportCaseCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Open a new support case with an initial message."""
    role = (current_user.role or ROLE_ATTENDEE).strip().lower()

    # --- Validate category ---
    if payload.category not in VALID_CATEGORIES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid category. Must be one of: {sorted(VALID_CATEGORIES)}",
        )

    # --- Validate message body ---
    message_text = (payload.message or payload.body or "").strip()
    if not message_text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Message body must not be empty.",
        )
    if len(message_text) > 5000:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Message body must not exceed 5 000 characters.",
        )

    # --- Validate subject ---
    subject_text = (payload.subject or "").strip()
    if not subject_text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Subject must not be empty.",
        )

    db = db_for_user(current_user.access_token)

    event_id = payload.event_id
    order_id = payload.order_id
    ticket_id = payload.ticket_id

    # --- 1. Resolve ticket_id → order_id / event_id (ticket implies order & event) ---
    if ticket_id:
        try:
            t_res = db.table("tickets").select("*").eq("id", ticket_id).execute()
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(exc),
            )
        if not t_res.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Ticket not found.",
            )
        ticket_row = t_res.data[0]

        # Ownership: attendee must own the ticket; organizer must own the event
        if role in (ROLE_ATTENDEE, ROLE_EVENT_ADMIN) and str(ticket_row.get("user_id")) != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not own this ticket.",
            )
        if role == ROLE_ORGANIZER:
            t_event_id = str(ticket_row.get("event_id", ""))
            if not _organizer_owns_event(t_event_id, current_user.id, client=db):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You do not manage the event for this ticket.",
                )

        # Auto-fill order_id and event_id from ticket
        if not order_id and ticket_row.get("order_id"):
            order_id = str(ticket_row["order_id"])
        if not event_id and ticket_row.get("event_id"):
            event_id = str(ticket_row["event_id"])

    # --- 2. Resolve order_id: orders has NO event_id, derive via tickets ---
    if order_id:
        try:
            o_res = (
                db.table("orders")
                .select("id, user_id")
                .eq("id", order_id)
                .execute()
            )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(exc),
            )
        if not o_res.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Order not found.",
            )
        order_row = o_res.data[0]

        # Attendees may only link orders they own (orders.user_id)
        if role in (ROLE_ATTENDEE, ROLE_EVENT_ADMIN) and str(order_row.get("user_id")) != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not own this order.",
            )

        # Derive event_id via tickets (tickets.order_id -> tickets.event_id)
        if not event_id:
            try:
                t_order_res = (
                    db.table("tickets")
                    .select("event_id")
                    .eq("order_id", order_id)
                    .limit(1)
                    .execute()
                )
                if t_order_res.data and t_order_res.data[0].get("event_id"):
                    event_id = str(t_order_res.data[0]["event_id"])
            except Exception:
                pass

        if role == ROLE_ORGANIZER and event_id:
            if not _organizer_owns_event(event_id, current_user.id, client=db):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You do not manage the event for this order.",
                )

    # --- 3. Role-specific rules for organizer cases ---
    if role == ROLE_ORGANIZER:
        # Organizers may open platform-support cases only for account, payment, or technical issues,
        # or activation problems on their own events.
        if not event_id:
            if payload.category not in ORGANIZER_PLATFORM_CATEGORIES:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "Organizers can only open platform-support cases "
                        "(account/payment/technical) without linking an event."
                    ),
                )
        else:
            if not _organizer_owns_event(event_id, current_user.id, client=db):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You do not manage this event.",
                )

    # --- 4. Insert case (starts OPEN) ---
    case_data: dict[str, Any] = {
        "requester_id": current_user.id,
        "category": payload.category,
        "subject": subject_text,
        "status": "OPEN",
    }
    if event_id:
        case_data["event_id"] = event_id
    if order_id:
        case_data["order_id"] = order_id
    if ticket_id:
        case_data["ticket_id"] = ticket_id

    try:
        case_res = db.table("support_cases").insert(case_data).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )
    if not case_res.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create support case.",
        )
    case_row = case_res.data[0]
    case_id = str(case_row["id"])

    # --- 5. Insert first message (append-only) ---
    try:
        msg_res = (
            db.table("support_messages")
            .insert({
                "case_id": case_id,
                "sender_id": current_user.id,
                "body": message_text,
            })
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )

    return {
        "case": case_row,
        "message": msg_res.data[0] if msg_res.data else None,
    }


# ---------------------------------------------------------------------------
# GET /api/support/cases
# ---------------------------------------------------------------------------

@router.get("/cases")
async def list_cases(
    status_filter: str | None = Query(default=None, alias="status"),
    category: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    """List support cases with optional filters, paginated."""
    role = (current_user.role or ROLE_ATTENDEE).strip().lower()
    offset = (page - 1) * page_size

    db = db_for_user(current_user.access_token)

    try:
        query = db.table("support_cases").select("*")

        if role in (ROLE_ATTENDEE, ROLE_EVENT_ADMIN):
            query = query.eq("requester_id", current_user.id)
        elif role == ROLE_ORGANIZER:
            # Fetch events owned by this organizer
            event_ids: list[str] = []
            try:
                ev_res = (
                    db.table("events")
                    .select("id")
                    .eq("organizer_id", current_user.id)
                    .execute()
                )
                if ev_res.data:
                    event_ids = [str(r["id"]) for r in ev_res.data if r.get("id")]
            except Exception:
                pass

            if event_ids:
                event_ids_str = ",".join(event_ids)
                query = query.or_(
                    f"requester_id.eq.{current_user.id},event_id.in.({event_ids_str})"
                )
            else:
                query = query.eq("requester_id", current_user.id)
        # platform_admin: no additional user filter

        if status_filter:
            query = query.eq("status", status_filter)
        if category:
            query = query.eq("category", category)

        query = (
            query.order("created_at", desc=True)
            .range(offset, offset + page_size - 1)
        )
        res = query.execute()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )

    return {
        "page": page,
        "page_size": page_size,
        "cases": res.data or [],
    }


# ---------------------------------------------------------------------------
# GET /api/support/cases/{case_id}
# ---------------------------------------------------------------------------

@router.get("/cases/{case_id}")
async def get_case(
    case_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Fetch a single support case with its messages ordered by created_at."""
    db = db_for_user(current_user.access_token)

    try:
        case_res = (
            db.table("support_cases")
            .select("*")
            .eq("id", case_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )

    if not case_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Support case not found.",
        )

    case_row = case_res.data[0]
    assert_can_access_case(case_row, current_user, client=db)

    # Fetch messages ordered by created_at
    try:
        msg_res = (
            db.table("support_messages")
            .select("*")
            .eq("case_id", case_id)
            .order("created_at")
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )

    return {
        "case": case_row,
        "messages": msg_res.data or [],
    }


# ---------------------------------------------------------------------------
# POST /api/support/cases/{case_id}/messages
# ---------------------------------------------------------------------------

@router.post("/cases/{case_id}/messages", status_code=status.HTTP_201_CREATED)
async def add_message(
    case_id: str,
    payload: SupportMessageCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Append a message to an existing support case."""
    msg_body = (payload.body or "").strip()
    if not msg_body:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Message body must not be empty.",
        )
    if len(msg_body) > 5000:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Message body must not exceed 5 000 characters.",
        )

    db = db_for_user(current_user.access_token)

    # Fetch case
    try:
        case_res = (
            db.table("support_cases")
            .select("*")
            .eq("id", case_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )
    if not case_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Support case not found.",
        )

    case_row = case_res.data[0]

    # Guard: Return 409 if case is RESOLVED
    if case_row.get("status") == "RESOLVED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot add messages to a resolved case.",
        )

    # Access control
    assert_can_access_case(case_row, current_user, client=db)

    # Insert message (append-only)
    try:
        msg_res = (
            db.table("support_messages")
            .insert({
                "case_id": case_id,
                "sender_id": current_user.id,
                "body": msg_body,
            })
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )

    if not msg_res.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to add message.",
        )

    return {"message": msg_res.data[0]}


# ---------------------------------------------------------------------------
# PATCH /api/support/cases/{case_id}/status
# ---------------------------------------------------------------------------

@router.patch("/cases/{case_id}/status")
async def update_case_status(
    case_id: str,
    payload: SupportCaseStatusUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Update case status.

    Permissions:
    - platform_admin: allowed on any case.
    - owning organizer: allowed on attendee cases for their own events only.
    - attendee, event_admin, others: 403 Forbidden.
    """
    role = (current_user.role or ROLE_ATTENDEE).strip().lower()

    # Attendees and event_admin (check-in staff only) get 403
    if role in (ROLE_ATTENDEE, ROLE_EVENT_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: insufficient permissions to update support case status.",
        )

    if role not in (ROLE_PLATFORM_ADMIN, ROLE_ORGANIZER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: insufficient permissions.",
        )

    if payload.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid status. Must be one of: {sorted(VALID_STATUSES)}",
        )

    db = db_for_user(current_user.access_token)

    # Verify case exists
    try:
        case_res = (
            db.table("support_cases")
            .select("*")
            .eq("id", case_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )
    if not case_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Support case not found.",
        )

    old_case = case_res.data[0]
    requester_id = str(old_case.get("requester_id", ""))

    # Organizer-specific permission check
    if role == ROLE_ORGANIZER:
        event_id = _derive_event_id_for_case(old_case, db)
        if not event_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Organizers cannot update the status of platform-support cases.",
            )

        if not _organizer_owns_event(event_id, current_user.id, client=db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not manage the event associated with this case.",
            )

        # Organizers cannot change status on their own cases
        if requester_id == current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Organizers cannot update the status of their own support cases.",
            )

        # Case must be opened by an attendee (not another organizer or platform_admin)
        try:
            prof_res = db.table("profiles").select("role").eq("id", requester_id).execute()
            if prof_res.data:
                req_role = (prof_res.data[0].get("role") or "").strip().lower()
                if req_role != ROLE_ATTENDEE:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Organizers can only update status on attendee-opened cases.",
                    )
        except HTTPException:
            raise
        except Exception:
            pass

    assign_requested = bool(payload.assign_to_caller or payload.assign_to_me)

    update_data: dict[str, Any] = {"status": payload.status}
    if assign_requested:
        update_data["assigned_to"] = current_user.id

    try:
        upd_res = (
            db.table("support_cases")
            .update(update_data)
            .eq("id", case_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )

    # Write to audit log
    try:
        supabase.table("audit_log").insert({
            "action": "SUPPORT_CASE_STATUS_CHANGED",
            "performed_by": current_user.id,
            "entity_type": "support_case",
            "entity_id": case_id,
            "metadata": {
                "old_status": old_case.get("status"),
                "new_status": payload.status,
                "assigned_to": current_user.id if assign_requested else old_case.get("assigned_to"),
            },
        }).execute()
    except Exception:
        pass  # Audit failures are non-fatal

    # TODO: dispatch notification to requester_id regarding case status change (stub)

    updated_case = upd_res.data[0] if upd_res.data else {**old_case, **update_data}
    return {"case": updated_case}
