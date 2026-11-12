from orders import router as orders_router
import os
import uuid
import httpx
from typing import Optional
from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from dotenv import load_dotenv
from supabase import create_client, Client, ClientOptions
from promo import router as promo_router
from routers.tickets import router as tickets_router
from routers.support import router as support_router
from routers.organizer import router as organizer_router
from crypto import generate_hmac_signature

from schemas import (
    UserAuthSchema,
    SignupResponseSchema,
    AuthResponseSchema,
    CurrentUser,
    UserProfileSchema,
    UserProfileUpdateSchema,
    EventCreateSchema,
    EventUpdateSchema,
    TicketTypeCreateSchema,
    TicketTypeUpdateSchema,
    RegisterEventSchema,
    TicketIssueSchema,
    CheckoutQuoteRequest,
    CheckoutQuoteResponse,
    ROLE_ORGANIZER,
    ROLE_PLATFORM_ADMIN,
)

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
options = ClientOptions(httpx_client=httpx.Client(verify=False))
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY, options=options)
app = FastAPI(title="BiletFlow Auth API")
from promo import lookup_promo, redeem_promo, release_promo
from orders import FEE_PERCENT
from routers.analytics import router as analytics_router
from routers.event_history import router as event_history_router
app.include_router(promo_router)
app.include_router(analytics_router)
app.include_router(event_history_router)
app.include_router(tickets_router)
app.include_router(support_router)
app.include_router(organizer_router)
app.include_router(orders_router)


bearer_scheme = HTTPBearer()


def db_for_user(token: str) -> Client:
    client = create_client(
        SUPABASE_URL,
        SUPABASE_KEY,
        options=ClientOptions(httpx_client=httpx.Client(verify=False)),
    )
    client.postgrest.auth(token)
    return client


QR_GRACE_SECONDS = 24 * 3600
QR_FALLBACK_SECONDS = 365 * 24 * 3600


def qr_expiry_for_event(event: Optional[dict]) -> int:
    """QR codes stay valid until 24h after the event ends (or starts).

    Deriving the expiry from the event (instead of "now + 72h") keeps the
    payload stable, so the same ticket re-downloaded later yields the same QR,
    and a ticket bought weeks in advance is still scannable at the door.
    """
    import time
    from datetime import datetime as _dt

    raw = (event or {}).get("ends_at") or (event or {}).get("starts_at")
    if raw:
        try:
            return int(_dt.fromisoformat(str(raw).replace("Z", "+00:00")).timestamp()) + QR_GRACE_SECONDS
        except ValueError:
            pass
    return int(time.time()) + QR_FALLBACK_SECONDS


def make_qr_payload(ticket_id: str, event_id: str, user_id: str, event: Optional[dict] = None) -> tuple[str, str]:
    """Build the signed QR payload ``ticket_id:event_id:user_id:expires_at:signature``."""
    expires_at = qr_expiry_for_event(event)
    signature = generate_hmac_signature(ticket_id, event_id, user_id, expires_at)
    qr_payload = f"{ticket_id}:{event_id}:{user_id}:{expires_at}:{signature}"
    return qr_payload, signature


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> CurrentUser:
    token = credentials.credentials
    async with httpx.AsyncClient(verify=False) as client:
        response = await client.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {token}",
            },
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        )

    auth_user = response.json()
    user_id = str(auth_user["id"]) if auth_user.get("id") else None
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        )

    db = db_for_user(token)
    profile = db.table("profiles").select("*").eq("id", user_id).execute()
    if not profile.data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Profile not found.",
        )

    row = profile.data[0]
    return CurrentUser(
        id=str(row["id"]),
        email=row.get("email") or auth_user.get("email"),
        full_name=row.get("full_name"),
        phone_number=row.get("phone_number"),
        payout_info=row.get("payout_info"),
        role=row.get("role"),
        access_token=token,
    )


optional_bearer = HTTPBearer(auto_error=False)


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(optional_bearer),
) -> Optional[CurrentUser]:
    if credentials is None:
        return None
    return await get_current_user(credentials)


def require_organizer(current_user: CurrentUser) -> None:
    if (current_user.role or "").strip().lower() != ROLE_ORGANIZER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organizer role required.",
        )


