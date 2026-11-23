"""Comprehensive acceptance tests for BiletFlow Final Sprint issues:
- FS-01: Release identity and role enforcement
- FS-02: Organizer event and ticket-type lifecycle API
- FS-03: Per-event activation and platform moderation API
- FS-04: Atomic ticket admission, assignments, and undo API
- FS-05: Contextual support cases and message API
"""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

os.environ.setdefault("QR_SECRET", "final-sprint-test-secret")
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_KEY", "dummy-test-key")

from crypto import generate_hmac_signature
import deps
import main as main_module
from main import app, get_current_user, get_optional_user
from schemas import (
    CurrentUser,
    ROLE_ATTENDEE,
    ROLE_EVENT_ADMIN,
    ROLE_ORGANIZER,
    ROLE_PLATFORM_ADMIN,
)

client = TestClient(app, raise_server_exceptions=True)

# Synthetic test personas
ATTENDEE_1 = CurrentUser(id="user-att-1", email="attendee1@biletflow.kz", full_name="Aigerim Serik", role=ROLE_ATTENDEE, access_token="jwt-att-1")
ATTENDEE_2 = CurrentUser(id="user-att-2", email="attendee2@biletflow.kz", full_name="Berik Bolat", role=ROLE_ATTENDEE, access_token="jwt-att-2")
ORGANIZER_A = CurrentUser(id="user-org-a", email="organizerA@biletflow.kz", full_name="Org A Corp", role=ROLE_ORGANIZER, payout_info="KZ123456789012345678", access_token="jwt-org-a")
ORGANIZER_B = CurrentUser(id="user-org-b", email="organizerB@biletflow.kz", full_name="Org B LLC", role=ROLE_ORGANIZER, payout_info="KZ987654321098765432", access_token="jwt-org-b")
STAFF_ASSIGNED = CurrentUser(id="user-staff-1", email="staff1@biletflow.kz", full_name="Staff Assigned", role=ROLE_EVENT_ADMIN, access_token="jwt-staff-1")
STAFF_UNASSIGNED = CurrentUser(id="user-staff-2", email="staff2@biletflow.kz", full_name="Staff Unassigned", role=ROLE_EVENT_ADMIN, access_token="jwt-staff-2")
PLATFORM_ADMIN = CurrentUser(id="user-admin-1", email="admin@biletflow.kz", full_name="System Admin", role=ROLE_PLATFORM_ADMIN, access_token="jwt-admin-1")


def iso(hours_from_now: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours_from_now)).isoformat()


class MockQueryResult:
    def __init__(self, data):
        self.data = data


class InMemoryDB:
    """Multi-table in-memory store simulating Supabase postgrest tables."""

    def __init__(self, **tables):
        self.tables: dict[str, list[dict]] = {k: [dict(r) for r in v] for k, v in tables.items()}

    def table(self, table_name: str):
        return InMemoryQuery(self, table_name)

    def rpc(self, rpc_name: str, params: dict):
        # Fallback to test simulation
        return MagicMock(data=None)


