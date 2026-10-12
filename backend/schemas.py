from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime


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


class CurrentUser(BaseModel):
    """Authenticated user loaded by get_current_user. Not returned over HTTP."""
    id: str
    email: EmailStr
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    payout_info: Optional[str] = None
    role: Optional[str] = None
    access_token: str


class UserProfileSchema(BaseModel):
    """Schema for user profile."""
    id: str
    email: EmailStr
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    payout_info: Optional[str] = None
    role: Optional[str] = 'attendee'


class UserProfileUpdateSchema(BaseModel):
    """Schema for updating user profile."""
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    payout_info: Optional[str] = None  # e.g., IBAN / KZT account details


class RegisterEventSchema(BaseModel):
    """Schema for registering for an event."""
    ticket_type_id: str


class TicketIssueSchema(BaseModel):
    """Schema for issuing a ticket."""
    id: str
    order_id: str
    ticket_type_id: str
    user_id: str
    event_id: str
    status: str
    qr_code_hash: str
    qr_payload: str  # Encoded string sent to UI for rendering the QR code image
    checked_in_at: Optional[datetime] = None
    checked_in_by: Optional[str] = None