def load_owned_event(db: Client, event_id: str, current_user: CurrentUser) -> dict:
    try:
        event_res = db.table("events").select("*").eq("id", event_id).execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    if not event_res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")
    event = event_res.data[0]
    if str(event.get("organizer_id", "")) != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not manage this event.",
        )
    return event


def sold_count_for_type(db: Client, ticket_type_id: str) -> int:
    try:
        res = (
            db.table("tickets")
            .select("id, status")
            .eq("ticket_type_id", ticket_type_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    return active_ticket_count(res.data or [])


def sold_counts_for_event(db: Client, event_id: str) -> dict[str, int]:
    try:
        res = (
            db.table("tickets")
            .select("ticket_type_id, status")
            .eq("event_id", event_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    counts: dict[str, int] = {}
    for row in res.data or []:
        if (row.get("status") or "").lower() in INACTIVE_TICKET_STATUSES:
            continue
        key = str(row.get("ticket_type_id"))
        counts[key] = counts.get(key, 0) + 1
    return counts


def with_sold_available(row: dict, sold: int) -> dict:
    quantity = row.get("quantity")
    available = None if quantity is None else max(int(quantity) - sold, 0)
    return {**row, "sold": sold, "available": available}


def validate_ticket_type_payload(data: dict, existing: Optional[dict] = None, sold: int = 0) -> None:
    merged = {**(existing or {}), **data}
    price = merged.get("price")
    if price is not None and price < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="price must be >= 0.",
        )
    quantity = merged.get("quantity")
    if quantity is not None and quantity < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="quantity must be >= 0.",
        )
    if quantity is not None and quantity < sold:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="quantity cannot go below the number already sold.",
        )
    max_per_order = merged.get("max_per_order")
    if max_per_order is not None and max_per_order < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="max_per_order must be at least 1.",
        )
    if "name" in data and not (data.get("name") or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="name is required.",
        )
    starts = merged.get("sale_starts_at")
    ends = merged.get("sale_ends_at")
    if starts and ends and _parse_ts(ends) <= _parse_ts(starts):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="sale_ends_at must be later than sale_starts_at.",
        )


VISIBILITIES = ("public", "unlisted", "private")
INACTIVE_TICKET_STATUSES = ("cancelled", "refunded")


def validate_event_payload(data: dict, existing: Optional[dict] = None) -> None:
    merged = {**(existing or {}), **data}
    visibility = merged.get("visibility")
    if visibility is not None and visibility not in VISIBILITIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="visibility must be one of: public, unlisted, private.",
        )
    capacity = merged.get("capacity")
    if capacity is not None and capacity < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="capacity must be at least 1 (leave empty for unlimited).",
        )
    starts, ends = merged.get("starts_at"), merged.get("ends_at")
    if starts and ends and _parse_ts(ends) <= _parse_ts(starts):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ends_at must be later than starts_at.",
        )
    opens, closes = merged.get("registration_opens_at"), merged.get("registration_closes_at")
    if opens and closes and _parse_ts(closes) <= _parse_ts(opens):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="registration_closes_at must be later than registration_opens_at.",
        )


def active_ticket_count(rows: list[dict]) -> int:
    return sum(1 for r in rows if (r.get("status") or "").lower() not in INACTIVE_TICKET_STATUSES)


@app.get("/")
def read_root():
    return {"message": "Welcome to BiletFlow API"}


@app.get("/api/events")
def get_events():
    try:
        response = (
            supabase.table("events")
            .select("*")
            .eq("status", "published")
            .eq("visibility", "public")
            .execute()
        )
        return response.data
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@app.post("/api/organizer/events", status_code=status.HTTP_201_CREATED)
async def create_organizer_event(
    payload: EventCreateSchema,
    current_user: CurrentUser = Depends(get_current_user),
):
    require_organizer(current_user)
    db = db_for_user(current_user.access_token)
    row = payload.model_dump(exclude_unset=True, mode="json")
    validate_event_payload(row)
    row["organizer_id"] = current_user.id
    row["status"] = "draft"
    try:
        response = db.table("events").insert(row).execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create event.",
        )
    return response.data[0]