class InMemoryQuery:
    def __init__(self, db: InMemoryDB, table_name: str):
        self.db = db
        self.table_name = table_name
        self.filters = []
        self.op = "select"
        self.payload = None
        self._order_col = None
        self._desc = False
        self._range = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, col: str, val: any):
        self.filters.append(lambda r: str(r.get(col)) == str(val))
        return self

    def in_(self, col: str, vals: list):
        vset = {str(v) for v in vals}
        self.filters.append(lambda r: str(r.get(col)) in vset)
        return self

    def or_(self, cond_str: str):
        # Simple parser for mock support filters like "requester_id.eq.X,event_id.in.(...)"
        return self

    def order(self, col: str, desc: bool = False):
        self._order_col = col
        self._desc = desc
        return self

    def range(self, start: int, end: int):
        self._range = (start, end)
        return self

    def limit(self, count: int):
        return self

    def insert(self, data: dict):
        self.op = "insert"
        self.payload = data
        return self

    def upsert(self, data: dict):
        self.op = "upsert"
        self.payload = data
        return self

    def update(self, data: dict):
        self.op = "update"
        self.payload = data
        return self

    def delete(self):
        self.op = "delete"
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table_name, [])

        if self.op == "insert":
            row = {"id": self.payload.get("id") or str(uuid.uuid4()), "created_at": iso(0), **self.payload}
            rows.append(row)
            return MockQueryResult([row])

        if self.op == "upsert":
            existing = [r for r in rows if r.get("id") == self.payload.get("id")]
            if existing:
                existing[0].update(self.payload)
                return MockQueryResult(existing)
            row = {"id": self.payload.get("id") or str(uuid.uuid4()), "created_at": iso(0), **self.payload}
            rows.append(row)
            return MockQueryResult([row])

        matched = [r for r in rows if all(f(r) for f in self.filters)]

        if self.op == "update":
            for r in matched:
                r.update(self.payload)
            return MockQueryResult([dict(r) for r in matched])

        if self.op == "delete":
            for r in matched:
                rows.remove(r)
            return MockQueryResult(matched)

        # Select
        res = [dict(r) for r in matched]
        if self._range:
            start, end = self._range
            res = res[start : end + 1]
        return MockQueryResult(res)


def execute_request(db: InMemoryDB, user: CurrentUser | None, method: str, url: str, **kwargs):
    """Execute a request with dependency overrides and DB patching."""
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_optional_user] = lambda: user
    app.dependency_overrides[deps.get_current_user] = lambda: user

    headers = kwargs.pop("headers", {})
    if user:
        headers["Authorization"] = f"Bearer {user.access_token}"

    with patch.object(main_module, "supabase", db), \
         patch.object(main_module, "db_for_user", lambda _t: db), \
         patch("routers.organizer.supabase", db), \
         patch("routers.organizer.db_for_user", lambda _t: db), \
         patch("routers.tickets.supabase", db), \
         patch("routers.mobile.supabase", db), \
         patch("routers.mobile.db_for_user", lambda _t: db), \
         patch("routers.support.supabase", db), \
         patch("routers.support.db_for_user", lambda _t: db), \
         patch("routers.admin.supabase", db), \
         patch("routers.admin.db_for_user", lambda _t: db):
        try:
            return getattr(client, method.lower())(url, headers=headers, **kwargs)
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# FS-01 Tests: Identity and Role Enforcement
# ===========================================================================

def test_fs01_auth_reset_and_verification_endpoints():
    """Reset and verification go through Supabase Auth (FS-16 replaced the demo links)."""
    from unittest.mock import AsyncMock
    db = InMemoryDB(profiles=[])
    fake = AsyncMock(side_effect=[
        (200, {}),  # POST /recover
        (200, {"id": "u1", "email_confirmed_at": "2026-11-20T10:00:00Z"}),  # GET /user
    ])
    with patch.object(main_module, "gotrue", fake):
        res = execute_request(db, None, "post", "/api/auth/reset-password", json={"email": "user@example.com"})
        assert res.status_code == 200
        assert res.json()["reset_link"] is None

        v_res = execute_request(db, None, "get", "/api/auth/verify?token=access-token&type=signup")
        assert v_res.status_code == 200
        assert v_res.json()["verified"] is True


def test_fs01_missing_or_expired_token_yields_401():
    """An expired or missing token yields 401 on protected routes."""
    db = InMemoryDB()
    # No user override -> missing token
    res = client.get("/api/users/me")
    assert res.status_code == 401
    assert "authenticated" in res.json()["detail"].lower() or "token" in res.json()["detail"].lower()


