import secrets
import uuid

from decimal import Decimal, ROUND_HALF_UP
from typing import Literal

from dotenv import load_dotenv

load_dotenv()

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from crypto import ticket_qr_payload
from deps import db_for_user, get_current_user
from promo import call_rpc, require_organizer
from schemas import CurrentUser

router = APIRouter()

RATES = {"KZT": Decimal("1"), "USD": Decimal("500"), "EUR": Decimal("550"), "RUB": Decimal("5.5")}
DECIMALS = {"KZT": 0, "USD": 2, "EUR": 2, "RUB": 2}
FEE_PERCENT = 5


class AttendeeIn(BaseModel):
    name: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=200)


class OrderIn(BaseModel):
    hold_id: str
    currency: Literal["KZT", "USD", "EUR", "RUB"] = "KZT"
    # исход демо-оплаты выбирается явно, номер карты не собираем
    payment_outcome: Literal["approved", "declined"] = "approved"
    attendees: list[AttendeeIn] = Field(default_factory=list, max_length=10)


def mock_charge(outcome, total_kzt, currency):
    # симуляция оплаты, реальных денег нет
    if total_kzt == 0:
        return {"gateway": "none", "status": "free", "transaction_id": None, "simulated": True}
    if outcome == "declined":
        return {"gateway": "MockPay", "status": "declined", "reason": "card_declined", "simulated": True}
    return {"gateway": "MockPay", "status": "approved", "transaction_id": "mock_" + secrets.token_hex(8), "simulated": True}


def convert(total_kzt, currency):
    rate = RATES[currency]
    dec = DECIMALS[currency]
    minor = int((Decimal(total_kzt) / rate * (10 ** dec)).quantize(Decimal(1), ROUND_HALF_UP))
    return rate, dec, minor


def format_minor(minor, dec):
    return f"{Decimal(minor) / (10 ** dec):.{dec}f}"


def order_response(db, order, event, user_id, payment, replayed):
    # билеты берём из базы — так и при повторе ответ будет тот же
    rows = db.table("tickets").select("id, attendee_name, status").eq("order_id", order["id"]).order("id").execute().data or []
    tickets = []
    for t in rows:
        payload, _ = ticket_qr_payload(str(t["id"]), str(order["event_id"]), user_id, event)
        tickets.append({"ticket_id": str(t["id"]), "attendee_name": t.get("attendee_name"), "qr_payload": payload})

    total = int(order.get("total_amount") or 0)
    currency = order.get("currency") or "KZT"
    rate, dec, minor = convert(total, currency)
    status = order.get("status")
    if not status:
        status = "completed" if total == 0 else "paid"

    return {
        "order_id": str(order["id"]),
        "status": status,
        "event_id": str(order["event_id"]),
        "replayed": replayed,
        "breakdown_kzt": {
            "subtotal": int(order.get("subtotal_kzt") or 0),
            "discount": int(order.get("discount_kzt") or 0),
            "fee": int(order.get("fee_kzt") or 0),
            "total": total,
        },
        "charged": {"currency": currency, "amount": format_minor(minor, dec), "rate_kzt_per_unit": str(rate), "sandbox_rate": True},
        "payment": payment or {"gateway": "MockPay", "status": "approved", "simulated": True},
        "tickets": tickets,
    }


@router.post("/api/orders", status_code=201)
async def create_order(body: OrderIn, user: CurrentUser = Depends(get_current_user)):
    db = db_for_user(user.access_token)

    res = db.table("ticket_holds").select("*").eq("id", body.hold_id).eq("user_id", user.id).execute()
    if not res.data:
        raise HTTPException(404, "HOLD_NOT_FOUND")
    hold = res.data[0]

    ev = db.table("events").select("id,starts_at,ends_at").eq("id", hold["event_id"]).execute()
    event = ev.data[0] if ev.data else {}

    # двойной клик или повтор после обрыва — отдаём уже созданный заказ
    if hold["status"] == "converted":
        existing = db.table("orders").select("*").eq("hold_id", body.hold_id).execute().data
        if existing:
            return order_response(db, existing[0], event, user.id, None, replayed=True)
    if hold["status"] != "active":
        raise HTTPException(409, "HOLD_NOT_ACTIVE")

    total = int(hold["total_kzt"] or 0)
    rate, dec, minor = convert(total, body.currency)
    payment = mock_charge(body.payment_outcome, total, body.currency)
    if payment["status"] == "declined":
        # холд не трогаем, можно попробовать ещё раз
        raise HTTPException(402, {"code": "PAYMENT_DECLINED", **payment})

    tickets_db = []
    for i in range(hold["quantity"]):
        tid = str(uuid.uuid4())
        _, sig = ticket_qr_payload(tid, hold["event_id"], user.id, event)
        who = body.attendees[i] if i < len(body.attendees) else AttendeeIn()
        tickets_db.append({
            "id": tid,
            "qr_code_hash": sig,
            "attendee_name": who.name.strip() or user.full_name or "",
            "attendee_email": who.email.strip() or user.email or "",
        })

    order_id = call_rpc(db, "finalize_order", {
        "p_hold_id": body.hold_id,
        "p_currency": body.currency,
        "p_fx_rate": str(rate),
        "p_charged_minor": minor,
        "p_gateway_txn": payment.get("transaction_id") or "free",
        "p_tickets": tickets_db,
    })

    order = {
        "id": order_id,
        "event_id": hold["event_id"],
        "status": "completed" if total == 0 else "paid",
        "subtotal_kzt": hold["subtotal_kzt"],
        "discount_kzt": hold["discount_kzt"],
        "fee_kzt": hold["fee_kzt"],
        "total_amount": total,
        "currency": body.currency,
    }
    return order_response(db, order, event, user.id, payment, replayed=False)


@router.post("/api/checkout/holds/{hold_id}/release")
async def release_hold(hold_id: str, user: CurrentUser = Depends(get_current_user)):
    # пользователь закрыл оформление — возвращаем билеты в продажу
    db = db_for_user(user.access_token)
    released = call_rpc(db, "release_ticket_hold", {"p_hold_id": hold_id})
    return {"released": bool(released)}


@router.get("/api/organizer/campaigns/stats")
async def campaigns_stats(
    event_id: str | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    require_organizer(user)
    db = db_for_user(user.access_token)
    data = call_rpc(db, "campaign_stats", {"p_event_id": event_id}) or {}
    campaigns = data.get("campaigns") or []
    for c in campaigns:
        scans = c.get("qr_scans") or 0
        c["conversion_rate"] = round(c["orders"] / scans, 4) if scans else None
    return {"campaigns": campaigns, "totals": data.get("totals") or {}}