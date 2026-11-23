"""Platform Moderation & Administration Router — FS-03.

Endpoints:
  POST  /api/admin/events/{event_id}/suspend
  POST  /api/admin/events/{event_id}/unsuspend
  POST  /api/admin/users/{user_id}/suspend
  POST  /api/admin/users/{user_id}/unsuspend
  GET   /api/admin/users
  GET   /api/admin/events
  GET   /api/admin/orders
  GET   /api/admin/payments
  GET   /api/admin/reports
  GET   /api/admin/settings/activation-fee
  PATCH /api/admin/settings/activation-fee
  GET   /api/admin/export

Access Control:
  Strictly restricted to platform_admin. Attendees and organizers receive 403 Forbidden.
"""
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from deps import db_for_user, get_current_user, sanitize_error, supabase
from schemas import (
    ActivationFeeSettingSchema,
    AdminEventItem,
    AdminSuspensionRequest,
    AdminSuspensionResponse,
    AdminUserItem,
    CurrentUser,
    OperationalExportResponse,
    ROLE_PLATFORM_ADMIN,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])

REVENUE_ORDER_STATUSES = ("paid", "completed")


def record_audit(entry: dict) -> bool:
    try:
        supabase.table("audit_log").insert(entry).execute()
        return True
    except Exception:
        return False


def ensure_applied(res, what: str) -> None:
    if not getattr(res, "data", None):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"The {what} update was not applied: platform admin write access is missing in the database policies.",
        )