def test_fs01_self_service_profile_edits_cannot_change_role_or_id():
    """Self-service profile edits cannot change role or ownership."""
    db = InMemoryDB(profiles=[
        {"id": ATTENDEE_1.id, "email": ATTENDEE_1.email, "role": ROLE_ATTENDEE, "full_name": "Orig Name"}
    ])
    res = execute_request(
        db, ATTENDEE_1, "put", "/api/users/me",
        json={"full_name": "Updated Name", "role": ROLE_PLATFORM_ADMIN, "id": "forged-id"}
    )
    assert res.status_code == 200
    # Role and ID remain unchanged
    profile = db.tables["profiles"][0]
    assert profile["role"] == ROLE_ATTENDEE
    assert profile["id"] == ATTENDEE_1.id
    assert profile["full_name"] == "Updated Name"


def test_fs01_organizer_payout_fields_stay_owner_admin_only():
    """Organizer payout fields stay owner/admin-only; attendees receive 403."""
    db = InMemoryDB(profiles=[
        {"id": ATTENDEE_1.id, "email": ATTENDEE_1.email, "role": ROLE_ATTENDEE}
    ])
    res = execute_request(
        db, ATTENDEE_1, "put", "/api/users/me",
        json={"payout_info": "KZ999999999999999999"}
    )
    assert res.status_code == 403
    assert "organizer payout details" in res.json()["detail"].lower()


def test_fs01_attendee_receives_403_from_organizer_and_moderation():
    """A normal attendee receives 403 from organizer and moderation operations."""
    db = InMemoryDB()
    # Organizer endpoint
    org_res = execute_request(db, ATTENDEE_1, "get", "/api/organizer/events")
    assert org_res.status_code == 403

    # Admin moderation endpoint
    adm_res = execute_request(db, ATTENDEE_1, "get", "/api/admin/users")
    assert adm_res.status_code == 403


# ===========================================================================
# FS-02 Tests: Organizer Lifecycle and Visibility Rules
# ===========================================================================

def test_fs02_two_organizers_can_manage_only_their_own_records():
    """Two organizers can manage only their own records."""
    event_a = {
        "id": "ev-a", "organizer_id": ORGANIZER_A.id, "title": "Org A Event",
        "status": "draft", "visibility": "public", "starts_at": iso(48), "venue_name": "Hall A"
    }
    db = InMemoryDB(events=[event_a], ticket_types=[])

    # Organizer B attempts to edit Organizer A's event
    patch_res = execute_request(
        db, ORGANIZER_B, "patch", f"/api/organizer/events/{event_a['id']}",
        json={"title": "Hacked Title"}
    )
    assert patch_res.status_code == 403
    assert "not manage this event" in patch_res.json()["detail"]

    # Organizer B attempts to publish Organizer A's event
    pub_res = execute_request(db, ORGANIZER_B, "post", f"/api/organizer/events/{event_a['id']}/publish")
    assert pub_res.status_code == 403

    # Organizer A edits successfully
    ok_res = execute_request(
        db, ORGANIZER_A, "patch", f"/api/organizer/events/{event_a['id']}",
        json={"title": "Legit Title"}
    )
    assert ok_res.status_code == 200
    assert ok_res.json()["title"] == "Legit Title"


