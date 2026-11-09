from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime

# ---------------------------------------------------------------------------
# Role constants (allowed exactly in profiles.role CHECK constraint)
# ---------------------------------------------------------------------------
ROLE_ATTENDEE = "attendee"
ROLE_ORGANIZER = "organizer"
ROLE_EVENT_ADMIN = "event_admin"
ROLE_PLATFORM_ADMIN = "platform_admin"
ALL_ROLES = {ROLE_ATTENDEE, ROLE_ORGANIZER, ROLE_EVENT_ADMIN, ROLE_PLATFORM_ADMIN}


class UserAuthSchema(BaseModel):
    """Schema for signup and login requests."""
    email: str
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
    email: str


class CurrentUser(BaseModel):
    """Authenticated user loaded by get_current_user. Not returned over HTTP."""
    id: str
    email: str
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    payout_info: Optional[str] = None
    role: Optional[str] = None
    access_token: str


class UserProfileSchema(BaseModel):
    """Schema for user profile."""
    id: str
    email: str
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    payout_info: Optional[str] = None
    role: Optional[str] = 'attendee'


class UserProfileUpdateSchema(BaseModel):
    """Schema for updating user profile."""
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    payout_info: Optional[str] = None  # e.g., IBAN / KZT account details


class EventCreateSchema(BaseModel):
    """Payload for creating an organizer event (always stored as draft)."""
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    timezone: Optional[str] = None
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None
    image_url: Optional[str] = None
    visibility: Optional[str] = None
    registration_opens_at: Optional[datetime] = None
    registration_closes_at: Optional[datetime] = None
    capacity: Optional[int] = None


class EventUpdateSchema(EventCreateSchema):
    """Partial update for an organizer event. Status is not client-writable."""
    pass


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

# PB-11 schemas
class TicketIssueRequest(BaseModel):
    """Request payload for issuing a new ticket with QR payload."""
    ticket_id: str
    event_id: str
    user_id: str
    expires_in_hours: int = 72

class TicketIssueResponse(BaseModel):
    """Response containing issued ticket details and QR payload."""
    ticket_id: str
    qr_payload: str
    status: str = "valid"

class TicketVerifyRequest(BaseModel):
    """Payload for verifying a QR code."""
    qr_payload: str

class TicketVerifyResponse(BaseModel):
    """Result of QR verification."""
    valid: bool
    message: str
    ticket_id: str | None = None


# ---------------------------------------------------------------------------
# PB-16: Support Cases & Paid Sales Activation schemas
# ---------------------------------------------------------------------------

class SupportCaseCreateRequest(BaseModel):
    category: str
    subject: str
    message: Optional[str] = None
    body: Optional[str] = None  # accepts either message or body
    event_id: Optional[str] = None
    order_id: Optional[str] = None
    ticket_id: Optional[str] = None


class SupportMessageCreateRequest(BaseModel):
    body: str


class SupportCaseStatusUpdateRequest(BaseModel):
    status: str
    assign_to_caller: Optional[bool] = False
    assign_to_me: Optional[bool] = False


class SupportMessageSchema(BaseModel):
    id: str
    case_id: str
    sender_id: str
    body: str
    created_at: Optional[datetime] = None


class SupportCaseSchema(BaseModel):
    id: str
    requester_id: str
    category: str
    status: str
    subject: str
    event_id: Optional[str] = None
    order_id: Optional[str] = None
    ticket_id: Optional[str] = None
    assigned_to: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class SupportCaseDetailResponse(BaseModel):
    case: SupportCaseSchema
    messages: list[SupportMessageSchema]


class PaidSalesActivationRequest(BaseModel):
    paid_event_terms_accepted: bool


class ChecklistItem(BaseModel):
    passed: bool
    detail: Optional[str] = None
    simulated: Optional[bool] = None
    amount_kzt: Optional[int] = None


class PaidSalesActivationChecklist(BaseModel):
    at_least_one_paid_ticket_type: ChecklistItem
    identity_verified: ChecklistItem
    valid_payout_account: ChecklistItem
    paid_event_terms_accepted: ChecklistItem
    activation_fee_paid: ChecklistItem


class PaidSalesActivationResponse(BaseModel):
    status: str
    paid_sales_status: str
    paid_sales_active: Optional[bool] = None
    event_id: str
    payment_id: Optional[str] = None
    activation_fee_kzt: Optional[int] = None
    simulated: Optional[bool] = None
    checklist: Optional[dict[str, Any]] = None

