"""Shared FastAPI dependencies for BiletFlow.

Extracted here so that new routers can import ``get_current_user`` and
``db_for_user`` without creating a circular dependency on ``main.py``.
The module-level ``supabase`` client is also re-exported so routers can
use a single service-role client for read operations that do not need
per-user RLS.
"""
import os

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client, ClientOptions, create_client

from schemas import CurrentUser

SUPABASE_URL: str | None = os.getenv("SUPABASE_URL")
SUPABASE_KEY: str | None = os.getenv("SUPABASE_KEY")

# Service-role (anon-key) client — shared, synchronous.
supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_KEY,
    options=ClientOptions(httpx_client=httpx.Client(verify=False)),
)

bearer_scheme = HTTPBearer()


def db_for_user(token: str) -> Client:
    """Return a fresh Supabase client scoped to the user's JWT (RLS-aware)."""
    client = create_client(
        SUPABASE_URL,
        SUPABASE_KEY,
        options=ClientOptions(httpx_client=httpx.Client(verify=False)),
    )
    client.postgrest.auth(token)
    return client


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> CurrentUser:
    """Validate the Bearer JWT and return the authenticated user's profile."""
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