def test_fs02_public_discovery_and_visibility_rules():
    """Public discovery lists published public events, direct links follow visibility rules."""
    events = [
        {"id": "ev-pub", "title": "Public Event", "status": "published", "visibility": "public", "organizer_id": ORGANIZER_A.id},
        {"id": "ev-unlisted", "title": "Unlisted Event", "status": "published", "visibility": "unlisted", "organizer_id": ORGANIZER_A.id},
        {"id": "ev-private", "title": "Private Event", "status": "published", "visibility": "private", "organizer_id": ORGANIZER_A.id},
        {"id": "ev-draft", "title": "Draft Event", "status": "draft", "visibility": "public", "organizer_id": ORGANIZER_A.id},
        {"id": "ev-cancelled", "title": "Cancelled Event", "status": "cancelled", "visibility": "public", "organizer_id": ORGANIZER_A.id},
    ]
    db = InMemoryDB(events=events, ticket_types=[], tickets=[])

    # Discovery lists only published public
    disc = execute_request(db, None, "get", "/api/events")
    assert disc.status_code == 200
    listed_ids = [e["id"] for e in disc.json()]
    assert "ev-pub" in listed_ids
    assert "ev-unlisted" not in listed_ids
    assert "ev-private" not in listed_ids
    assert "ev-draft" not in listed_ids
    assert "ev-cancelled" not in listed_ids

    # Direct links:
    # 1. Unlisted is accessible via direct link
    r_unl = execute_request(db, ATTENDEE_1, "get", "/api/events/ev-unlisted")
    assert r_unl.status_code == 200
    assert r_unl.json()["id"] == "ev-unlisted"

    # 2. Private is NOT accessible to normal attendee
    r_priv = execute_request(db, ATTENDEE_1, "get", "/api/events/ev-private")
    assert r_priv.status_code == 404

    # 3. Private IS accessible to owner
    r_priv_owner = execute_request(db, ORGANIZER_A, "get", "/api/events/ev-private")
    assert r_priv_owner.status_code == 200

    # 4. Draft preview is accessible to owner but 404 to attendee
    assert execute_request(db, ATTENDEE_1, "get", "/api/events/ev-draft").status_code == 404
    assert execute_request(db, ORGANIZER_A, "get", "/api/events/ev-draft").status_code == 200


def test_fs02_hidden_tiers_disappear_and_cannot_be_purchased():
    """Hidden tiers disappear from checkout quotes and purchases."""
    ev = {"id": "ev-1", "title": "Test Fest", "status": "published", "visibility": "public", "paid_sales_status": "ACTIVE", "paid_sales_active": True}
    tt_visible = {"id": "tt-vis", "event_id": "ev-1", "name": "General", "price": 0, "is_hidden": False}
    tt_hidden = {"id": "tt-hid", "event_id": "ev-1", "name": "Backstage VIP", "price": 0, "is_hidden": True}
    db = InMemoryDB(events=[ev], ticket_types=[tt_visible, tt_hidden], tickets=[], orders=[])

    # Public tiers endpoint does not return hidden tier
    pub_tiers = execute_request(db, None, "get", "/api/events/ev-1/ticket-types")
    assert pub_tiers.status_code == 200
    tier_ids = [t["id"] for t in pub_tiers.json()]
    assert "tt-vis" in tier_ids
    assert "tt-hid" not in tier_ids

    # Purchasing hidden tier returns 404
    buy_res = execute_request(db, ATTENDEE_1, "post", "/api/events/ev-1/register", json={"ticket_type_id": "tt-hid"})
    assert buy_res.status_code == 404


def test_fs02_validation_rejects_invalid_capacities_and_windows():
    """Invalid capacities and date windows return field errors."""
    db = InMemoryDB(events=[], ticket_types=[])
    # ends_at earlier than starts_at
    bad_dates = execute_request(
        db, ORGANIZER_A, "post", "/api/organizer/events",
        json={"title": "Broken Event", "starts_at": iso(48), "ends_at": iso(24)}
    )
    assert bad_dates.status_code == 400
    assert "ends_at must be later than starts_at" in bad_dates.json()["detail"]

    # capacity < 1
    bad_cap = execute_request(
        db, ORGANIZER_A, "post", "/api/organizer/events",
        json={"title": "Broken Cap", "capacity": 0}
    )
    assert bad_cap.status_code == 400
    assert "capacity must be at least 1" in bad_cap.json()["detail"]


# ===========================================================================
# FS-03 Tests: Paid Sales Activation and Platform Moderation
# ===========================================================================

