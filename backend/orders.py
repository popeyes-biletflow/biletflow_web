import secrets
import uuid
from datetime import datetime, timezone

from decimal import Decimal, ROUND_HALF_UP
from typing import Literal

from dotenv import load_dotenv

load_dotenv()

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

import notify
from crypto import ticket_qr_payload
from deps import db_for_user, get_current_user
from promo import PUBLIC_API_URL, call_rpc, require_organizer
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


def email_lang(request):
    # язык письма берём из заголовка браузера
    lang = (request.headers.get("accept-language") or "")[:2].lower()
    if lang in ("ru", "kk", "en"):
        return lang
    return notify.EMAIL_LANG


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
async def create_order(body: OrderIn, request: Request, user: CurrentUser = Depends(get_current_user)):
    db = db_for_user(user.access_token)

    res = db.table("ticket_holds").select("*").eq("id", body.hold_id).eq("user_id", user.id).execute()
    if not res.data:
        raise HTTPException(404, "HOLD_NOT_FOUND")
    hold = res.data[0]

    ev = db.table("events").select("*").eq("id", hold["event_id"]).execute()
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
        # холд не трогаем, можно попробовать ещё раз. Письмо об ошибке оплаты — один раз на холд
        try:
            ctx = notify.event_ctx(event)
            ctx["hold_until"] = str(hold.get("expires_at") or "")[11:16]
            ctx["path"] = f"/events/{hold['event_id']}"
            notify.notify("PAYMENT_FAILED", user.id, ctx, f"hold:{body.hold_id}:declined", email=user.email, lang=email_lang(request))
        except Exception:
            pass
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
    response = order_response(db, order, event, user.id, payment, replayed=False)

    # письмо с билетами. Если почта упала — заказ остаётся, письмо уйдёт при ретрае.
    # При повторном запросе второе письмо не придёт (dedupe по order_id)
    try:
        emails = {}
        for t in tickets_db:
            emails[t["id"]] = t["attendee_email"]
        tickets_for_mail = []
        for t in response["tickets"]:
            tickets_for_mail.append({**t, "attendee_email": emails.get(t["ticket_id"])})
        notify.notify_order_confirmed(order, event, user.id, user.email, user.full_name or user.email,
                                      tickets_for_mail, lang=email_lang(request))
    except Exception:
        pass
    return response


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
    details = campaign_details(db, [c["campaign_id"] for c in campaigns if c.get("campaign_id")])
    for c in campaigns:
        scans = c.get("qr_scans") or 0
        c["conversion_rate"] = round(c["orders"] / scans, 4) if scans else None
        c.update(details.get(str(c.get("campaign_id")), {}))
    return {"campaigns": campaigns, "totals": data.get("totals") or {}}


def campaign_state(row: dict, now: datetime) -> str:
    if row.get("is_disabled"):
        return "disabled"
    starts, ends = row.get("starts_at"), row.get("ends_at")
    if starts and parse_ts(starts) > now:
        return "scheduled"
    if ends and parse_ts(ends) <= now:
        return "expired"
    return "active"


def parse_ts(raw) -> datetime:
    value = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def campaign_details(db, ids: list) -> dict[str, dict]:
    if not ids:
        return {}
    try:
        rows = db.table("campaigns").select("*").in_("id", ids).execute().data or []
    except Exception:
        return {}
    now = datetime.now(timezone.utc)
    out = {}
    for row in rows:
        slug = row.get("qr_slug")
        out[str(row["id"])] = {
            "starts_at": row.get("starts_at"),
            "ends_at": row.get("ends_at"),
            "is_disabled": bool(row.get("is_disabled")),
            "discount_type": row.get("discount_type") or "percent",
            "discount_value": row.get("discount_value") if row.get("discount_value") is not None else row.get("discount_percent"),
            "ticket_type_id": row.get("ticket_type_id"),
            "qr_link": f"{PUBLIC_API_URL}/c/{slug}" if slug else None,
            "state": campaign_state(row, now),
        }
    return out