"""Shared FastAPI dependencies for BiletFlow.

Extracted here so that new routers can import ``get_current_user`` and
``db_for_user`` without creating a circular dependency on ``main.py``.
The module-level ``supabase`` client is also re-exported so routers can
use a single service-role client for read operations that do not need
per-user RLS.
"""
import logging
import os
from typing import Optional

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client, ClientOptions, create_client

from schemas import (
    CurrentUser,
    ROLE_ATTENDEE,
    ROLE_ORGANIZER,
    ROLE_EVENT_ADMIN,
    ROLE_PLATFORM_ADMIN,
)

logger = logging.getLogger("biletflow")

SUPABASE_URL: str | None = os.getenv("SUPABASE_URL")
SUPABASE_KEY: str | None = os.getenv("SUPABASE_KEY")

# In production and by default, SSL/TLS certificate verification is enabled.
VERIFY_SSL = os.getenv("VERIFY_SSL", "true").lower() in ("true", "1", "yes")

_client_options = ClientOptions(httpx_client=httpx.Client(verify=VERIFY_SSL))

# Service-role (anon-key) client — shared, synchronous.
supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_KEY,
    options=_client_options,
)

bearer_scheme = HTTPBearer(auto_error=False)


def sanitize_error(exc: Exception, default_msg: str = "A database or service error occurred.") -> str:
    """Sanitize internal errors to prevent leaking raw connection tokens, credentials, or traces."""
    msg = str(exc)
    logger.error("Internal service error: %s", msg)
    # Strip potential sensitive patterns
    if "key=" in msg or "Bearer " in msg or "password" in msg.lower():
        return default_msg
    if "Connection refused" in msg or "SSL" in msg or "httpx" in msg:
        return "Unable to connect to downstream service. Please try again later."
    return msg


def db_for_user(token: str) -> Client:
    """Return a fresh Supabase client scoped to the user's JWT (RLS-aware)."""
    client = create_client(
        SUPABASE_URL,
        SUPABASE_KEY,
        options=ClientOptions(httpx_client=httpx.Client(verify=VERIFY_SSL)),
    )
    client.postgrest.auth(token)
    return client


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> CurrentUser:
    """Validate the Bearer JWT and return the authenticated user's profile."""
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
    except Exception as exc:
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
