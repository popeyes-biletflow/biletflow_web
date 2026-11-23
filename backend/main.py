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
from deps import VERIFY_SSL, sanitize_error
from promo import router as promo_router
from routers.tickets import router as tickets_router
from routers.support import router as support_router
from routers.organizer import router as organizer_router
from routers.admin import router as admin_router
from crypto import generate_hmac_signature, ticket_qr_payload, qr_expiry_for_event

from schemas import (
    UserAuthSchema,
    SignupSchema,
    RefreshRequestSchema,
    ResendVerificationSchema,
    PasswordResetConfirmSchema,
    SignupResponseSchema,
    AuthResponseSchema,
    PasswordResetRequestSchema,
    PasswordResetResponseSchema,
    LogoutResponseSchema,
    VerifyEmailResponseSchema,
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
    ROLE_ATTENDEE,
    ROLE_ORGANIZER,
    ROLE_PLATFORM_ADMIN,
)

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
options = ClientOptions(httpx_client=httpx.Client(verify=VERIFY_SSL))
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY, options=options)
app = FastAPI(title="BiletFlow Auth API")
from promo import lookup_promo, redeem_promo, release_promo
from orders import FEE_PERCENT
from routers.analytics import router as analytics_router
from routers.event_history import router as event_history_router
from routers.organizer_finance import router as organizer_finance_router
from routers.refunds import router as refunds_router
from routers.mobile import router as mobile_router
from routers.my_orders import router as my_orders_router
from routers.support_escalation import router as support_escalation_router
from routers.notify_admin import router as notify_admin_router
app.include_router(promo_router)
app.include_router(analytics_router)
app.include_router(event_history_router)
app.include_router(organizer_finance_router)
app.include_router(refunds_router)
app.include_router(tickets_router)
app.include_router(support_router)
app.include_router(organizer_router)
app.include_router(orders_router)
app.include_router(mobile_router)
app.include_router(my_orders_router)
app.include_router(support_escalation_router)
app.include_router(notify_admin_router)
app.include_router(admin_router)


bearer_scheme = HTTPBearer()


def db_for_user(token: str) -> Client:
    client = create_client(
        SUPABASE_URL,
        SUPABASE_KEY,
        options=ClientOptions(httpx_client=httpx.Client(verify=VERIFY_SSL)),
    )
    client.postgrest.auth(token)
    return client


def make_qr_payload(ticket_id: str, event_id: str, user_id: str, event: Optional[dict] = None) -> tuple[str, str]:
    """Build the signed QR payload (shared helper in crypto.py)."""
    return ticket_qr_payload(ticket_id, event_id, user_id, event)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> CurrentUser:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token.",
        )
    token = credentials.credentials
    try:
        async with httpx.AsyncClient(verify=VERIFY_SSL) as client:
            response = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {token}",
                },
            )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
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
    try:
        profile = db.table("profiles").select("*").eq("id", user_id).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=sanitize_error(exc),
        )
    if not profile.data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Profile not found.",
        )

    row = profile.data[0]
    if row.get("is_suspended"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been suspended by an administrator.",
        )

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