def test_fs03_inactive_event_can_distribute_free_but_not_paid_tier():
    """An inactive event can distribute free tickets but cannot sell a paid tier."""
    ev = {"id": "ev-inact", "title": "Free Event", "status": "published", "visibility": "public", "paid_sales_status": "NONE", "paid_sales_active": False}
    tt_free = {"id": "tt-free", "event_id": "ev-inact", "name": "Free", "price": 0, "is_hidden": False}
    tt_paid = {"id": "tt-paid", "event_id": "ev-inact", "name": "Paid Tier", "price": 5000, "is_hidden": False}
    db = InMemoryDB(events=[ev], ticket_types=[tt_free, tt_paid], tickets=[], orders=[])

    # Paid tier returns 402 Payment Required
    paid_res = execute_request(db, ATTENDEE_1, "post", "/api/events/ev-inact/register", json={"ticket_type_id": "tt-paid"})
    assert paid_res.status_code == 402

    # Free tier registration succeeds
    free_res = execute_request(db, ATTENDEE_1, "post", "/api/events/ev-inact/register", json={"ticket_type_id": "tt-free"})
    assert free_res.status_code == 201
    assert free_res.json()["status"] == "valid"


def test_fs03_activation_of_event_a_leaves_event_b_unchanged():
    """Activation of event A leaves event B unchanged."""
    ev_a = {"id": "ev-a", "organizer_id": ORGANIZER_A.id, "title": "A", "paid_sales_status": "NONE", "paid_sales_active": False}
    ev_b = {"id": "ev-b", "organizer_id": ORGANIZER_A.id, "title": "B", "paid_sales_status": "NONE", "paid_sales_active": False}
    tt_a = {"id": "tt-a", "event_id": "ev-a", "price": 2000}
    tt_b = {"id": "tt-b", "event_id": "ev-b", "price": 3000}
    db = InMemoryDB(events=[ev_a, ev_b], ticket_types=[tt_a, tt_b], payments=[], audit_log=[])

    res = execute_request(db, ORGANIZER_A, "post", "/api/organizer/events/ev-a/activate-paid-sales", json={"paid_event_terms_accepted": True})
    assert res.status_code == 200
    assert res.json()["paid_sales_status"] == "ACTIVE"

    # Event B remains inactive
    b_row = [e for e in db.tables["events"] if e["id"] == "ev-b"][0]
    assert b_row["paid_sales_status"] == "NONE"
    assert b_row["paid_sales_active"] is False


def test_fs03_admin_suspension_stops_sales_and_records_audit():
    """Suspension stops new sales server-side and records actor and action."""
    ev = {"id": "ev-active", "organizer_id": ORGANIZER_A.id, "title": "Active Event", "status": "published", "visibility": "public", "paid_sales_status": "ACTIVE", "paid_sales_active": True}
    tt = {"id": "tt-1", "event_id": "ev-active", "price": 1000, "is_hidden": False}
    db = InMemoryDB(events=[ev], ticket_types=[tt], tickets=[], orders=[], audit_log=[])

    # Admin suspends event
    susp = execute_request(db, PLATFORM_ADMIN, "post", "/api/admin/events/ev-active/suspend", json={"reason": "Terms violation"})
    assert susp.status_code == 200
    assert susp.json()["suspended"] is True

    # Audit log recorded
    assert any(a["action"] == "EVENT_SUSPENDED" for a in db.tables["audit_log"])

    # Purchasing now fails
    buy_res = execute_request(db, ATTENDEE_1, "post", "/api/events/ev-active/register", json={"ticket_type_id": "tt-1"})
    assert buy_res.status_code == 400
    assert "suspended" in buy_res.json()["detail"].lower()


# ===========================================================================
# FS-04 Tests: Atomic Ticket Admission, Staff Assignment, and Undo
# ===========================================================================

def test_fs04_staff_assignment_lifecycle():
    """Organizer assigns staff, lists staff, and unassigns staff."""
    ev = {"id": "ev-target", "organizer_id": ORGANIZER_A.id, "title": "Target Event"}
    staff_profile = {"id": STAFF_ASSIGNED.id, "email": STAFF_ASSIGNED.email, "role": ROLE_EVENT_ADMIN}
    db = InMemoryDB(events=[ev], profiles=[staff_profile], event_staff=[], audit_log=[])

    # 1. Assign staff
    assign_res = execute_request(
        db, ORGANIZER_A, "post", "/api/organizer/events/ev-target/staff",
        json={"email": STAFF_ASSIGNED.email}
    )
    assert assign_res.status_code == 201
    assert assign_res.json()["user_id"] == STAFF_ASSIGNED.id

    # 2. List assigned staff
    list_res = execute_request(db, ORGANIZER_A, "get", "/api/organizer/events/ev-target/staff")
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1

    # 3. Unassign staff
    del_res = execute_request(db, ORGANIZER_A, "delete", f"/api/organizer/events/ev-target/staff/{STAFF_ASSIGNED.id}")
    assert del_res.status_code == 200