@app.get("/api/organizer/events")
async def list_organizer_events(
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: CurrentUser = Depends(get_current_user),
):
    require_organizer(current_user)
    db = db_for_user(current_user.access_token)
    try:
        query = (
            db.table("events")
            .select("*")
            .eq("organizer_id", current_user.id)
        )
        if status_filter:
            query = query.eq("status", status_filter)
        response = query.execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    return response.data


@app.patch("/api/organizer/events/{event_id}")
async def update_organizer_event(
    event_id: str,
    payload: EventUpdateSchema,
    current_user: CurrentUser = Depends(get_current_user),
):
    require_organizer(current_user)
    db = db_for_user(current_user.access_token)
    event = load_owned_event(db, event_id, current_user)
    if event.get("status") == "cancelled":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cancelled events cannot be edited.",
        )
    update_data = payload.model_dump(exclude_unset=True, mode="json")
    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields provided for update.",
        )
    validate_event_payload(update_data, existing=event)
    try:
        response = (
            db.table("events")
            .update(update_data)
            .eq("id", event_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    if not response.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")
    return response.data[0]


@app.post("/api/organizer/events/{event_id}/publish")
async def publish_organizer_event(
    event_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    require_organizer(current_user)
    db = db_for_user(current_user.access_token)
    event = load_owned_event(db, event_id, current_user)
    if event.get("status") == "cancelled":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cancelled events cannot be re-published.",
        )
    missing = []
    if not (event.get("title") or "").strip():
        missing.append("title")
    if not event.get("starts_at"):
        missing.append("date")
    venue = (event.get("venue_name") or event.get("venue_address") or "").strip()
    if not venue:
        missing.append("venue")
    try:
        types_res = (
            db.table("ticket_types")
            .select("id, is_hidden")
            .eq("event_id", event_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    if not any(not t.get("is_hidden") for t in types_res.data or []):
        missing.append("at least 1 visible ticket type")
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot publish unless the event has: " + ", ".join(missing) + ".",
        )
    # TODO audit
    try:
        response = (
            db.table("events")
            .update({"status": "published"})
            .eq("id", event_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    if not response.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")
    return response.data[0]


@app.post("/api/organizer/events/{event_id}/unpublish")
async def unpublish_organizer_event(
    event_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    require_organizer(current_user)
    db = db_for_user(current_user.access_token)
    event = load_owned_event(db, event_id, current_user)
    if event.get("status") == "cancelled":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cancelled events cannot be unpublished.",
        )
    try:
        response = (
            db.table("events")
            .update({"status": "draft"})
            .eq("id", event_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    if not response.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")
    return response.data[0]


@app.post("/api/organizer/events/{event_id}/cancel")
async def cancel_organizer_event(
    event_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    require_organizer(current_user)
    db = db_for_user(current_user.access_token)
    load_owned_event(db, event_id, current_user)
    # TODO audit
    try:
        response = (
            db.table("events")
            .update({"status": "cancelled"})
            .eq("id", event_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    if not response.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")
    return response.data[0]


@app.post("/api/organizer/events/{event_id}/ticket-types", status_code=status.HTTP_201_CREATED)
async def create_organizer_ticket_type(
    event_id: str,
    payload: TicketTypeCreateSchema,
    current_user: CurrentUser = Depends(get_current_user),
):
    require_organizer(current_user)
    db = db_for_user(current_user.access_token)
    load_owned_event(db, event_id, current_user)
    row = payload.model_dump(exclude_unset=True, mode="json")
    validate_ticket_type_payload(row)
    row["event_id"] = event_id
    if "is_hidden" not in row:
        row["is_hidden"] = False
    try:
        response = db.table("ticket_types").insert(row).execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create ticket type.",
        )
    return with_sold_available(response.data[0], 0)


@app.get("/api/organizer/events/{event_id}/ticket-types")
async def list_organizer_ticket_types(
    event_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    require_organizer(current_user)
    db = db_for_user(current_user.access_token)
    load_owned_event(db, event_id, current_user)
    try:
        response = (
            db.table("ticket_types")
            .select("*")
            .eq("event_id", event_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    sold_map = sold_counts_for_event(db, event_id)
    return [
        with_sold_available(row, sold_map.get(str(row["id"]), 0))
        for row in (response.data or [])
    ]


@app.patch("/api/organizer/ticket-types/{ticket_type_id}")
async def update_organizer_ticket_type(
    ticket_type_id: str,
    payload: TicketTypeUpdateSchema,
    current_user: CurrentUser = Depends(get_current_user),
):
    require_organizer(current_user)
    db = db_for_user(current_user.access_token)
    try:
        type_res = (
            db.table("ticket_types")
            .select("*")
            .eq("id", ticket_type_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    if not type_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticket type not found.",
        )
    ticket_type = type_res.data[0]
    load_owned_event(db, str(ticket_type["event_id"]), current_user)
    update_data = payload.model_dump(exclude_unset=True, mode="json")
    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields provided for update.",
        )
    sold = sold_count_for_type(db, ticket_type_id)
    validate_ticket_type_payload(update_data, existing=ticket_type, sold=sold)
    try:
        response = (
            db.table("ticket_types")
            .update(update_data)
            .eq("id", ticket_type_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticket type not found.",
        )
    return with_sold_available(response.data[0], sold)


@app.post(
    "/api/auth/signup",
    response_model=SignupResponseSchema,
    status_code=status.HTTP_201_CREATED
)
async def signup(credentials: UserAuthSchema):
    """Registers a new user using Supabase Auth."""
    url = f"{SUPABASE_URL}/auth/v1/signup"
    headers = {
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json"
    }
    payload = {
        "email": credentials.email,
        "password": credentials.password
    }

    async with httpx.AsyncClient(verify=False) as client:
        response = await client.post(url, json=payload, headers=headers)

    data = response.json()

    if response.status_code != 200 or "error" in data:
        error_msg = data.get("msg") or data.get("error_description") or "Registration failed."
        raise HTTPException(
            status_code=response.status_code if response.status_code != 200 else status.HTTP_400_BAD_REQUEST,
            detail=error_msg
        )

    user_data = data.get("user") or {}
    user_id = data.get("id") or user_data.get("id")
    if user_id is not None:
        user_id = str(user_id)

    return SignupResponseSchema(
        message="User registered successfully. Check email if verification is required.",
        user_id=user_id
    )


@app.post("/api/auth/login", response_model=AuthResponseSchema)
async def login(credentials: UserAuthSchema):
    """Authenticates a user and returns JWT tokens."""
    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    headers = {
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json"
    }
    payload = {
        "email": credentials.email,
        "password": credentials.password
    }

    async with httpx.AsyncClient(verify=False) as client:
        response = await client.post(url, json=payload, headers=headers)

    data = response.json()

    if response.status_code != 200 or "access_token" not in data:
        error_msg = data.get("error_description") or "Invalid email or password."
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=error_msg
        )

    return AuthResponseSchema(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        user_id=str(data["user"]["id"]),
        email=data["user"]["email"]
    )


@app.get("/api/users/me", response_model=UserProfileSchema)
async def get_me(current_user: CurrentUser = Depends(get_current_user)):
    return UserProfileSchema(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        phone_number=current_user.phone_number,
        payout_info=current_user.payout_info,
        role=current_user.role,
    )


@app.put("/api/users/me", response_model=UserProfileSchema)
async def update_me(
    payload: UserProfileUpdateSchema,
    current_user: CurrentUser = Depends(get_current_user),
):
    db = db_for_user(current_user.access_token)

    # Exclude fields that were not sent in the request body
    update_data = payload.model_dump(exclude_unset=True)

    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields provided for update.",
        )

    try:
        response = (
            db.table("profiles")
            .update(update_data)
            .eq("id", current_user.id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found.",
        )

    row = response.data[0]
    return UserProfileSchema(
        id=str(row["id"]),
        email=row.get("email") or current_user.email,
        full_name=row.get("full_name"),
        phone_number=row.get("phone_number"),
        payout_info=row.get("payout_info"),
        role=row.get("role"),
    )


# ---------------------------------------------------------------------------
# Checkout: pricing, registration / simulated purchase, attendee tickets
# ---------------------------------------------------------------------------
def compute_pricing(ticket_type: dict, promo: Optional[dict]) -> CheckoutQuoteResponse:
    """Server-side price calculation (the client never sends amounts)."""
    subtotal = int(ticket_type.get("price") or 0)
    percent = int(promo["discount_percent"]) if promo and subtotal > 0 else 0
    discount = subtotal * percent // 100
    net = subtotal - discount
    fee = (net * FEE_PERCENT + 50) // 100 if net > 0 else 0
    return CheckoutQuoteResponse(
        ticket_type_id=str(ticket_type["id"]),
        subtotal_kzt=subtotal,
        discount_kzt=discount,
        fee_kzt=fee,
        total_kzt=net + fee,
        promo_code=promo["code"] if promo and percent else None,
        discount_percent=percent,
    )


def _parse_ts(raw) -> "datetime":
    from datetime import datetime as _dt
    return _dt.fromisoformat(str(raw).replace("Z", "+00:00"))


def load_purchasable_ticket_type(db: Client, event_id: str, ticket_type_id: str) -> tuple[dict, dict]:
    """Return (event, ticket_type) or raise if the ticket cannot be sold right now."""
    from datetime import datetime as _dt, timezone as _tz

    try:
        event_res = db.table("events").select("*").eq("id", event_id).execute()
        type_res = db.table("ticket_types").select("*").eq("id", ticket_type_id).execute()
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    if not event_res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")
    if not type_res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket type not found.")
    event, ticket_type = event_res.data[0], type_res.data[0]

    if str(ticket_type["event_id"]) != event_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ticket type does not belong to this event.")
    if event.get("status") != "published":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This event is not open for registration.")
    if ticket_type.get("is_hidden"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket type not found.")

    now = _dt.now(_tz.utc)
    if event.get("registration_opens_at") and now < _parse_ts(event["registration_opens_at"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Registration for this event has not opened yet.")
    if event.get("registration_closes_at") and now > _parse_ts(event["registration_closes_at"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Registration for this event is closed.")
    if ticket_type.get("sale_starts_at") and now < _parse_ts(ticket_type["sale_starts_at"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ticket sales have not started yet.")
    if ticket_type.get("sale_ends_at") and now > _parse_ts(ticket_type["sale_ends_at"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ticket sales have ended.")

    # Paid-sales guard: paid tickets require an activated event.
    if (ticket_type.get("price") or 0) > 0:
        if event.get("paid_sales_status", "NONE") != "ACTIVE" or not event.get("paid_sales_active"):
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Paid ticket sales are not yet activated for this event. The organizer must activate paid sales first.",
            )

    # Inventory: ticket_types.quantity and events.capacity are totals; sold = active tickets.
    quantity = ticket_type.get("quantity")
    capacity = event.get("capacity")
    if quantity is not None or capacity is not None:
        try:
            rows = db.table("tickets").select("ticket_type_id, status").eq("event_id", event_id).execute().data or []
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
        active = [r for r in rows if (r.get("status") or "").lower() not in INACTIVE_TICKET_STATUSES]
        if capacity is not None and len(active) >= int(capacity):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This event is at full capacity.")
        if quantity is not None and sum(1 for r in active if str(r.get("ticket_type_id")) == str(ticket_type["id"])) >= int(quantity):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This ticket type is sold out.")
    return event, ticket_type


@app.post("/api/events/{event_id}/checkout/quote", response_model=CheckoutQuoteResponse)
async def checkout_quote(
    event_id: str,
    payload: CheckoutQuoteRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Preview subtotal / discount / fee / total. Does not reserve stock or consume the promo code."""
    db = db_for_user(current_user.access_token)
    _, ticket_type = load_purchasable_ticket_type(db, event_id, payload.ticket_type_id)
    promo = lookup_promo(payload.promo_code) if payload.promo_code and payload.promo_code.strip() else None
    return compute_pricing(ticket_type, promo)


@app.post(
    "/api/events/{event_id}/register",
    response_model=TicketIssueSchema,
    status_code=status.HTTP_201_CREATED,
)
async def register_for_event(
    event_id: str,
    payload: RegisterEventSchema,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Register (free) or buy (simulated payment) one ticket and issue it with a signed QR."""
    db = db_for_user(current_user.access_token)
    ticket_type_id = payload.ticket_type_id
    event, ticket_type = load_purchasable_ticket_type(db, event_id, ticket_type_id)

    try:
        existing = (
            db.table("tickets")
            .select("id, status")
            .eq("user_id", current_user.id)
            .eq("event_id", event_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    if any((t.get("status") or "").lower() not in ("cancelled", "refunded") for t in existing.data or []):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already registered for this event.")

    promo = None
    if payload.promo_code and payload.promo_code.strip() and (ticket_type.get("price") or 0) > 0:
        promo = redeem_promo(payload.promo_code)
    pricing = compute_pricing(ticket_type, promo)

    ticket_id = str(uuid.uuid4())
    qr_payload, signature = make_qr_payload(ticket_id, event_id, current_user.id, event)

    order_res = None
    try:
        order_res = (
            db.table("orders")
            .insert({
                "user_id": current_user.id,
                "total_amount": pricing.total_kzt,
                "subtotal_amount": pricing.subtotal_kzt,
                "discount_amount": pricing.discount_kzt,
                "fee_amount": pricing.fee_kzt,
                "promo_code": pricing.promo_code,
                "status": "completed",
            })
            .execute()
        )
    except Exception as e:
        if promo:
            release_promo(promo["id"])
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    if not order_res.data:
        if promo:
            release_promo(promo["id"])
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create order.")
    order_id = str(order_res.data[0]["id"])

    try:
        ticket_res = (
            db.table("tickets")
            .insert({
                "id": ticket_id,
                "order_id": order_id,
                "ticket_type_id": ticket_type_id,
                "user_id": current_user.id,
                "event_id": event_id,
                "status": "valid",
                "qr_code_hash": signature,
            })
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    if not ticket_res.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to issue ticket.")

    row = ticket_res.data[0]
    return TicketIssueSchema(
        id=str(row["id"]),
        order_id=str(row["order_id"]),
        ticket_type_id=str(row["ticket_type_id"]),
        user_id=str(row["user_id"]),
        event_id=str(row["event_id"]),
        status=row["status"],
        qr_code_hash=row["qr_code_hash"],
        checked_in_at=row.get("checked_in_at"),
        checked_in_by=str(row["checked_in_by"]) if row.get("checked_in_by") else None,
        qr_payload=qr_payload,
        pricing=pricing,
    )


def attendee_ticket_status(ticket: dict, event: dict, refund_case: Optional[dict]) -> str:
    """Map DB ticket status + event state + open refund request to the dashboard status."""
    raw = (ticket.get("status") or "").lower()
    if raw == "refunded":
        return "REFUNDED"
    if raw == "cancelled" or event.get("status") == "cancelled":
        return "CANCELLED"
    if raw in ("checked_in", "used"):
        return "USED"
    if refund_case and refund_case.get("status") != "RESOLVED":
        return "CANCEL_PENDING"
    return "ACTIVE"


@app.get("/api/me/tickets")
async def my_tickets(current_user: CurrentUser = Depends(get_current_user)):
    """All tickets of the signed-in attendee with event, pricing and a signed QR payload."""
    db = db_for_user(current_user.access_token)
    try:
        tickets = db.table("tickets").select("*").eq("user_id", current_user.id).execute().data or []
        if not tickets:
            return []
        event_ids = list({str(t["event_id"]) for t in tickets})
        type_ids = list({str(t["ticket_type_id"]) for t in tickets if t.get("ticket_type_id")})
        order_ids = list({str(t["order_id"]) for t in tickets if t.get("order_id")})
        ticket_ids = [str(t["id"]) for t in tickets]
        events = {str(e["id"]): e for e in db.table("events").select("*").in_("id", event_ids).execute().data or []}
        types = (
            {str(t["id"]): t for t in db.table("ticket_types").select("*").in_("id", type_ids).execute().data or []}
            if type_ids else {}
        )
        orders = (
            {str(o["id"]): o for o in db.table("orders").select("*").in_("id", order_ids).execute().data or []}
            if order_ids else {}
        )
        cases = (
            db.table("support_cases")
            .select("id, ticket_id, status, created_at")
            .eq("requester_id", current_user.id)
            .eq("category", "refund")
            .in_("ticket_id", ticket_ids)
            .execute()
            .data
            or []
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    latest_case: dict[str, dict] = {}
    for c in sorted(cases, key=lambda c: str(c.get("created_at") or "")):
        latest_case[str(c["ticket_id"])] = c

    result = []
    for t in tickets:
        tid = str(t["id"])
        event = events.get(str(t["event_id"]), {})
        ttype = types.get(str(t.get("ticket_type_id")), {})
        order = orders.get(str(t.get("order_id")), {})
        case = latest_case.get(tid)
        state = attendee_ticket_status(t, event, case)
        price = int(ttype.get("price") or 0)
        subtotal = order.get("subtotal_amount")
        total = order.get("total_amount")
        usable = state in ("ACTIVE", "CANCEL_PENDING")
        result.append({
            "id": tid,
            "order_id": str(t.get("order_id") or ""),
            "event_id": str(t["event_id"]),
            "event_title": event.get("title") or "—",
            "starts_at": event.get("starts_at"),
            "ends_at": event.get("ends_at"),
            "timezone": event.get("timezone") or "Asia/Almaty",
            "venue_name": event.get("venue_name") or "",
            "venue_address": event.get("venue_address") or "",
            "ticket_type": ttype.get("name") or "—",
            "subtotal_kzt": int(subtotal if subtotal is not None else price),
            "discount_kzt": int(order.get("discount_amount") or 0),
            "fee_kzt": int(order.get("fee_amount") or 0),
            "total_kzt": int(total if total is not None else price),
            "promo_code": order.get("promo_code"),
            "purchased_at": order.get("created_at"),
            "status": state,
            "refund_case_id": str(case["id"]) if case else None,
            "checked_in_at": t.get("checked_in_at"),
            # A QR is only handed out for tickets that can still be used for admission.
            "qr_payload": make_qr_payload(tid, str(t["event_id"]), current_user.id, event)[0] if usable else None,
        })
    result.sort(key=lambda r: str(r.get("starts_at") or ""), reverse=True)
    return result


# ---------------------------------------------------------------------------
# PB-8: CORS for the React frontend (local dev + GitHub Codespaces)
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_origin_regex=r"https://.*\.app\.github\.dev",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# PB-8: public event details
# ---------------------------------------------------------------------------
@app.get("/api/events/{event_id}")
async def get_event(
    event_id: str,
    current_user: Optional[CurrentUser] = Depends(get_optional_user),
):
    event_res = supabase.table("events").select("*").eq("id", event_id).execute()
    if not event_res.data:
        raise HTTPException(status_code=404, detail="Event not found.")
    event = event_res.data[0]
    is_owner = (
        current_user is not None
        and str(event.get("organizer_id", "")) == current_user.id
    )
    is_platform_admin = (
        current_user is not None
        and (current_user.role or "").strip().lower() == ROLE_PLATFORM_ADMIN
    )
    is_public = event.get("status") == "published" and event.get("visibility") != "private"
    if not (is_public or is_owner or is_platform_admin):
        raise HTTPException(status_code=404, detail="Event not found.")
    tiers = supabase.table("ticket_types").select("*").eq("event_id", event_id).execute()
    sold_rows = supabase.table("tickets").select("ticket_type_id, status").eq("event_id", event_id).execute()
    sold: dict[str, int] = {}
    for r in sold_rows.data or []:
        if (r.get("status") or "").lower() not in INACTIVE_TICKET_STATUSES:
            sold[str(r.get("ticket_type_id"))] = sold.get(str(r.get("ticket_type_id")), 0) + 1
    event["ticket_types"] = [
        with_sold_available(t, sold.get(str(t["id"]), 0))
        for t in (tiers.data or [])
        if not t.get("is_hidden")
    ]
    return event


@app.get("/api/events/{event_id}/ticket-types")
def get_public_ticket_types(event_id: str):
    event_res = supabase.table("events").select("id,status").eq("id", event_id).execute()
    if not event_res.data or event_res.data[0].get("status") != "published":
        raise HTTPException(status_code=404, detail="Event not found.")
    try:
        response = (
            supabase.table("ticket_types")
            .select("*")
            .eq("event_id", event_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    return [row for row in (response.data or []) if not row.get("is_hidden")]
