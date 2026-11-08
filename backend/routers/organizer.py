"""Organizer router — PB-16 Paid Sales Activation.

Endpoint
--------
POST /api/organizer/events/{event_id}/activate-paid-sales

Checklist (all must pass, returned per-item):
  a) at least one paid ticket type on the event
  b) organizer identity verified (sandbox flag or simulation)
  c) valid payout account on the organizer profile (non-empty string)
  d) paid-event terms accepted (body flag)
  e) activation fee paid (simulated)

Idempotency:
  - If paid_sales_status == 'ACTIVE'    → 200 with current state (no-op, not charged again)
  - If paid_sales_status == 'SUSPENDED' → 403 Forbidden

Currency: KZT — activation fee: from config (PAID_SALES_ACTIVATION_FEE_KZT, default 5000 KZT)
"""
import os
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from deps import db_for_user, get_current_user, supabase
from schemas import (
    CurrentUser,
    PaidSalesActivationRequest,
    ROLE_ORGANIZER,
    ROLE_PLATFORM_ADMIN,
)

router = APIRouter(prefix="/api/organizer", tags=["organizer"])

ACTIVATION_FEE_KZT = int(os.getenv("PAID_SALES_ACTIVATION_FEE_KZT", "5000"))


def _assert_organizer_or_platform_admin(current_user: CurrentUser) -> None:
    role = (current_user.role or "").strip().lower()
    if role not in (ROLE_ORGANIZER, ROLE_PLATFORM_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only event organizers or platform admins can activate paid sales.",
        )


@router.post("/events/{event_id}/activate-paid-sales")
async def activate_paid_sales(
    event_id: str,
    payload: PaidSalesActivationRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Run the paid-sales activation checklist and activate the event if all pass."""
    _assert_organizer_or_platform_admin(current_user)

    db = db_for_user(current_user.access_token)

    # ------------------------------------------------------------------
    # 1. Fetch the event
    # ------------------------------------------------------------------
    try:
        event_res = (
            db.table("events")
            .select("*")
            .eq("id", event_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )

    if not event_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found.",
        )

    event_row = event_res.data[0]
    role = (current_user.role or "").strip().lower()

    # Ownership check: the event's owning organizer only (platform_admin can bypass)
    if role == ROLE_ORGANIZER:
        if str(event_row.get("organizer_id", "")) != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not manage this event.",
            )

    # ------------------------------------------------------------------
    # 2. Idempotency & suspension guards
    # ------------------------------------------------------------------
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

    if current_status == "SUSPENDED":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Paid sales for this event are suspended by an administrator.",
        )

    # ------------------------------------------------------------------
    # 3. Check ticket types for at least one paid ticket type
    # ------------------------------------------------------------------
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
            detail=str(exc),
        )

    has_paid_ticket_type = any(
        (row.get("price") or 0) > 0 for row in (tt_res.data or [])
    )

    # ------------------------------------------------------------------
    # 4. Validate checklist
    # payout_info is valid if it is a non-empty string.
    # ------------------------------------------------------------------
    payout_info = current_user.payout_info
    has_payout_info = bool(isinstance(payout_info, str) and payout_info.strip())
    identity_verified_simulated = True  # Sandbox flag / simulation

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
            "passed": True,  # Simulated payment succeeds
            "simulated": True,
            "amount_kzt": ACTIVATION_FEE_KZT,
            "detail": f"Activation fee of {ACTIVATION_FEE_KZT} KZT simulated successfully.",
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

    # ------------------------------------------------------------------
    # 5. Multi-step write in single transaction: RPC if available, fallback otherwise
    # ------------------------------------------------------------------
    payment_id = str(uuid.uuid4())
    activated_event = None

    # Try Postgres RPC for single-transaction atomic execution
    use_fallback = False
    try:
        rpc_res = db.rpc(
            "activate_paid_sales",
            {
                "p_event_id": event_id,
                "p_organizer_id": current_user.id,
                "p_amount": ACTIVATION_FEE_KZT,
            },
        ).execute()
        if rpc_res and rpc_res.data:
            payment_id = rpc_res.data.get("payment_id", payment_id)
        else:
            use_fallback = True
    except Exception:
        use_fallback = True

    if use_fallback:
        # Fallback table writes: insert payment, update event, insert audit_log
        try:
            supabase.table("payments").insert({
                "id": payment_id,
                "user_id": current_user.id,
                "event_id": event_id,
                "amount": ACTIVATION_FEE_KZT,
                "currency": "KZT",
                "status": "completed",
                "simulated": True,
            }).execute()
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to record activation payment: {exc}",
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
                detail=f"Failed to activate event: {exc}",
            )

        try:
            supabase.table("audit_log").insert({
                "action": "PAID_SALES_ACTIVATED",
                "performed_by": current_user.id,
                "entity_type": "event",
                "entity_id": event_id,
                "metadata": {
                    "payment_id": payment_id,
                    "activation_fee_kzt": ACTIVATION_FEE_KZT,
                    "simulated": True,
                    "checklist": checklist,
                },
            }).execute()
        except Exception:
            pass  # Audit failures are non-fatal

    if not activated_event:
        activated_event = {
            **event_row,
            "paid_sales_status": "ACTIVE",
            "paid_sales_active": True,
        }

    return {
        "status": "activated",
        "paid_sales_status": "ACTIVE",
        "paid_sales_active": True,
        "event_id": event_id,
        "payment_id": payment_id,
        "activation_fee_kzt": ACTIVATION_FEE_KZT,
        "simulated": True,
        "checklist": checklist,
        "event": activated_event,
    }