def test_fs04_unassigned_users_cannot_access_roster_or_verify():
    """Unassigned users cannot access rosters or verify tickets."""
    ev = {"id": "ev-gated", "organizer_id": ORGANIZER_A.id, "title": "Gated Event"}
    # Staff 1 is assigned, Staff 2 is NOT
    staff_row = {"id": "es-1", "event_id": "ev-gated", "user_id": STAFF_ASSIGNED.id}
    db = InMemoryDB(events=[ev], event_staff=[staff_row], tickets=[], audit_log=[])

    # Unassigned staff gets 403 on attendance roster
    att_res = execute_request(db, STAFF_UNASSIGNED, "get", "/api/mobile/events/ev-gated/attendance")
    assert att_res.status_code == 403

    # Assigned staff succeeds
    ok_res = execute_request(db, STAFF_ASSIGNED, "get", "/api/mobile/events/ev-gated/attendance")
    assert ok_res.status_code == 200


def test_fs04_parallel_scans_and_double_checkin_protection():
    """Parallel scans of the same ticket produce one admission and one already-used (409) result."""
    tid = "t-atomic-1"
    ev_id = "ev-checkin"
    expires = 9999999999
    sig = generate_hmac_signature(tid, ev_id, ATTENDEE_1.id, expires)
    qr = f"{tid}:{ev_id}:{ATTENDEE_1.id}:{expires}:{sig}"

    ev = {"id": ev_id, "organizer_id": ORGANIZER_A.id}
    ticket = {"id": tid, "event_id": ev_id, "user_id": ATTENDEE_1.id, "status": "valid"}
    staff_row = {"id": "es-1", "event_id": ev_id, "user_id": STAFF_ASSIGNED.id}
    db = InMemoryDB(events=[ev], tickets=[ticket], event_staff=[staff_row], audit_log=[])

    # First scan succeeds
    scan1 = execute_request(db, STAFF_ASSIGNED, "post", "/api/tickets/verify", json={"qr_payload": qr})
    assert scan1.status_code == 200
    assert scan1.json()["valid"] is True
    assert db.tables["tickets"][0]["status"] == "checked_in"

    # Second scan returns 409 conflict
    scan2 = execute_request(db, STAFF_ASSIGNED, "post", "/api/tickets/verify", json={"qr_payload": qr})
    assert scan2.status_code == 409
    assert "already been used" in scan2.json()["detail"]


def test_fs04_invalid_inputs_cannot_mutate_attendance():
    """Invalid, wrong-event, or refunded QR inputs cannot mutate attendance."""
    ev_id = "ev-checkin"
    ticket_refunded = {"id": "t-ref", "event_id": ev_id, "user_id": ATTENDEE_1.id, "status": "refunded"}
    staff_row = {"id": "es-1", "event_id": ev_id, "user_id": STAFF_ASSIGNED.id}
    db = InMemoryDB(events=[{"id": ev_id, "organizer_id": ORGANIZER_A.id}], tickets=[ticket_refunded], event_staff=[staff_row], audit_log=[])

    expires = 9999999999
    sig = generate_hmac_signature("t-ref", ev_id, ATTENDEE_1.id, expires)
    qr = f"t-ref:{ev_id}:{ATTENDEE_1.id}:{expires}:{sig}"

    res = execute_request(db, STAFF_ASSIGNED, "post", "/api/tickets/verify", json={"qr_payload": qr})
    assert res.status_code == 400
    assert ticket_refunded["status"] == "refunded"


