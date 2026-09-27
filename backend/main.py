import os
import httpx
from fastapi import FastAPI, HTTPException, status
from dotenv import load_dotenv

from schemas import UserAuthSchema, SignupResponseSchema, AuthResponseSchema

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

app = FastAPI(title="BiletFlow Auth API")

@app.get("/")
def read_root():
    return {"message": "Welcome to BiletFlow API"}

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

    async with httpx.AsyncClient() as client:
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

    async with httpx.AsyncClient() as client:
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
        user_id=data["user"]["id"],
        email=data["user"]["email"]
    )