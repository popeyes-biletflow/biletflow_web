"""Organizer router — PB-16 Paid Sales Activation & FS-04 Staff Assignments.

Endpoints
---------
GET    /api/organizer/events/{event_id}/activation
POST   /api/organizer/events/{event_id}/activate-paid-sales
POST   /api/organizer/events/{event_id}/staff
GET    /api/organizer/events/{event_id}/staff
DELETE /api/organizer/events/{event_id}/staff/{user_id}
"""
import os
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from deps import db_for_user, get_current_user, sanitize_error, supabase
from schemas import (
    CurrentUser,
    PaidSalesActivationRequest,
    ROLE_EVENT_ADMIN,
    ROLE_ORGANIZER,
    ROLE_PLATFORM_ADMIN,
    StaffAssignmentItem,
    StaffAssignmentRequest,
)

router = APIRouter(prefix="/api/organizer", tags=["organizer"])

DEFAULT_ACTIVATION_FEE_KZT = int(os.getenv("PAID_SALES_ACTIVATION_FEE_KZT", "5000"))


def _assert_organizer_or_platform_admin(current_user: CurrentUser) -> None:
    role = (current_user.role or "").strip().lower()
    if role not in (ROLE_ORGANIZER, ROLE_PLATFORM_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only event organizers or platform admins can activate paid sales.",
        )


def _assert_owns_event(db: Any, event_id: str, current_user: CurrentUser) -> dict:
    try:
        event_res = db.table("events").select("*").eq("id", event_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))

    if not event_res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

    event_row = event_res.data[0]
    role = (current_user.role or "").strip().lower()
    if role != ROLE_PLATFORM_ADMIN and str(event_row.get("organizer_id", "")) != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not manage this event.",
        )
    return event_row


def get_current_activation_fee() -> int:
    try:
        res = supabase.table("platform_settings").select("value").eq("key", "activation_fee_kzt").execute()
        if res.data and res.data[0].get("value"):
            return int(res.data[0]["value"])
    except Exception:
        pass
    return DEFAULT_ACTIVATION_FEE_KZT


@router.get("/events/{event_id}/activation")
async def activation_status(
    event_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    _assert_organizer_or_platform_admin(current_user)
    db = db_for_user(current_user.access_token)
    event_row = _assert_owns_event(db, event_id, current_user)

    try:
        tiers = db.table("ticket_types").select("id, price").eq("event_id", event_id).execute().data or []
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))

    paid_status = event_row.get("paid_sales_status") or "NONE"
    active = paid_status == "ACTIVE" or bool(event_row.get("paid_sales_active"))
    fee = get_current_activation_fee()
    payout = current_user.payout_info
    has_paid_tier = any((row.get("price") or 0) > 0 for row in tiers)
    has_payout = bool(isinstance(payout, str) and payout.strip())

    return {
        "event_id": event_id,
        "paid_sales_status": "SUSPENDED" if event_row.get("is_suspended") else paid_status,
        "paid_sales_active": active,
        "activation_fee_kzt": fee,
        "simulated": True,
        "checklist": {
            "at_least_one_paid_ticket_type": {"passed": has_paid_tier},
            "valid_payout_account": {"passed": has_payout},
            "identity_verified": {"passed": True, "simulated": True},
            "activation_fee_paid": {"passed": active, "simulated": True, "amount_kzt": fee},
        },
    }


