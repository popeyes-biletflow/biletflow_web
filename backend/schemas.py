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
STAFF_ROLES = {ROLE_EVENT_ADMIN, ROLE_ORGANIZER, ROLE_PLATFORM_ADMIN, "admin"}


class UserAuthSchema(BaseModel):
    """Schema for signup and login requests."""
    email: str
    password: str


class SignupSchema(UserAuthSchema):
    """Signup also takes the display name, stored in the auth user metadata."""
    full_name: Optional[str] = None


class SignupResponseSchema(BaseModel):
    """Schema for signup response."""
    message: str
    user_id: Optional[str] = None
    verification_link: Optional[str] = None
    email_confirmation_required: bool = True


class AuthResponseSchema(BaseModel):
    """Schema for successful login response."""
    access_token: str
    refresh_token: str
    user_id: str
    email: str
    expires_in: Optional[int] = None


class RefreshRequestSchema(BaseModel):
    refresh_token: str


class ResendVerificationSchema(BaseModel):
    email: str


class PasswordResetRequestSchema(BaseModel):
    """Request a password reset link."""
    email: str


class PasswordResetConfirmSchema(BaseModel):
    """Confirm password reset with token."""
    token: str
    new_password: str


class PasswordResetResponseSchema(BaseModel):
    message: str
    reset_link: Optional[str] = None


class LogoutResponseSchema(BaseModel):
    message: str


class VerifyEmailResponseSchema(BaseModel):
    message: str
    verified: bool


class CurrentUser(BaseModel):
    """Authenticated user loaded by get_current_user. Not returned over HTTP."""
    id: str
    email: str
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    payout_info: Optional[str] = None
    role: Optional[str] = None
    access_token: str
    is_suspended: bool = False


class UserProfileSchema(BaseModel):
    """Schema for user profile."""
    id: str
    email: str
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    payout_info: Optional[str] = None
    role: Optional[str] = 'attendee'
    is_suspended: bool = False


class UserProfileUpdateSchema(BaseModel):
    """Schema for updating user profile.
    
    Self-service profile edits cannot change role or ownership.
    payout_info is reserved for organizers and admins.
    """
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


class TicketTypeCreateSchema(BaseModel):
    """Payload for creating a ticket type on an organizer event."""
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[int] = None
    quantity: Optional[int] = None
    sale_starts_at: Optional[datetime] = None
    sale_ends_at: Optional[datetime] = None
    max_per_order: Optional[int] = None
    is_hidden: Optional[bool] = None


class TicketTypeUpdateSchema(TicketTypeCreateSchema):
    """Partial update for a ticket type, including hide/unhide."""
    pass


class RegisterEventSchema(BaseModel):
    """Schema for registering for an event."""
    ticket_type_id: str
    promo_code: Optional[str] = None


class CheckoutQuoteRequest(BaseModel):
    """Price preview before the (simulated) payment is confirmed."""
    ticket_type_id: str
    promo_code: Optional[str] = None


class CheckoutQuoteResponse(BaseModel):
    ticket_type_id: str
    subtotal_kzt: int
    discount_kzt: int
    fee_kzt: int
    total_kzt: int
    promo_code: Optional[str] = None
    discount_percent: int = 0
    simulated: bool = True


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
    pricing: Optional[CheckoutQuoteResponse] = None

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


# ---------------------------------------------------------------------------
# FS-03: Platform Moderation & Admin Schemas
# ---------------------------------------------------------------------------

class AdminUserItem(BaseModel):
    id: str
    email: str
    full_name: Optional[str] = None
    role: str = ROLE_ATTENDEE
    payout_info: Optional[str] = None
    is_suspended: bool = False
    created_at: Optional[str] = None


class AdminEventItem(BaseModel):
    id: str
    title: str
    organizer_id: Optional[str] = None
    status: str
    visibility: str
    paid_sales_status: str
    paid_sales_active: bool
    is_suspended: bool = False
    created_at: Optional[str] = None


class AdminSuspensionRequest(BaseModel):
    reason: Optional[str] = None


class AdminSuspensionResponse(BaseModel):
    success: bool
    suspended: bool
    message: str
    entity_id: str
    audit_recorded: bool = True


class ActivationFeeSettingSchema(BaseModel):
    activation_fee_kzt: int


class OperationalExportResponse(BaseModel):
    events_count: int
    orders_count: int
    tickets_count: int
    total_revenue_kzt: int
    timestamp: str
    events: list[dict[str, Any]] = []
    orders: list[dict[str, Any]] = []


# ---------------------------------------------------------------------------
# FS-04: Staff Assignment & Admission Schemas
# ---------------------------------------------------------------------------

class StaffAssignmentRequest(BaseModel):
    user_id: Optional[str] = None
    email: Optional[str] = None


class StaffAssignmentItem(BaseModel):
    id: str
    event_id: str
    user_id: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    assigned_at: Optional[str] = None


# ---------------------------------------------------------------------------
# FS-05: Notification Schemas
# ---------------------------------------------------------------------------

class NotificationItem(BaseModel):
    id: str
    user_id: str
    type: str
    title: str
    message: str
    data: Optional[dict[str, Any]] = None
    read: bool = False
    created_at: Optional[str] = None
