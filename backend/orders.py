import secrets
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator
from promo import get_conn, transaction, now_utc

router = APIRouter()

FEE_PERCENT = 5
RATES = {"KZT": Decimal("1"), "USD": Decimal("500"), "EUR": Decimal("550"), "RUB": Decimal("5.5")}
DECIMALS = {"KZT": 0, "USD": 2, "EUR": 2, "RUB": 2}

def init_orders_db():
    conn = get_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_type_id INTEGER NOT NULL REFERENCES ticket_types(id),
            quantity INTEGER NOT NULL,
            promo_code_id INTEGER REFERENCES promo_codes(id),
            hold_id INTEGER REFERENCES holds(id),
            subtotal_kzt INTEGER NOT NULL,
            discount_kzt INTEGER NOT NULL,
            fee_kzt INTEGER NOT NULL,
            total_kzt INTEGER NOT NULL,
            currency TEXT NOT NULL,
            fx_rate TEXT NOT NULL,
            charged_minor INTEGER NOT NULL,
            status TEXT NOT NULL,
            gateway_txn_id TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        """
    )
    conn.close()

init_orders_db()

class OrderIn(BaseModel):
    hold_id: int | None = None
    ticket_type_id: int | None = None
    quantity: int | None = Field(default=None, ge=1, le=10)
    promo_code: str | None = Field(default=None, max_length=32)
    currency: Literal["KZT", "USD", "EUR", "RUB"] = "KZT"
    card_number: str = Field(default="4242424242424242", min_length=12, max_length=19)

    @model_validator(mode="after")
    def check_source(self):
        if self.hold_id is None and (self.ticket_type_id is None or self.quantity is None):
            raise ValueError("Send hold_id, or ticket_type_id and quantity")
        return self

def mock_charge(card_number, total_kzt, currency):
    if card_number.endswith("0002"):
        return {"gateway": "MockPay", "status": "declined", "reason": "card_declined"}
    return {"gateway": "MockPay", "status": "approved", "transaction_id": "mock_" + secrets.token_hex(8)}

def convert(total_kzt, currency):
    rate = RATES[currency]
    dec = DECIMALS[currency]
    minor = int((Decimal(total_kzt) / rate * (10 ** dec)).quantize(Decimal(1), ROUND_HALF_UP))
    return rate, dec, minor

def format_minor(minor, dec):
    return f"{Decimal(minor) / (10 ** dec):.{dec}f}"

@router.post("/api/orders", status_code=201)
def create_order(body: OrderIn):
    now = now_utc()
    with transaction() as db:
        if body.hold_id is not None:
            hold = db.execute("SELECT * FROM holds WHERE id = ?", (body.hold_id,)).fetchone()
            if hold is None:
                raise HTTPException(404, "Hold not found")
            if hold["status"] != "active":
                raise HTTPException(409, "Hold is no longer active")
            if datetime.fromisoformat(hold["expires_at"]) < now:
                db.execute("UPDATE ticket_types SET stock = stock + ? WHERE id = ?", (hold["quantity"], hold["ticket_type_id"]))
                db.execute("UPDATE promo_codes SET used_count = used_count - 1 WHERE id = ?", (hold["promo_code_id"],))
                db.execute("UPDATE holds SET status = 'expired' WHERE id = ?", (hold["id"],))
                return JSONResponse(status_code=410, content={"detail": "Hold expired"})
            ticket_id, qty, promo_id = hold["ticket_type_id"], hold["quantity"], hold["promo_code_id"]
            subtotal, discount = hold["subtotal_kzt"], hold["discount_kzt"]
        else:
            ticket = db.execute("SELECT * FROM ticket_types WHERE id = ?", (body.ticket_type_id,)).fetchone()
            if ticket is None:
                raise HTTPException(404, "Ticket type not found")
            ticket_id, qty, promo_id = ticket["id"], body.quantity, None
            subtotal, discount = ticket["price_kzt"] * qty, 0
            if body.promo_code:
                promo = db.execute(
                    """SELECT p.id, c.discount_percent, c.starts_at, c.ends_at
                       FROM promo_codes p JOIN campaigns c ON c.id = p.campaign_id WHERE p.code = ?""",
                    (body.promo_code.strip().upper(),),
                ).fetchone()
                if promo is None:
                    raise HTTPException(404, "Promo code not found")
                if not (datetime.fromisoformat(promo["starts_at"]) <= now <= datetime.fromisoformat(promo["ends_at"])):
                    raise HTTPException(400, "Campaign is not active")
                cur = db.execute(
                    "UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ? AND used_count < max_uses",
                    (promo["id"],),
                )
                if cur.rowcount == 0:
                    raise HTTPException(400, "Promo code usage limit reached")
                promo_id = promo["id"]
                discount = subtotal * promo["discount_percent"] // 100
            cur = db.execute(
                "UPDATE ticket_types SET stock = stock - ? WHERE id = ? AND stock >= ?",
                (qty, ticket_id, qty),
            )
            if cur.rowcount == 0:
                raise HTTPException(409, "Not enough tickets")
        net = subtotal - discount
        fee = (net * FEE_PERCENT + 50) // 100
        total = net + fee
        rate, dec, minor = convert(total, body.currency)
        payment = mock_charge(body.card_number, total, body.currency)
        if payment["status"] != "approved":
            raise HTTPException(402, payment)
        if body.hold_id is not None:
            db.execute("UPDATE holds SET status = 'converted' WHERE id = ?", (body.hold_id,))
        cur = db.execute(
            """INSERT INTO orders (ticket_type_id, quantity, promo_code_id, hold_id, subtotal_kzt, discount_kzt,
               fee_kzt, total_kzt, currency, fx_rate, charged_minor, status, gateway_txn_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?)""",
            (ticket_id, qty, promo_id, body.hold_id, subtotal, discount, fee, total,
             body.currency, str(rate), minor, payment["transaction_id"], now.isoformat()),
        )
        order_id = cur.lastrowid
    return {
        "order_id": order_id,
        "status": "paid",
        "breakdown_kzt": {"subtotal": subtotal, "discount": discount, "fee": fee, "total": total},
        "charged": {
            "currency": body.currency,
            "amount": format_minor(minor, dec),
            "rate_kzt_per_unit": str(rate),
        },
        "payment": payment,
    }

@router.get("/api/organizer/campaigns/stats")
def campaigns_stats():
    conn = get_conn()
    rows = conn.execute(
        """SELECT c.id, c.name, p.code, c.qr_scans, p.used_count,
                  COUNT(o.id) AS orders,
                  COALESCE(SUM(o.quantity), 0) AS tickets_sold,
                  COALESCE(SUM(o.subtotal_kzt), 0) AS gross_sales_kzt,
                  COALESCE(SUM(o.discount_kzt), 0) AS discount_total_kzt,
                  COALESCE(SUM(o.subtotal_kzt - o.discount_kzt), 0) AS net_revenue_kzt
           FROM campaigns c
           JOIN promo_codes p ON p.campaign_id = c.id
           LEFT JOIN orders o ON o.promo_code_id = p.id AND o.status = 'paid'
           GROUP BY c.id, p.id ORDER BY c.id"""
    ).fetchall()
    totals = conn.execute(
        """SELECT COUNT(*) AS orders, COALESCE(SUM(quantity), 0) AS tickets_sold,
                  COALESCE(SUM(subtotal_kzt), 0) AS gross_event_revenue_kzt,
                  COALESCE(SUM(discount_kzt), 0) AS discount_total_kzt,
                  COALESCE(SUM(fee_kzt), 0) AS fees_kzt
           FROM orders WHERE status = 'paid'"""
    ).fetchone()
    conn.close()
    campaigns = []
    for r in rows:
        item = dict(r)
        item["conversion_rate"] = round(item["orders"] / item["used_count"], 4) if item["used_count"] else None
        campaigns.append(item)
    return {"campaigns": campaigns, "totals": dict(totals)}