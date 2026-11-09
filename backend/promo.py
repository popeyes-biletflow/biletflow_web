import os
import secrets
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, model_validator

from deps import db_for_user, get_current_user, supabase
from schemas import CurrentUser, ROLE_ORGANIZER

PUBLIC_API_URL = os.getenv("PUBLIC_API_URL", "http://localhost:8000").rstrip("/")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")

router = APIRouter()

RPC_ERRORS = {
    "AUTH_REQUIRED": 401,
    "NOT_EVENT_OWNER": 403,
    "EVENT_NOT_FOUND": 404,
    "TICKET_TYPE_NOT_FOUND": 404,
    "PROMO_NOT_FOUND": 404,
    "HOLD_NOT_FOUND": 404,
    "PROMO_CODE_EXISTS": 409,
    "SOLD_OUT": 409,
    "HOLD_NOT_ACTIVE": 409,
    "HOLD_EXPIRED": 410,
    "PAID_SALES_INACTIVE": 402,
    "EVENT_NOT_ON_SALE": 400,
    "SALE_WINDOW_CLOSED": 400,
    "MAX_PER_ORDER": 400,
    "BAD_QUANTITY": 400,
    "BAD_TICKETS": 400,
    "PROMO_INACTIVE": 400,
    "PROMO_EXHAUSTED": 400,
}


def call_rpc(db, fn: str, params: dict):
    """Вызывает Postgres-функцию и переводит её ошибки в HTTP."""
    try:
        return db.rpc(fn, params).execute().data
    except HTTPException:
        raise
    except Exception as e:
        msg = str(getattr(e, "message", None) or e)
        for code, http_status in RPC_ERRORS.items():
            if code in msg:
                raise HTTPException(http_status, code)
        raise HTTPException(500, msg)


def require_organizer(user: CurrentUser) -> None:
    if (user.role or "").strip().lower() != ROLE_ORGANIZER:
        raise HTTPException(403, "Organizer role required.")


def to_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


class CampaignIn(BaseModel):
    event_id: str
    name: str = Field(min_length=1, max_length=100)
    discount_percent: int = Field(ge=1, le=100)
    code: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")
    max_uses: int = Field(ge=1)
    starts_at: datetime | None = None
    ends_at: datetime

    @model_validator(mode="after")
    def check_dates(self):
        start = to_utc(self.starts_at) if self.starts_at else datetime.now(timezone.utc)
        if to_utc(self.ends_at) <= start:
            raise ValueError("ends_at must be later than starts_at")
        return self


class ApplyPromoIn(BaseModel):
    ticket_type_id: str
    quantity: int = Field(ge=1, le=10)
    code: str | None = Field(default=None, max_length=32) 
    
@router.post("/api/campaigns", status_code=201)
async def create_campaign(body: CampaignIn, user: CurrentUser = Depends(get_current_user)):
    require_organizer(user)
    db = db_for_user(user.access_token)
    slug = secrets.token_urlsafe(6)
    data = call_rpc(db, "create_campaign", {
        "p_event_id": body.event_id,
        "p_name": body.name,
        "p_discount_percent": body.discount_percent,
        "p_code": body.code,
        "p_max_uses": body.max_uses,
        "p_ends_at": to_utc(body.ends_at).isoformat(),
        "p_slug": slug,
        "p_starts_at": to_utc(body.starts_at).isoformat() if body.starts_at else None,
    })
    return {**data, "qr_link": f"{PUBLIC_API_URL}/c/{slug}"}


@router.post("/api/checkout/apply-promo")
async def apply_promo(body: ApplyPromoIn, user: CurrentUser = Depends(get_current_user)):
    db = db_for_user(user.access_token)
    return call_rpc(db, "create_ticket_hold", {
        "p_ticket_type_id": body.ticket_type_id,
        "p_quantity": body.quantity,
        "p_promo_code": body.code,
    })


@router.get("/c/{slug}")
def campaign_link(slug: str):
    data = call_rpc(supabase, "register_campaign_scan", {"p_slug": slug})
    if not data:
        raise HTTPException(404, "Link not found or campaign inactive")
    return RedirectResponse(
        f"{FRONTEND_URL}/events/{data['event_id']}?promo={data['code']}", status_code=302
    )