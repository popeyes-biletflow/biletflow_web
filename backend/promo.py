import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, model_validator

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "promo.db")
HOLD_MINUTES = 15
router = APIRouter()

def get_conn():
    conn = sqlite3.connect(DB_PATH, isolation_level=None, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn

@contextmanager
def transaction():
    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        try:
            yield conn
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    finally:
        conn.close()

def init_db():
    conn = get_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS campaigns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            discount_percent INTEGER NOT NULL,
            starts_at TEXT NOT NULL,
            ends_at TEXT NOT NULL,
            qr_slug TEXT NOT NULL UNIQUE,
            qr_scans INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS promo_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
            code TEXT NOT NULL UNIQUE,
            max_uses INTEGER NOT NULL,
            used_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS ticket_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price_kzt INTEGER NOT NULL,
            stock INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS holds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_type_id INTEGER NOT NULL REFERENCES ticket_types(id),
            quantity INTEGER NOT NULL,
            promo_code_id INTEGER NOT NULL REFERENCES promo_codes(id),
            subtotal_kzt INTEGER NOT NULL,
            discount_kzt INTEGER NOT NULL,
            total_kzt INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        """
    )
    if conn.execute("SELECT COUNT(*) FROM ticket_types").fetchone()[0] == 0:
        conn.executemany(
            "INSERT INTO ticket_types (name, price_kzt, stock) VALUES (?, ?, ?)",
            [("Standard", 5000, 100), ("VIP", 15000, 20)],
        )
    conn.close()

init_db()

def now_utc():
    return datetime.now(timezone.utc)

def to_utc(dt):
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)

class CampaignIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    discount_percent: int = Field(ge=1, le=100)
    code: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")
    max_uses: int = Field(ge=1)
    starts_at: datetime | None = None
    ends_at: datetime

    @model_validator(mode="after")
    def check_dates(self):
        start = to_utc(self.starts_at) if self.starts_at else now_utc()
        if to_utc(self.ends_at) <= start:
            raise ValueError("ends_at must be later than starts_at")
        return self

class ApplyPromoIn(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    ticket_type_id: int
    quantity: int = Field(ge=1, le=10)

@router.get("/api/tickets")
def list_tickets():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM ticket_types").fetchall()
    conn.close()
    return [dict(r) for r in rows]

@router.post("/api/campaigns", status_code=201)
def create_campaign(body: CampaignIn, request: Request):
    starts = to_utc(body.starts_at) if body.starts_at else now_utc()
    ends = to_utc(body.ends_at)
    code = body.code.upper()
    slug = secrets.token_urlsafe(6)
    try:
        with transaction() as db:
            cur = db.execute(
                "INSERT INTO campaigns (name, discount_percent, starts_at, ends_at, qr_slug) VALUES (?, ?, ?, ?, ?)",
                (body.name, body.discount_percent, starts.isoformat(), ends.isoformat(), slug),
            )
            campaign_id = cur.lastrowid
            db.execute(
                "INSERT INTO promo_codes (campaign_id, code, max_uses) VALUES (?, ?, ?)",
                (campaign_id, code, body.max_uses),
            )
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Promo code already exists")
    return {
        "campaign_id": campaign_id,
        "code": code,
        "qr_link": f"{str(request.base_url).rstrip('/')}/c/{slug}",
    }

@router.post("/api/checkout/apply-promo")
def apply_promo(body: ApplyPromoIn):
    code = body.code.strip().upper()
    now = now_utc()
    with transaction() as db:
        expired = db.execute(
            "SELECT * FROM holds WHERE status = 'active' AND expires_at < ?",
            (now.isoformat(),),
        ).fetchall()
        for h in expired:
            db.execute("UPDATE ticket_types SET stock = stock + ? WHERE id = ?", (h["quantity"], h["ticket_type_id"]))
            db.execute("UPDATE promo_codes SET used_count = used_count - 1 WHERE id = ?", (h["promo_code_id"],))
            db.execute("UPDATE holds SET status = 'expired' WHERE id = ?", (h["id"],))
        promo = db.execute(
            """SELECT p.id, p.max_uses, p.used_count, c.discount_percent, c.starts_at, c.ends_at
               FROM promo_codes p JOIN campaigns c ON c.id = p.campaign_id
               WHERE p.code = ?""",
            (code,),
        ).fetchone()
        if promo is None:
            raise HTTPException(404, "Promo code not found")
        if not (datetime.fromisoformat(promo["starts_at"]) <= now <= datetime.fromisoformat(promo["ends_at"])):
            raise HTTPException(400, "Campaign is not active")
        if promo["used_count"] >= promo["max_uses"]:
            raise HTTPException(400, "Promo code usage limit reached")
        ticket = db.execute("SELECT * FROM ticket_types WHERE id = ?", (body.ticket_type_id,)).fetchone()
        if ticket is None:
            raise HTTPException(404, "Ticket type not found")
        if ticket["stock"] < body.quantity:
            raise HTTPException(409, f"Not enough tickets, left: {ticket['stock']}")
        subtotal = ticket["price_kzt"] * body.quantity
        discount = subtotal * promo["discount_percent"] // 100
        total = subtotal - discount
        db.execute("UPDATE ticket_types SET stock = stock - ? WHERE id = ?", (body.quantity, ticket["id"]))
        db.execute("UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?", (promo["id"],))
        expires = now + timedelta(minutes=HOLD_MINUTES)
        cur = db.execute(
            """INSERT INTO holds (ticket_type_id, quantity, promo_code_id, subtotal_kzt,
               discount_kzt, total_kzt, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (ticket["id"], body.quantity, promo["id"], subtotal, discount, total, expires.isoformat(), now.isoformat()),
        )
        hold_id = cur.lastrowid
    return {
        "hold_id": hold_id,
        "subtotal_kzt": subtotal,
        "discount_kzt": discount,
        "total_kzt": total,
        "hold_expires_at": expires.isoformat(),
    }

@router.get("/c/{slug}")
def campaign_link(slug: str):
    with transaction() as db:
        row = db.execute(
            "SELECT c.id, p.code FROM campaigns c JOIN promo_codes p ON p.campaign_id = c.id WHERE c.qr_slug = ?",
            (slug,),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Link not found")
        db.execute("UPDATE campaigns SET qr_scans = qr_scans + 1 WHERE id = ?", (row["id"],))
    return RedirectResponse(f"/checkout?promo={row['code']}")