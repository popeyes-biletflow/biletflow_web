from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import notify
from deps import db_for_user, get_current_user, sanitize_error
from promo import require_organizer
from schemas import CurrentUser

router = APIRouter(tags=["refunds"])

ERRORS = {
    "AUTH_REQUIRED": 401,
    "ORDER_NOT_FOUND": 404,
    "ORDER_NOT_REFUNDABLE": 409,
    "TICKET_ALREADY_USED": 409,
    "NOTHING_TO_REFUND": 409,
    "REFUND_NOT_ALLOWED": 403,
    "REFUND_WINDOW_CLOSED": 409,
}


class RefundIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class PolicyIn(BaseModel):
    refund_policy: Literal["none", "full_until_start", "full_24h_before"]


def run_refund(user: CurrentUser, order_id: str, reason: str | None) -> dict:
    db = db_for_user(user.access_token)
    try:
        data = db.rpc("refund_order", {"p_order_id": order_id, "p_reason": reason}).execute().data
    except Exception as e:
        msg = str(getattr(e, "message", None) or e)
        for code, http_status in ERRORS.items():
            if code in msg:
                raise HTTPException(http_status, code)
        raise HTTPException(500, sanitize_error(e))

    if data and not data.get("already_refunded"):
        try:
            order = db.table("orders").select("*").eq("id", order_id).execute().data[0]
            event = db.table("events").select("*").eq("id", order["event_id"]).execute().data[0]
            ctx = notify.event_ctx(event)
            ctx["total"] = f"{int(data['amount_kzt']):,} ₸".replace(",", " ")
            ctx["path"] = f"/orders/{order_id}"
            notify.notify("REFUND_COMPLETED", order["user_id"], ctx, f"refund:{data['refund_id']}",
                          data={"order_id": order_id})
        except Exception:
            pass
    return data


@router.post("/api/me/orders/{order_id}/refund")
async def refund_my_order(order_id: str, body: RefundIn | None = None,
                          user: CurrentUser = Depends(get_current_user)):
    return run_refund(user, order_id, body.reason if body else None)


@router.post("/api/organizer/orders/{order_id}/refund")
async def refund_attendee_order(order_id: str, body: RefundIn | None = None,
                                user: CurrentUser = Depends(get_current_user)):
    require_organizer(user)
    return run_refund(user, order_id, body.reason if body else None)


@router.patch("/api/organizer/events/{event_id}/refund-policy")
async def set_refund_policy(event_id: str, body: PolicyIn, user: CurrentUser = Depends(get_current_user)):
    require_organizer(user)
    db = db_for_user(user.access_token)
    try:
        res = (db.table("events").update({"refund_policy": body.refund_policy})
               .eq("id", event_id).eq("organizer_id", user.id).execute())
    except Exception as e:
        raise HTTPException(500, sanitize_error(e))
    if not res.data:
        raise HTTPException(404, "Event not found.")
    return {"event_id": event_id, "refund_policy": body.refund_policy}