@router.post("/events/{event_id}/activate-paid-sales")
async def activate_paid_sales(
    event_id: str,
    payload: PaidSalesActivationRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Run the paid-sales activation checklist and activate the event if all pass."""
    _assert_organizer_or_platform_admin(current_user)
    db = db_for_user(current_user.access_token)
    event_row = _assert_owns_event(db, event_id, current_user)

    current_status = event_row.get("paid_sales_status", "NONE")
    current_active = bool(event_row.get("paid_sales_active", False))

    if current_status == "ACTIVE" or current_active:
        return {
            "status": "already_active",
            "paid_sales_status": "ACTIVE",
            "paid_sales_active": True,
            "event_id": event_id,
            "message": "Paid sales are already active for this event.",
        }

    if current_status == "SUSPENDED" or event_row.get("is_suspended"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Paid sales for this event are suspended by an administrator.",
        )

    # 3. Check ticket types for at least one paid ticket type
    try:
        tt_res = (
            db.table("ticket_types")
            .select("id, price")
            .eq("event_id", event_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=sanitize_error(exc),
        )

    has_paid_ticket_type = any(
        (row.get("price") or 0) > 0 for row in (tt_res.data or [])
    )

    payout_info = current_user.payout_info
    has_payout_info = bool(isinstance(payout_info, str) and payout_info.strip())
    identity_verified_simulated = True  # Sandbox flag / simulation
    activation_fee = get_current_activation_fee()

    checklist: dict[str, dict[str, Any]] = {
        "at_least_one_paid_ticket_type": {
            "passed": has_paid_ticket_type,
            "detail": (
                "OK" if has_paid_ticket_type
                else "At least one ticket type with price > 0 is required."
            ),
        },
        "identity_verified": {
            "passed": identity_verified_simulated,
            "simulated": True,
            "detail": "Organizer identity verified (sandbox simulation).",
        },
        "valid_payout_account": {
            "passed": has_payout_info,
            "detail": (
                "OK" if has_payout_info
                else "Valid payout account (payout_info) is required on your profile."
            ),
        },
        "paid_event_terms_accepted": {
            "passed": bool(payload.paid_event_terms_accepted),
            "detail": (
                "OK" if payload.paid_event_terms_accepted
                else "You must accept the paid-event terms."
            ),
        },
        "activation_fee_paid": {
            "passed": True,
            "simulated": True,
            "amount_kzt": activation_fee,
            "detail": f"Activation fee of {activation_fee} KZT simulated successfully.",
        },
    }

    all_passed = all(item["passed"] for item in checklist.values())

    if not all_passed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "Paid sales activation checklist failed.",
                "checklist": checklist,
            },
        )

    payment_id = str(uuid.uuid4())
    activated_event = None

    use_fallback = False
    try:
        rpc_res = db.rpc(
            "activate_paid_sales",
            {
                "p_event_id": event_id,
                "p_organizer_id": current_user.id,
                "p_amount": activation_fee,
            },
        ).execute()
        if rpc_res and rpc_res.data:
            payment_id = rpc_res.data.get("payment_id", payment_id)
        else:
            use_fallback = True
    except Exception:
        use_fallback = True

    if use_fallback:
        try:
            supabase.table("payments").insert({
                "id": payment_id,
                "user_id": current_user.id,
                "event_id": event_id,
                "amount": activation_fee,
                "currency": "KZT",
                "status": "completed",
                "simulated": True,
            }).execute()
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to record activation payment: {sanitize_error(exc)}",
            )

        try:
            upd_res = (
                db.table("events")
                .update({
                    "paid_sales_status": "ACTIVE",
                    "paid_sales_active": True,
                })
                .eq("id", event_id)
                .execute()
            )
            if upd_res.data:
                activated_event = upd_res.data[0]
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to activate event: {sanitize_error(exc)}",
            )

        try:
            supabase.table("audit_log").insert({
                "action": "PAID_SALES_ACTIVATED",
                "performed_by": current_user.id,
                "entity_type": "event",
                "entity_id": event_id,
                "metadata": {
                    "payment_id": payment_id,
                    "activation_fee_kzt": activation_fee,
                    "simulated": True,
                    "checklist": checklist,
                },
            }).execute()
        except Exception:
            pass

    if not activated_event:
        activated_event = {
            **event_row,
            "paid_sales_status": "ACTIVE",
            "paid_sales_active": True,
        }

    try:
        import notify
        notify.notify(
            "PAYOUT_STATUS", current_user.id,
            {"event_title": event_row.get("title") or "", "status": "ACTIVE",
             "reason": "Demo payout account verified, activation fee recorded (simulated).",
             "path": f"/organizer/events/{event_id}"},
            f"payout:{event_id}:active", email=current_user.email,
        )
    except Exception:
        pass

    return {
        "status": "activated",
        "paid_sales_status": "ACTIVE",
        "paid_sales_active": True,
        "event_id": event_id,
        "payment_id": payment_id,
        "activation_fee_kzt": activation_fee,
        "simulated": True,
        "checklist": checklist,
        "event": activated_event,
    }


# ---------------------------------------------------------------------------
# FS-04: Staff Assignments
# ---------------------------------------------------------------------------

@router.post("/events/{event_id}/staff", response_model=StaffAssignmentItem, status_code=status.HTTP_201_CREATED)
def assign_event_staff(
    event_id: str,
    payload: StaffAssignmentRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> StaffAssignmentItem:
    """Assign an event admin / staff member to manage check-ins for this event."""
    _assert_organizer_or_platform_admin(current_user)
    db = db_for_user(current_user.access_token)
    _assert_owns_event(db, event_id, current_user)

    target_user_id = payload.user_id
    email = payload.email

    if not target_user_id and not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either user_id or email is required.",
        )

    # Locate profile
    try:
        if target_user_id:
            prof_res = supabase.table("profiles").select("*").eq("id", target_user_id).execute()
        else:
            prof_res = supabase.table("profiles").select("*").eq("email", email).execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))

    if not prof_res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User profile not found.")

    target_user = prof_res.data[0]
    uid = str(target_user["id"])

    # Promote attendee to event_admin if they don't already have staff role
    current_role = (target_user.get("role") or "").strip().lower()
    if current_role == "attendee":
        try:
            supabase.table("profiles").update({"role": ROLE_EVENT_ADMIN}).eq("id", uid).execute()
        except Exception:
            pass

    # Record assignment in event_staff
    assignment_id = str(uuid.uuid4())
    try:
        supabase.table("event_staff").upsert({
            "id": assignment_id,
            "event_id": event_id,
            "user_id": uid,
            "assigned_by": current_user.id,
        }).execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))

    try:
        supabase.table("audit_log").insert({
            "action": "STAFF_ASSIGNED",
            "performed_by": current_user.id,
            "entity_type": "event_staff",
            "entity_id": assignment_id,
            "metadata": {"event_id": event_id, "user_id": uid, "assigned_by": current_user.id},
        }).execute()
    except Exception:
        pass

    return StaffAssignmentItem(
        id=assignment_id,
        event_id=event_id,
        user_id=uid,
        email=target_user.get("email"),
        full_name=target_user.get("full_name"),
    )


@router.get("/events/{event_id}/staff", response_model=list[StaffAssignmentItem])
def list_event_staff(
    event_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> list[StaffAssignmentItem]:
    """List staff assigned to this event."""
    _assert_organizer_or_platform_admin(current_user)
    db = db_for_user(current_user.access_token)
    _assert_owns_event(db, event_id, current_user)

    try:
        staff_res = supabase.table("event_staff").select("*").eq("event_id", event_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))

    assignments = staff_res.data or []
    if not assignments:
        return []

    uids = [str(r["user_id"]) for r in assignments if r.get("user_id")]
    profiles = {}
    if uids:
        try:
            p_res = supabase.table("profiles").select("id, email, full_name").in_("id", uids).execute()
            for p in (p_res.data or []):
                profiles[str(p["id"])] = p
        except Exception:
            pass

    return [
        StaffAssignmentItem(
            id=str(r.get("id") or ""),
            event_id=event_id,
            user_id=str(r["user_id"]),
            email=profiles.get(str(r["user_id"]), {}).get("email"),
            full_name=profiles.get(str(r["user_id"]), {}).get("full_name"),
            assigned_at=str(r.get("assigned_at") or ""),
        )
        for r in assignments
    ]


@router.delete("/events/{event_id}/staff/{user_id}", status_code=status.HTTP_200_OK)
def remove_event_staff(
    event_id: str,
    user_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Remove a staff member from this event."""
    _assert_organizer_or_platform_admin(current_user)
    db = db_for_user(current_user.access_token)
    _assert_owns_event(db, event_id, current_user)

    try:
        supabase.table("event_staff").delete().eq("event_id", event_id).eq("user_id", user_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(exc))

    try:
        supabase.table("audit_log").insert({
            "action": "STAFF_UNASSIGNED",
            "performed_by": current_user.id,
            "entity_type": "event_staff",
            "entity_id": f"{event_id}:{user_id}",
            "metadata": {"event_id": event_id, "user_id": user_id, "unassigned_by": current_user.id},
        }).execute()
    except Exception:
        pass

    return {"success": True, "message": "Staff member removed from event."}