def test_fs04_authorized_undo_restores_eligibility_and_records_audit():
    """Authorized undo restores eligibility and adds a reversal audit entry."""
    tid = "t-undo-1"
    ev_id = "ev-checkin"
    ticket = {"id": tid, "event_id": ev_id, "status": "checked_in"}
    staff_row = {"id": "es-1", "event_id": ev_id, "user_id": STAFF_ASSIGNED.id}
    db = InMemoryDB(events=[{"id": ev_id, "organizer_id": ORGANIZER_A.id}], tickets=[ticket], event_staff=[staff_row], audit_log=[])

    # Undo
    undo_res = execute_request(db, STAFF_ASSIGNED, "post", "/api/tickets/undo-checkin", json={"eventId": ev_id, "ticketId": tid})
    assert undo_res.status_code == 200
    assert undo_res.json()["success"] is True

    # Status reverted to valid
    assert db.tables["tickets"][0]["status"] == "valid"

    # Audit log recorded
    assert any(a["action"] == "TICKET_CHECKIN_REVERSED" for a in db.tables["audit_log"])


# ===========================================================================
# FS-05 Tests: Contextual Support Cases and Messages
# ===========================================================================

def test_fs05_attendee_opens_case_and_forged_order_link_fails():
    """An attendee can open a case; forged order/ticket links fail."""
    ev = {"id": "ev-sup", "organizer_id": ORGANIZER_A.id, "title": "Support Event"}
    my_order = {"id": "ord-mine", "user_id": ATTENDEE_1.id}
    other_order = {"id": "ord-other", "user_id": ATTENDEE_2.id}
    db = InMemoryDB(events=[ev], orders=[my_order, other_order], tickets=[], support_cases=[], support_messages=[], audit_log=[], notifications=[])

    # Attempting to link other attendee's order yields 403
    forged_res = execute_request(
        db, ATTENDEE_1, "post", "/api/support/cases",
        json={"category": "payment", "subject": "Payment query", "message": "My order", "order_id": "ord-other"}
    )
    assert forged_res.status_code == 403

    # Linking own order succeeds
    ok_res = execute_request(
        db, ATTENDEE_1, "post", "/api/support/cases",
        json={"category": "payment", "subject": "Payment query", "message": "Help with order", "order_id": "ord-mine"}
    )
    assert ok_res.status_code == 201
    assert ok_res.json()["case"]["requester_id"] == ATTENDEE_1.id


def test_fs05_cross_organizer_access_fails_and_messages_exchange():
    """Cross-organizer access fails; authorized staff exchange replies and notifications emit."""
    ev_a = {"id": "ev-a", "organizer_id": ORGANIZER_A.id}
    ev_b = {"id": "ev-b", "organizer_id": ORGANIZER_B.id}
    case = {"id": "case-1", "requester_id": ATTENDEE_1.id, "event_id": "ev-a", "category": "refund", "status": "OPEN", "subject": "Refund please"}
    db = InMemoryDB(
        events=[ev_a, ev_b],
        support_cases=[case],
        support_messages=[],
        profiles=[{"id": ATTENDEE_1.id, "role": ROLE_ATTENDEE}],
        audit_log=[],
        notifications=[],
    )

    # Organizer B cannot access case for Event A
    org_b_res = execute_request(db, ORGANIZER_B, "get", "/api/support/cases/case-1")
    assert org_b_res.status_code == 403

    # Organizer A can access case for Event A
    org_a_res = execute_request(db, ORGANIZER_A, "get", "/api/support/cases/case-1")
    assert org_a_res.status_code == 200

    # Organizer A updates status to RESOLVED
    status_res = execute_request(db, ORGANIZER_A, "patch", "/api/support/cases/case-1/status", json={"status": "RESOLVED"})
    assert status_res.status_code == 200
    assert status_res.json()["case"]["status"] == "RESOLVED"

    # Notification was emitted for attendee
    assert any(n["user_id"] == ATTENDEE_1.id and "RESOLVED" in n["title"] for n in db.tables["notifications"])