def tier_breakdown_for_event(db: Client, event_id: str) -> dict[str, dict]:
    try:
        rows = (
            db.table("tickets")
            .select("ticket_type_id, status")
            .eq("event_id", event_id)
            .execute()
            .data
            or []
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    out: dict[str, dict] = {}
    for row in rows:
        entry = out.setdefault(str(row.get("ticket_type_id")), {"refunded": 0, "checked_in": 0, "reserved": 0})
        state = (row.get("status") or "").lower()
        if state == "refunded":
            entry["refunded"] += 1
        elif state in ("checked_in", "used"):
            entry["checked_in"] += 1
    try:
        holds = (
            supabase.table("ticket_holds")
            .select("ticket_type_id, quantity, expires_at")
            .eq("event_id", event_id)
            .eq("status", "active")
            .execute()
            .data
            or []
        )
    except Exception:
        return out
    from datetime import datetime as _dt, timezone as _tz

    now = _dt.now(_tz.utc)
    for hold in holds:
        try:
            if _parse_ts(hold["expires_at"]) <= now:
                continue
        except Exception:
            continue
        entry = out.setdefault(str(hold.get("ticket_type_id")), {"refunded": 0, "checked_in": 0, "reserved": 0})
        entry["reserved"] += int(hold.get("quantity") or 0)
    return out


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
    updated = response.data[0]

    # FS-20: держателям билетов пишем, только если поменялись дата / время / место
    watched = ("starts_at", "ends_at", "venue_name", "venue_address")
    if updated.get("status") == "published" and any(str(event.get(k)) != str(updated.get(k)) for k in watched):
        try:
            import notify
            version = "|".join(str(updated.get(k)) for k in watched)
            notify.notify_event_holders(db, updated, "EVENT_UPDATED", f"updated:{abs(hash(version))}")
        except Exception:
            pass
    return updated


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
    previous = load_owned_event(db, event_id, current_user)
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
    cancelled = response.data[0]

    # FS-20: всем держателям билетов — письмо и уведомление об отмене (один раз на событие)
    if previous.get("status") != "cancelled":
        try:
            import notify
            notify.notify_event_holders(db, cancelled, "EVENT_CANCELLED", "cancelled")
        except Exception:
            pass
    return cancelled


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
    breakdown = tier_breakdown_for_event(db, event_id)
    zero = {"refunded": 0, "checked_in": 0, "reserved": 0}
    return [
        {**with_sold_available(row, sold_map.get(str(row["id"]), 0)), **breakdown.get(str(row["id"]), zero)}
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


# ---------------------------------------------------------------------------
# FS-16: регистрация, вход, подтверждение email, сброс пароля через Supabase Auth
# ---------------------------------------------------------------------------
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")


async def gotrue(method, path, body=None, token=None, params=None):
    """Запрос к Supabase Auth (/auth/v1/...). Возвращает (код ответа, json)."""
    headers = {"apikey": SUPABASE_KEY, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=15) as client:
            response = await client.request(method, f"{SUPABASE_URL}/auth/v1{path}", json=body, headers=headers, params=params)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Authentication service unavailable: {sanitize_error(exc)}")
    try:
        data = response.json()
    except ValueError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    return response.status_code, data


def gotrue_error(data, default):
    return data.get("msg") or data.get("error_description") or data.get("message") or default


@app.post("/api/auth/signup", response_model=SignupResponseSchema, status_code=status.HTTP_201_CREATED)
async def signup(credentials: SignupSchema):
    body = {"email": credentials.email.strip(), "password": credentials.password}
    if credentials.full_name and credentials.full_name.strip():
        body["data"] = {"full_name": credentials.full_name.strip()}

    # письмо с подтверждением отправляет сам Supabase, ссылка вернёт на /auth/callback
    code, data = await gotrue("POST", "/signup", body, params={"redirect_to": f"{FRONTEND_URL}/auth/callback"})
    if code >= 400 or "error" in data:
        raise HTTPException(status_code=code if code >= 400 else 400, detail=gotrue_error(data, "Registration failed."))

    user = data.get("user") or data
    user_id = user.get("id")
    # если в Supabase выключено подтверждение email, сразу приходит access_token
    need_confirm = not data.get("access_token") and not user.get("email_confirmed_at")

    return SignupResponseSchema(
        message="Check your inbox to confirm your email." if need_confirm else "Account created.",
        user_id=str(user_id) if user_id else None,
        verification_link=None,
        email_confirmation_required=need_confirm,
    )


@app.post("/api/auth/login", response_model=AuthResponseSchema)
async def login(credentials: UserAuthSchema):
    code, data = await gotrue(
        "POST", "/token",
        {"email": credentials.email.strip(), "password": credentials.password},
        params={"grant_type": "password"},
    )

    # при ошибке токены не отдаём вообще
    if code != 200 or "access_token" not in data:
        text = gotrue_error(data, "").lower()
        if "not confirmed" in text or "email_not_confirmed" in (data.get("error_code"), data.get("code")):
            raise HTTPException(status_code=403, detail="EMAIL_NOT_CONFIRMED")
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    user_id = str(data["user"]["id"])

    # заблокированного пользователя не пускаем
    try:
        prof = supabase.table("profiles").select("is_suspended").eq("id", user_id).execute()
        if prof.data and prof.data[0].get("is_suspended"):
            raise HTTPException(status_code=403, detail="Your account has been suspended by an administrator.")
    except HTTPException:
        raise
    except Exception:
        pass

    return AuthResponseSchema(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        user_id=user_id,
        email=data["user"]["email"],
        expires_in=data.get("expires_in"),
    )


@app.post("/api/auth/refresh", response_model=AuthResponseSchema)
async def refresh_session(payload: RefreshRequestSchema):
    # access token живёт час, потом фронт меняет refresh token на новый
    code, data = await gotrue("POST", "/token", {"refresh_token": payload.refresh_token}, params={"grant_type": "refresh_token"})
    if code != 200 or "access_token" not in data:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    return AuthResponseSchema(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        user_id=str(data["user"]["id"]),
        email=data["user"]["email"],
        expires_in=data.get("expires_in"),
    )


@app.post("/api/auth/logout", response_model=LogoutResponseSchema)
async def logout(current_user: CurrentUser = Depends(get_current_user)):
    # отзываем сессию, чтобы refresh token больше не работал
    await gotrue("POST", "/logout", token=current_user.access_token)
    return LogoutResponseSchema(message="Successfully signed out.")


@app.post("/api/auth/resend-verification", response_model=PasswordResetResponseSchema)
async def resend_verification(payload: ResendVerificationSchema):
    await gotrue("POST", "/resend", {"type": "signup", "email": payload.email.strip()},
                 params={"redirect_to": f"{FRONTEND_URL}/auth/callback"})
    return PasswordResetResponseSchema(message="If the account exists and is not confirmed yet, a new email was sent.")


@app.post("/api/auth/reset-password", response_model=PasswordResetResponseSchema)
@app.post("/api/auth/recover", response_model=PasswordResetResponseSchema)
async def request_password_reset(payload: PasswordResetRequestSchema):
    email = payload.email.strip().lower()
    code, data = await gotrue("POST", "/recover", {"email": email},
                              params={"redirect_to": f"{FRONTEND_URL}/auth/reset-password"})
    if code == 429:
        raise HTTPException(status_code=429, detail=gotrue_error(data, "Too many requests. Try again later."))
    # одинаковый ответ, есть такой email или нет (чтобы нельзя было проверять чужие адреса)
    return PasswordResetResponseSchema(message="If an account exists for this email, a reset link was sent.", reset_link=None)


@app.post("/api/auth/reset-password/confirm", response_model=PasswordResetResponseSchema)
async def confirm_password_reset(payload: PasswordResetConfirmSchema):
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=422, detail="Password must be at least 6 characters.")
    # token — это access_token из ссылки восстановления
    code, data = await gotrue("PUT", "/user", {"password": payload.new_password}, token=payload.token)
    if code in (401, 403):
        raise HTTPException(status_code=401, detail="The reset link is invalid or has expired.")
    if code != 200:
        raise HTTPException(status_code=400, detail=gotrue_error(data, "Could not update the password."))
    return PasswordResetResponseSchema(message="Password updated. You can sign in now.")


@app.get("/api/auth/verify", response_model=VerifyEmailResponseSchema)
@app.post("/api/auth/verify", response_model=VerifyEmailResponseSchema)
async def verify_auth_token(token: Optional[str] = Query(None), type: Optional[str] = Query(None)):
    if not token:
        raise HTTPException(status_code=400, detail="Missing verification token.")
    code, data = await gotrue("GET", "/user", token=token)
    if code != 200:
        raise HTTPException(status_code=401, detail="The verification link is invalid or has expired.")
    confirmed = bool(data.get("email_confirmed_at") or data.get("confirmed_at"))
    return VerifyEmailResponseSchema(
        message="Email confirmed." if confirmed else "Email is not confirmed yet.",
        verified=confirmed,
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
        is_suspended=bool(current_user.is_suspended),
    )


@app.put("/api/users/me", response_model=UserProfileSchema)
@app.patch("/api/users/me", response_model=UserProfileSchema)
async def update_me(
    payload: UserProfileUpdateSchema,
    current_user: CurrentUser = Depends(get_current_user),
):
    # Attendee cannot configure payout_info; reserved for organizers/admins
    role = (current_user.role or "").strip().lower()
    if payload.payout_info is not None and role == ROLE_ATTENDEE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Attendees cannot configure organizer payout details. Organizer role required.",
        )

    db = db_for_user(current_user.access_token)

    # Exclude fields that were not sent in the request body
    update_data = payload.model_dump(exclude_unset=True)

    # Immutable server-controlled fields
    update_data.pop("role", None)
    update_data.pop("id", None)
    update_data.pop("is_suspended", None)

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
    if event.get("is_suspended") or event.get("paid_sales_status") == "SUSPENDED":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This event is suspended by an administrator.")
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


@app.get("/api/me/tickets")
async def my_tickets(current_user: CurrentUser = Depends(get_current_user)):
    """All tickets of the signed-in attendee (FS-18: same data as /api/me/orders, flattened)."""
    from routers.my_orders import flat_tickets, load_orders

    db = db_for_user(current_user.access_token)
    try:
        orders = load_orders(db, current_user)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=sanitize_error(e))
    result = flat_tickets(orders, current_user)
    result.sort(key=lambda r: str(r.get("starts_at") or ""), reverse=True)
    return result


# ---------------------------------------------------------------------------
# CORS for the React frontend, mobile Expo dev client, and local network
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8081,http://127.0.0.1:8081,http://10.70.51.20:8081,http://192.168.0.157:8081"
    ).split(","),
    allow_origin_regex=r".*",
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
    is_public = event.get("status") == "published" and event.get("visibility") != "private" and not event.get("is_suspended")
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