def require_reason(payload: AdminSuspensionRequest) -> str:
    reason = (payload.reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A suspension reason is required.")
    return reason


def event_was_activated(event_id: str) -> bool:
    try:
        rows = (
            supabase.table("payments")
            .select("id")
            .eq("event_id", event_id)
            .eq("status", "completed")
            .eq("simulated", True)
            .execute()
            .data
        )
        return bool(rows)
    except Exception:
        return False


def page(rows: list, offset: int, limit: int) -> list:
    return sorted(rows, key=lambda r: str(r.get("created_at") or ""), reverse=True)[offset:offset + limit]


def require_platform_admin(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Enforce platform_admin role."""
    role = (current_user.role or "").strip().lower()
    if role != ROLE_PLATFORM_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Platform admin permissions required.",
        )
    return current_user


# ---------------------------------------------------------------------------
# Event Suspension / Unsuspension
# ---------------------------------------------------------------------------

@router.post("/events/{event_id}/suspend", response_model=AdminSuspensionResponse)
def suspend_event(
    event_id: str,
    payload: AdminSuspensionRequest = AdminSuspensionRequest(),
    admin: CurrentUser = Depends(require_platform_admin),
) -> AdminSuspensionResponse:
    """Suspend an event, immediately halting all new sales and ticket check-ins."""
    reason = require_reason(payload)
    db = db_for_user(admin.access_token)
    try:
        ev_res = db.table("events").select("*").eq("id", event_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))

    if not ev_res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

    try:
        upd = db.table("events").update({
            "is_suspended": True,
            "paid_sales_status": "SUSPENDED",
            "paid_sales_active": False,
        }).eq("id", event_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))
    ensure_applied(upd, "event")

    # Audit log entry
    audited = record_audit({
        "action": "EVENT_SUSPENDED",
        "performed_by": admin.id,
        "entity_type": "event",
        "entity_id": event_id,
        "metadata": {"reason": reason, "suspended_at": datetime.now(timezone.utc).isoformat()},
    })

    try:
        import notify
        ev = ev_res.data[0]
        if ev.get("organizer_id"):
            notify.notify(
                "PAYOUT_STATUS", str(ev["organizer_id"]),
                {"event_title": ev.get("title") or "", "status": "SUSPENDED",
                 "reason": payload.reason or "Suspended by platform administrator.",
                 "path": f"/organizer/events/{event_id}"},
                f"payout:{event_id}:suspended:{datetime.now(timezone.utc).isoformat()}",
            )
    except Exception:
        pass

    return AdminSuspensionResponse(
        success=True,
        suspended=True,
        message="Event suspended successfully.",
        entity_id=event_id,
        audit_recorded=audited,
    )


@router.post("/events/{event_id}/unsuspend", response_model=AdminSuspensionResponse)
def unsuspend_event(
    event_id: str,
    admin: CurrentUser = Depends(require_platform_admin),
) -> AdminSuspensionResponse:
    """Unsuspend an event, restoring its active state."""
    db = db_for_user(admin.access_token)
    try:
        ev_res = db.table("events").select("*").eq("id", event_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))

    if not ev_res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

    restore_paid = event_was_activated(event_id)
    try:
        upd = db.table("events").update({
            "is_suspended": False,
            "paid_sales_status": "ACTIVE" if restore_paid else "NONE",
            "paid_sales_active": restore_paid,
        }).eq("id", event_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))
    ensure_applied(upd, "event")

    audited = record_audit({
        "action": "EVENT_UNSUSPENDED",
        "performed_by": admin.id,
        "entity_type": "event",
        "entity_id": event_id,
        "metadata": {"unsuspended_at": datetime.now(timezone.utc).isoformat()},
    })

    return AdminSuspensionResponse(
        success=True,
        suspended=False,
        message="Event unsuspended successfully.",
        entity_id=event_id,
        audit_recorded=audited,
    )


# ---------------------------------------------------------------------------
# User Suspension / Unsuspension
# ---------------------------------------------------------------------------

@router.post("/users/{user_id}/suspend", response_model=AdminSuspensionResponse)
def suspend_user(
    user_id: str,
    payload: AdminSuspensionRequest = AdminSuspensionRequest(),
    admin: CurrentUser = Depends(require_platform_admin),
) -> AdminSuspensionResponse:
    """Suspend a user account, disabling actions platform-wide."""
    reason = require_reason(payload)
    db = db_for_user(admin.access_token)
    try:
        u_res = db.table("profiles").select("*").eq("id", user_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))

    if not u_res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    try:
        upd = db.table("profiles").update({"is_suspended": True}).eq("id", user_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))
    ensure_applied(upd, "user")

    audited = record_audit({
        "action": "USER_SUSPENDED",
        "performed_by": admin.id,
        "entity_type": "user",
        "entity_id": user_id,
        "metadata": {"reason": reason, "suspended_at": datetime.now(timezone.utc).isoformat()},
    })

    return AdminSuspensionResponse(
        success=True,
        suspended=True,
        message="User suspended successfully.",
        entity_id=user_id,
        audit_recorded=audited,
    )


@router.post("/users/{user_id}/unsuspend", response_model=AdminSuspensionResponse)
def unsuspend_user(
    user_id: str,
    admin: CurrentUser = Depends(require_platform_admin),
) -> AdminSuspensionResponse:
    """Unsuspend a user account."""
    db = db_for_user(admin.access_token)
    try:
        u_res = db.table("profiles").select("*").eq("id", user_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))

    if not u_res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    try:
        upd = db.table("profiles").update({"is_suspended": False}).eq("id", user_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))
    ensure_applied(upd, "user")

    audited = record_audit({
        "action": "USER_UNSUSPENDED",
        "performed_by": admin.id,
        "entity_type": "user",
        "entity_id": user_id,
        "metadata": {"unsuspended_at": datetime.now(timezone.utc).isoformat()},
    })

    return AdminSuspensionResponse(
        success=True,
        suspended=False,
        message="User unsuspended successfully.",
        entity_id=user_id,
        audit_recorded=audited,
    )


# ---------------------------------------------------------------------------
# Admin Searches & Moderation Views
# ---------------------------------------------------------------------------

@router.get("/users", response_model=list[AdminUserItem])
def search_users(
    q: Optional[str] = Query(None, description="Search by email or name"),
    role: Optional[str] = Query(None, description="Filter by role"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    admin: CurrentUser = Depends(require_platform_admin),
) -> list[AdminUserItem]:
    """Admin-only search for platform users."""
    db = db_for_user(admin.access_token)
    try:
        query = db.table("profiles").select("*")
        if role:
            query = query.eq("role", role)
        res = query.execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))

    rows = res.data or []
    if q:
        needle = q.strip().lower()
        rows = [
            r for r in rows
            if needle in (r.get("email") or "").lower()
            or needle in (r.get("full_name") or "").lower()
        ]

    return [
        AdminUserItem(
            id=str(r["id"]),
            email=r.get("email") or "",
            full_name=r.get("full_name"),
            role=r.get("role") or "attendee",
            payout_info=r.get("payout_info"),
            is_suspended=bool(r.get("is_suspended", False)),
            created_at=str(r.get("created_at") or ""),
        )
        for r in page(rows, offset, limit)
    ]


@router.get("/events", response_model=list[AdminEventItem])
def search_events(
    q: Optional[str] = Query(None, description="Search by title"),
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    admin: CurrentUser = Depends(require_platform_admin),
) -> list[AdminEventItem]:
    """Admin-only search for platform events."""
    db = db_for_user(admin.access_token)
    try:
        query = db.table("events").select("*")
        if status_filter:
            query = query.eq("status", status_filter)
        res = query.execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))

    rows = res.data or []
    if q:
        needle = q.strip().lower()
        rows = [r for r in rows if needle in (r.get("title") or "").lower()]

    return [
        AdminEventItem(
            id=str(r["id"]),
            title=r.get("title") or "Untitled",
            organizer_id=str(r["organizer_id"]) if r.get("organizer_id") else None,
            status=r.get("status") or "draft",
            visibility=r.get("visibility") or "public",
            paid_sales_status=r.get("paid_sales_status") or "NONE",
            paid_sales_active=bool(r.get("paid_sales_active", False)),
            is_suspended=bool(r.get("is_suspended", False)),
            created_at=str(r.get("created_at") or ""),
        )
        for r in page(rows, offset, limit)
    ]


@router.get("/orders")
def search_orders(
    user_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    admin: CurrentUser = Depends(require_platform_admin),
) -> list[dict[str, Any]]:
    """Admin-only search for orders."""
    db = db_for_user(admin.access_token)
    try:
        query = db.table("orders").select("*")
        if user_id:
            query = query.eq("user_id", user_id)
        if status_filter:
            query = query.eq("status", status_filter)
        res = query.execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))
    return page(res.data or [], offset, limit)


@router.get("/payments")
def search_payments(
    user_id: Optional[str] = Query(None),
    event_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    admin: CurrentUser = Depends(require_platform_admin),
) -> list[dict[str, Any]]:
    """Admin-only search for payment and refund records."""
    db = db_for_user(admin.access_token)
    try:
        query = db.table("payments").select("*")
        if user_id:
            query = query.eq("user_id", user_id)
        if event_id:
            query = query.eq("event_id", event_id)
        if status_filter:
            query = query.eq("status", status_filter)
        res = query.execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))
    return page(res.data or [], offset, limit)


@router.get("/reports")
def review_reports(
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    admin: CurrentUser = Depends(require_platform_admin),
) -> list[dict[str, Any]]:
    """Admin-only review of support cases and reported issues."""
    db = db_for_user(admin.access_token)
    try:
        query = db.table("support_cases").select("*")
        if status_filter:
            query = query.eq("status", status_filter)
        res = query.execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))
    return page(res.data or [], offset, limit)


# ---------------------------------------------------------------------------
# Settings & Operational Export
# ---------------------------------------------------------------------------

@router.get("/settings/activation-fee", response_model=ActivationFeeSettingSchema)
def get_activation_fee_setting(
    admin: CurrentUser = Depends(require_platform_admin),
) -> ActivationFeeSettingSchema:
    """Fetch current paid sales activation fee."""
    try:
        res = supabase.table("platform_settings").select("value").eq("key", "activation_fee_kzt").execute()
        if res.data and res.data[0].get("value"):
            fee = int(res.data[0]["value"])
            return ActivationFeeSettingSchema(activation_fee_kzt=fee)
    except Exception:
        pass
    import os
    default_fee = int(os.getenv("PAID_SALES_ACTIVATION_FEE_KZT", "5000"))
    return ActivationFeeSettingSchema(activation_fee_kzt=default_fee)


@router.patch("/settings/activation-fee", response_model=ActivationFeeSettingSchema)
def update_activation_fee_setting(
    payload: ActivationFeeSettingSchema,
    admin: CurrentUser = Depends(require_platform_admin),
) -> ActivationFeeSettingSchema:
    """Update paid sales activation fee."""
    if payload.activation_fee_kzt < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Activation fee must be >= 0.")
    try:
        supabase.table("platform_settings").upsert({
            "key": "activation_fee_kzt",
            "value": payload.activation_fee_kzt,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))

    try:
        supabase.table("audit_log").insert({
            "action": "ACTIVATION_FEE_UPDATED",
            "performed_by": admin.id,
            "entity_type": "settings",
            "entity_id": "activation_fee_kzt",
            "metadata": {"new_amount_kzt": payload.activation_fee_kzt},
        }).execute()
    except Exception:
        pass

    return payload


@router.get("/export", response_model=OperationalExportResponse)
def operational_export(
    admin: CurrentUser = Depends(require_platform_admin),
) -> OperationalExportResponse:
    """Basic operational export of platform data."""
    db = db_for_user(admin.access_token)
    try:
        events = db.table("events").select("*").execute().data or []
        orders = db.table("orders").select("*").execute().data or []
        tickets = db.table("tickets").select("id, status").execute().data or []
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))

    total_revenue = sum(int(o.get("total_amount") or 0) for o in orders if o.get("status") in REVENUE_ORDER_STATUSES)

    return OperationalExportResponse(
        events_count=len(events),
        orders_count=len(orders),
        tickets_count=len(tickets),
        total_revenue_kzt=total_revenue,
        timestamp=datetime.now(timezone.utc).isoformat(),
        events=events,
        orders=orders,
    )
