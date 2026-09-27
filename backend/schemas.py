from pydantic import BaseModel, EmailStr
from typing import Optional


class UserAuthSchema(BaseModel):
    """Schema for signup and login requests."""
    email: EmailStr
    password: str


class SignupResponseSchema(BaseModel):
    """Schema for signup response."""
    message: str
    user_id: Optional[str] = None


class AuthResponseSchema(BaseModel):
    """Schema for successful login response."""
    access_token: str
    refresh_token: str
    user_id: str
    email: EmailStr