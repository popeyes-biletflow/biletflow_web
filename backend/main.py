import os
import hmac
import hashlib
import uuid
import httpx
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from dotenv import load_dotenv
from supabase import create_client, Client, ClientOptions

from schemas import (
    UserAuthSchema,
    SignupResponseSchema,
    AuthResponseSchema,
    CurrentUser,
    UserProfileSchema,
    UserProfileUpdateSchema,
    RegisterEventSchema,
    TicketIssueSchema,
)

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
QR_SECRET = os.getenv("QR_SECRET")
options = ClientOptions(httpx_client=httpx.Client(verify=False))
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY, options=options)
app = FastAPI(title="BiletFlow Auth API")
bearer_scheme = HTTPBearer()


def db_for_user(token: str) -> Client:
    client = create_client(
        SUPABASE_URL,
        SUPABASE_KEY,
        options=ClientOptions(httpx_client=httpx.Client(verify=False)),
    )
    client.postgrest.auth(token)
    return client


def make_qr_payload(ticket_id: str, event_id: str, user_id: str) -> tuple[str, str]:
    if not QR_SECRET:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="QR_SECRET is not configured.",
        )
    message = f"{ticket_id}.{event_id}.{user_id}"
    signature = hmac.new(
        QR_SECRET.encode(),
        message.encode(),
        hashlib.sha256,
    ).hexdigest()
    return f"{message}.{signature}", signature


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


@app.get("/")
def read_root():
    return {"message": "Welcome to BiletFlow API"}


@app.get("/api/events")
def get_events():
    try:
        response = supabase.table("events").select("*").execute()
        return response.data
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


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
    db = db_for_user(current_user.access_token)
    ticket_type_id = payload.ticket_type_id

    try:
        event_res = db.table("events").select("id").eq("id", event_id).execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    if not event_res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

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
    if str(ticket_type["event_id"]) != event_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ticket type does not belong to this event.",
        )

    try:
        existing = (
            db.table("tickets")
            .select("id")
            .eq("user_id", current_user.id)
            .eq("event_id", event_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    if existing.data:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Already registered for this event.",
        )

    quantity = ticket_type.get("quantity")
    if quantity is not None and quantity <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This ticket type is sold out.",
        )

    ticket_id = str(uuid.uuid4())
    qr_payload, signature = make_qr_payload(ticket_id, event_id, current_user.id)

    try:
        order_res = (
            db.table("orders")
            .insert({
                "user_id": current_user.id,
                "total_amount": ticket_type.get("price") or 0,
                "status": "completed",
            })
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    if not order_res.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create order.",
        )
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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    if not ticket_res.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to issue ticket.",
        )

    # Decrement inventory atomically via Postgres RPC
    if quantity is not None:
        try:
            rpc_res = db.rpc(
                "decrement_ticket_quantity",
                {"p_ticket_type_id": ticket_type_id}
            ).execute()

            # If rpc returns False, another request took the last ticket
            if not rpc_res.data:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="This ticket type is sold out.",
                )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(e),
            )

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
    )
