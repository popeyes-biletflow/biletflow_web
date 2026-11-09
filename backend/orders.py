import secrets
import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal

from dotenv import load_dotenv

load_dotenv()

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from crypto import generate_hmac_signature
from deps import db_for_user, get_current_user
from promo import call_rpc, require_organizer
from schemas import CurrentUser

router = APIRouter()

RATES = {"KZT": Decimal("1"), "USD": Decimal("500"), "EUR": Decimal("550"), "RUB": Decimal("5.5")}
DECIMALS = {"KZT": 0, "USD": 2, "EUR": 2, "RUB": 2}
FEE_PERCENT = 5


class OrderIn(BaseModel):
    hold_id: str
    currency: Literal["KZT", "USD", "EUR", "RUB"] = "KZT"
    card_number: str = Field(default="4242424242424242", min_length=12, max_length=19)


def mock_charge(card_number: str, total_kzt: int, currency: str) -> dict:
    if card_number.endswith("0002"):
        return {"gateway": "MockPay", "status": "declined", "reason": "card_declined"}
    return {"gateway": "MockPay", "status": "approved", "transaction_id": "mock_" + secrets.token_hex(8)}


def convert(total_kzt: int, currency: str):
    rate = RATES[currency]
    dec = DECIMALS[currency]
    minor = int((Decimal(total_kzt) / rate * (10 ** dec)).quantize(Decimal(1), ROUND_HALF_UP))
    return rate, dec, minor


def format_minor(minor: int, dec: int) -> str:
    return f"{Decimal(minor) / (10 ** dec):.{dec}f}"


def qr_expiry(event: dict) -> int:
    """QR действует до конца события + 24 часа."""
    raw = event.get("ends_at") or event.get("starts_at")
    if raw:
        end = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    else:
        end = datetime.now(timezone.utc) + timedelta(days=30)
    return int((end + timedelta(hours=24)).timestamp())


@router.post("/api/orders", status_code=201)
async def create_order(body: OrderIn, user: CurrentUser = Depends(get_current_user)):
    db = db_for_user(user.access_token)

    res = db.table("ticket_holds").select("*").eq("id", body.hold_id).eq("user_id", user.id).execute()
    if not res.data:
        raise HTTPException(404, "Hold not found")
    hold = res.data[0]
    if hold["status"] != "active":
        raise HTTPException(409, "Hold is no longer active")

    rate, dec, minor = convert(hold["total_kzt"], body.currency)
    payment = mock_charge(body.card_number, hold["total_kzt"], body.currency)
    if payment["status"] != "approved":
        raise HTTPException(402, payment)  

    ev = db.table("events").select("starts_at,ends_at").eq("id", hold["event_id"]).execute()
    expires_at = qr_expiry(ev.data[0] if ev.data else {})

    tickets_db, tickets_out = [], []
    for _ in range(hold["quantity"]):
        tid = str(uuid.uuid4())
        sig = generate_hmac_signature(tid, hold["event_id"], user.id, expires_at)
        tickets_db.append({"id": tid, "qr_code_hash": sig})
        tickets_out.append({
            "ticket_id": tid,
            "qr_payload": f"{tid}:{hold['event_id']}:{user.id}:{expires_at}:{sig}",
        })

    order_id = call_rpc(db, "finalize_order", {
        "p_hold_id": body.hold_id,
        "p_currency": body.currency,
        "p_fx_rate": str(rate),
        "p_charged_minor": minor,
        "p_gateway_txn": payment["transaction_id"],
        "p_tickets": tickets_db,
    })

    return {
        "order_id": order_id,
        "status": "paid",
        "event_id": hold["event_id"],
        "breakdown_kzt": {
            "subtotal": hold["subtotal_kzt"],
            "discount": hold["discount_kzt"],
            "fee": hold["fee_kzt"],
            "total": hold["total_kzt"],
        },
        "charged": {
            "currency": body.currency,
            "amount": format_minor(minor, dec),
            "rate_kzt_per_unit": str(rate),
            "sandbox_rate": True,
        },
        "payment": payment,
        "tickets": tickets_out,
    }


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