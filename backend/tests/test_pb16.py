"""PB-16 tests: Support Cases + Paid Sales Activation.

Strategy
--------
* The FastAPI ``app`` is imported from ``main``.
* Supabase calls are mocked by patching the module-level ``supabase``
  variables in ``routers.support`` and ``routers.organizer`` with
  ``unittest.mock.MagicMock``.
* ``get_current_user`` is overridden via ``app.dependency_overrides`` to
  return a ``CurrentUser`` without hitting the network.
* Uses the exact roles: attendee, organizer, event_admin, platform_admin.
"""
import sys
import os
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from typing import Any

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_KEY", "dummy-key")

from schemas import (
    CurrentUser,
    ROLE_ATTENDEE,
    ROLE_ORGANIZER,
    ROLE_EVENT_ADMIN,
    ROLE_PLATFORM_ADMIN,
)
import routers.support as support_module
import routers.organizer as organizer_module
import main as main_module
from main import app
from deps import get_current_user

client = TestClient(app, raise_server_exceptions=True)

# ---------------------------------------------------------------------------
# Factories for common test data
# ---------------------------------------------------------------------------

CASE_ID        = str(uuid.uuid4())
MSG_ID         = str(uuid.uuid4())
EVENT_ID       = str(uuid.uuid4())
ORDER_ID       = str(uuid.uuid4())
TICKET_ID      = str(uuid.uuid4())
ATTENDEE_ID    = str(uuid.uuid4())
ORGANIZER_ID   = str(uuid.uuid4())
EVENT_ADMIN_ID = str(uuid.uuid4())
ADMIN_ID       = str(uuid.uuid4())
OTHER_ID       = str(uuid.uuid4())


def make_case(overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    base = {
        "id": CASE_ID,
        "requester_id": ATTENDEE_ID,
        "category": "payment",
        "status": "OPEN",
        "subject": "Test case",
        "event_id": None,
        "order_id": None,
        "ticket_id": None,
        "assigned_to": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if overrides:
        base.update(overrides)
    return base


def make_message(overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    base = {
        "id": MSG_ID,
        "case_id": CASE_ID,
        "sender_id": ATTENDEE_ID,
        "body": "Hello support",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if overrides:
        base.update(overrides)
    return base


def make_user(
    role: str = ROLE_ATTENDEE,
    user_id: str = ATTENDEE_ID,
    payout_info: str | None = None,
) -> CurrentUser:
    return CurrentUser(
        id=user_id,
        email=f"{role}@example.com",
        full_name=f"{role.title()} User",
        phone_number=None,
        payout_info=payout_info,
        role=role,
        access_token="dummy-token",
    )


def _mock_supabase() -> MagicMock:
    """Return a fresh MagicMock that mimics supabase-py v2 chained calls."""
    mock = MagicMock()
    return mock


def _make_execute_result(data: list | None = None, error=None) -> MagicMock:
    result = MagicMock()
    result.data = data if data is not None else []
    result.error = error
    return result


def setup_supabase_mock(mock_sb: MagicMock, table_responses: dict[str, Any]) -> None:
    """Configure mock to return specific data per table name."""
    def _table(name: str) -> MagicMock:
        tbl = MagicMock()
        data = table_responses.get(name, [])
        exec_result = _make_execute_result(data)
        for method in ("select", "insert", "update", "delete", "eq", "neq",
                       "gt", "lt", "gte", "lte", "or_", "order", "range",
                       "limit", "single"):
            getattr(tbl, method).return_value = tbl
        tbl.execute.return_value = exec_result
        return tbl

    mock_sb.table.side_effect = _table


def override_user(user: CurrentUser):
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[main_module.get_current_user] = lambda: user


def clear_overrides():
    app.dependency_overrides.clear()


# ===========================================================================
# TEST 1 — Happy path: create support case (attendee)
# ===========================================================================

def test_create_support_case_attendee():
    """Attendee can open a support case and receives the case + first message."""
    user = make_user(ROLE_ATTENDEE)
    override_user(user)

    mock_sb = _mock_supabase()
    case_row = make_case()
    msg_row = make_message()

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()
        for m in ("select", "insert", "update", "delete", "eq", "neq",
                  "or_", "order", "range"):
            getattr(tbl, m).return_value = tbl
        if name == "support_cases":
            tbl.execute.return_value = _make_execute_result([case_row])
        elif name == "support_messages":
            tbl.execute.return_value = _make_execute_result([msg_row])
        else:
            tbl.execute.return_value = _make_execute_result([])
        return tbl

    mock_sb.table.side_effect = _table

    with patch.object(support_module, "supabase", mock_sb):
        with patch("routers.support.db_for_user", return_value=mock_sb):
            resp = client.post(
                "/api/support/cases",
                json={
                    "category": "payment",
                    "subject": "I was charged twice",
                    "message": "Please refund the duplicate charge.",
                },
                headers={"Authorization": "Bearer dummy-token"},
            )

    clear_overrides()
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert "case" in data
    assert "message" in data


# ===========================================================================
# TEST 2 — Support case creation derives event via tickets (orders has no event_id)
# ===========================================================================

def test_support_case_creation_derives_event_from_order_via_tickets():
    """Linking order_id derives event_id via tickets (tickets.order_id -> tickets.event_id)."""
    user = make_user(ROLE_ATTENDEE, user_id=ATTENDEE_ID)
    override_user(user)

    mock_sb = _mock_supabase()
    order_row = {"id": ORDER_ID, "user_id": ATTENDEE_ID, "total_amount": 5000, "status": "completed"}
    ticket_for_order = {"id": TICKET_ID, "order_id": ORDER_ID, "event_id": EVENT_ID}
    created_case = make_case({"order_id": ORDER_ID, "event_id": EVENT_ID})

    inserted_data = {}

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()
        for m in ("select", "insert", "update", "delete", "eq", "neq",
                  "or_", "order", "range", "limit"):
            getattr(tbl, m).return_value = tbl
        if name == "orders":
            tbl.execute.return_value = _make_execute_result([order_row])
        elif name == "tickets":
            tbl.execute.return_value = _make_execute_result([ticket_for_order])
        elif name == "support_cases":
            def _insert(data):
                inserted_data.update(data)
                return tbl
            tbl.insert.side_effect = _insert
            tbl.execute.return_value = _make_execute_result([created_case])
        elif name == "support_messages":
            tbl.execute.return_value = _make_execute_result([make_message()])
        else:
            tbl.execute.return_value = _make_execute_result([])
        return tbl

    mock_sb.table.side_effect = _table

    with patch.object(support_module, "supabase", mock_sb):
        with patch("routers.support.db_for_user", return_value=mock_sb):
            resp = client.post(
                "/api/support/cases",
                json={
                    "category": "payment",
                    "subject": "Question about my order",
                    "message": "When will I receive tickets?",
                    "order_id": ORDER_ID,
                },
                headers={"Authorization": "Bearer dummy-token"},
            )

    clear_overrides()
    assert resp.status_code == 201, resp.text
    # Verify that event_id was automatically derived and included in the case insert
    assert inserted_data.get("event_id") == EVENT_ID
    assert inserted_data.get("order_id") == ORDER_ID


# ===========================================================================
# TEST 3 — Happy path: list support cases (attendee)
# ===========================================================================

def test_list_support_cases_attendee():
    """Attendee gets a paginated list of their own cases."""
    user = make_user(ROLE_ATTENDEE)
    override_user(user)

    mock_sb = _mock_supabase()
    setup_supabase_mock(mock_sb, {"support_cases": [make_case()]})

    with patch.object(support_module, "supabase", mock_sb):
        with patch("routers.support.db_for_user", return_value=mock_sb):
            resp = client.get(
                "/api/support/cases?page=1&page_size=10",
                headers={"Authorization": "Bearer dummy-token"},
            )

    clear_overrides()
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "cases" in data
    assert data["page"] == 1


# ===========================================================================
# TEST 4 — Happy path: get case detail with messages
# ===========================================================================

def test_get_case_detail():
    """Fetching a case by ID returns case + messages."""
    user = make_user(ROLE_ATTENDEE)
    override_user(user)

    case_row = make_case()
    msg_row = make_message()
    mock_sb = _mock_supabase()

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()
        for m in ("select", "insert", "update", "delete", "eq", "neq",
                  "or_", "order", "range"):
            getattr(tbl, m).return_value = tbl
        if name == "support_cases":
            tbl.execute.return_value = _make_execute_result([case_row])
        elif name == "support_messages":
            tbl.execute.return_value = _make_execute_result([msg_row])
        else:
            tbl.execute.return_value = _make_execute_result([])
        return tbl

    mock_sb.table.side_effect = _table

    with patch.object(support_module, "supabase", mock_sb):
        with patch("routers.support.db_for_user", return_value=mock_sb):
            resp = client.get(
                f"/api/support/cases/{CASE_ID}",
                headers={"Authorization": "Bearer dummy-token"},
            )

    clear_overrides()
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["case"]["id"] == CASE_ID
    assert len(data["messages"]) == 1
    assert data["messages"][0]["id"] == MSG_ID


# ===========================================================================
# TEST 5 — Happy path: add message to case
# ===========================================================================

def test_add_message_to_case():
    """Adding a message appends it to the case thread."""
    user = make_user(ROLE_ATTENDEE)
    override_user(user)

    case_row = make_case()
    new_msg_row = make_message({"body": "Here is more info"})
    mock_sb = _mock_supabase()

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()
        for m in ("select", "insert", "update", "delete", "eq", "neq",
                  "or_", "order", "range"):
            getattr(tbl, m).return_value = tbl
        if name == "support_cases":
            tbl.execute.return_value = _make_execute_result([case_row])
        elif name == "support_messages":
            tbl.execute.return_value = _make_execute_result([new_msg_row])
        else:
            tbl.execute.return_value = _make_execute_result([])
        return tbl

    mock_sb.table.side_effect = _table

    with patch.object(support_module, "supabase", mock_sb):
        with patch("routers.support.db_for_user", return_value=mock_sb):
            resp = client.post(
                f"/api/support/cases/{CASE_ID}/messages",
                json={"body": "Here is more info"},
                headers={"Authorization": "Bearer dummy-token"},
            )

    clear_overrides()
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["message"]["body"] == "Here is more info"


# ===========================================================================
# TEST 6 — Status change: platform_admin on any case
# ===========================================================================

def test_platform_admin_changes_case_status():
    """platform_admin can update the status of any case."""
    admin = make_user(ROLE_PLATFORM_ADMIN, user_id=ADMIN_ID)
    override_user(admin)

    case_row = make_case({"status": "OPEN"})
    updated_case = make_case({"status": "IN_PROGRESS", "assigned_to": ADMIN_ID})
    mock_sb = _mock_supabase()

    support_cases_tbl = MagicMock()
    for m in ("select", "insert", "update", "delete", "eq", "neq",
              "or_", "order", "range"):
        getattr(support_cases_tbl, m).return_value = support_cases_tbl
    support_cases_tbl.execute.side_effect = [
        _make_execute_result([case_row]),      # select (verify exists)
        _make_execute_result([updated_case]),  # update
    ]

    def _table(name: str) -> MagicMock:
        if name == "support_cases":
            return support_cases_tbl
        tbl = MagicMock()
        for m in ("select", "insert", "update", "delete", "eq", "neq",
                  "or_", "order", "range"):
            getattr(tbl, m).return_value = tbl
        tbl.execute.return_value = _make_execute_result([])
        return tbl

    mock_sb.table.side_effect = _table

    with patch.object(support_module, "supabase", mock_sb):
        with patch("routers.support.db_for_user", return_value=mock_sb):
            resp = client.patch(
                f"/api/support/cases/{CASE_ID}/status",
                json={"status": "IN_PROGRESS", "assign_to_me": True},
                headers={"Authorization": "Bearer dummy-token"},
            )

    clear_overrides()
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["case"]["status"] == "IN_PROGRESS"


# ===========================================================================
# TEST 7 — Status change: owning organizer on attendee case for their event
# ===========================================================================

def test_owning_organizer_changes_attendee_case_status():
    """Owning organizer can update status on attendee cases for their own events."""
    organizer = make_user(ROLE_ORGANIZER, user_id=ORGANIZER_ID)
    override_user(organizer)

    case_row = make_case({
        "status": "OPEN",
        "requester_id": ATTENDEE_ID,
        "event_id": EVENT_ID,
    })
    updated_case = make_case({
        "status": "RESOLVED",
        "requester_id": ATTENDEE_ID,
        "event_id": EVENT_ID,
    })
    requester_profile = {"id": ATTENDEE_ID, "role": ROLE_ATTENDEE}
    event_row = {"id": EVENT_ID, "organizer_id": ORGANIZER_ID}
    mock_sb = _mock_supabase()

    support_cases_tbl = MagicMock()
    for m in ("select", "insert", "update", "delete", "eq", "neq",
              "or_", "order", "range"):
        getattr(support_cases_tbl, m).return_value = support_cases_tbl
    support_cases_tbl.execute.side_effect = [
        _make_execute_result([case_row]),      # select
        _make_execute_result([updated_case]),  # update
    ]

    def _table(name: str) -> MagicMock:
        if name == "support_cases":
            return support_cases_tbl
        tbl = MagicMock()
        for m in ("select", "insert", "update", "delete", "eq", "neq",
                  "or_", "order", "range"):
            getattr(tbl, m).return_value = tbl
        if name == "events":
            tbl.execute.return_value = _make_execute_result([event_row])
        elif name == "profiles":
            tbl.execute.return_value = _make_execute_result([requester_profile])
        else:
            tbl.execute.return_value = _make_execute_result([])
        return tbl

    mock_sb.table.side_effect = _table

    with patch.object(support_module, "supabase", mock_sb):
        with patch("routers.support.db_for_user", return_value=mock_sb):
            resp = client.patch(
                f"/api/support/cases/{CASE_ID}/status",
                json={"status": "RESOLVED"},
                headers={"Authorization": "Bearer dummy-token"},
            )

    clear_overrides()
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["case"]["status"] == "RESOLVED"


# ===========================================================================
# TEST 8 — Status change: organizer CANNOT change organizer platform cases
# ===========================================================================

def test_organizer_cannot_change_platform_support_case_status():
    """Organizer gets 403 when trying to change a platform case (no event_id)."""
    organizer = make_user(ROLE_ORGANIZER, user_id=ORGANIZER_ID)
    override_user(organizer)

    case_row = make_case({
        "status": "OPEN",
        "requester_id": ORGANIZER_ID,
        "event_id": None,
        "category": "technical",
    })
    mock_sb = _mock_supabase()
    setup_supabase_mock(mock_sb, {"support_cases": [case_row]})

    with patch.object(support_module, "supabase", mock_sb):
        with patch("routers.support.db_for_user", return_value=mock_sb):
            resp = client.patch(
                f"/api/support/cases/{CASE_ID}/status",
                json={"status": "RESOLVED"},
                headers={"Authorization": "Bearer dummy-token"},
            )

    clear_overrides()
    assert resp.status_code == 403, resp.text


# ===========================================================================
# TEST 9 — Status change: attendee and event_admin get 403 Forbidden
# ===========================================================================

def test_attendee_and_event_admin_cannot_change_status():
    """Attendee and event_admin (check-in staff only) get 403 on status changes."""
    for test_role in (ROLE_ATTENDEE, ROLE_EVENT_ADMIN):
        user = make_user(test_role, user_id=str(uuid.uuid4()))
        override_user(user)

        resp = client.patch(
            f"/api/support/cases/{CASE_ID}/status",
            json={"status": "IN_PROGRESS"},
            headers={"Authorization": "Bearer dummy-token"},
        )
        clear_overrides()
        assert resp.status_code == 403, f"Expected 403 for {test_role}, got {resp.status_code}"


# ===========================================================================
# TEST 10 — Unauthorized: attendee tries to read another user's case → 404
# ===========================================================================

def test_attendee_cannot_read_other_case():
    """Attendee gets 404 when trying to access a case belonging to another user."""
    user = make_user(ROLE_ATTENDEE, user_id=OTHER_ID)
    override_user(user)

    case_row = make_case()  # requester_id = ATTENDEE_ID (not OTHER_ID)
    mock_sb = _mock_supabase()
    setup_supabase_mock(mock_sb, {"support_cases": [case_row]})

    with patch.object(support_module, "supabase", mock_sb):
        with patch("routers.support.db_for_user", return_value=mock_sb):
            resp = client.get(
                f"/api/support/cases/{CASE_ID}",
                headers={"Authorization": "Bearer dummy-token"},
            )

    clear_overrides()
    assert resp.status_code == 404, resp.text


# ===========================================================================
# TEST 11 — Non-owner organizer cannot read event's case → 403/404
# ===========================================================================

def test_organizer_without_event_ownership_forbidden():
    """Organizer who doesn't own the event gets 403 when reading that event's case."""
    organizer = make_user(ROLE_ORGANIZER, user_id=ORGANIZER_ID)
    override_user(organizer)

    case_row = make_case({
        "requester_id": ATTENDEE_ID,  # not the organizer
        "event_id": EVENT_ID,
    })
    mock_sb = _mock_supabase()

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()
        for m in ("select", "insert", "update", "delete", "eq", "neq",
                  "or_", "order", "range"):
            getattr(tbl, m).return_value = tbl
        if name == "support_cases":
            tbl.execute.return_value = _make_execute_result([case_row])
        elif name == "events":
            # organizer_id mismatch → event NOT found under their ownership
            tbl.execute.return_value = _make_execute_result([])
        else:
            tbl.execute.return_value = _make_execute_result([])
        return tbl

    mock_sb.table.side_effect = _table

    with patch.object(support_module, "supabase", mock_sb):
        with patch("routers.support.db_for_user", return_value=mock_sb):
            resp = client.get(
                f"/api/support/cases/{CASE_ID}",
                headers={"Authorization": "Bearer dummy-token"},
            )

    clear_overrides()
    assert resp.status_code in (403, 404), resp.text


# ===========================================================================
# TEST 12 — Happy path: activate paid sales (all checklist items pass)
# ===========================================================================

def test_activate_paid_sales_happy_path():
    """All checklist items pass → event is activated, payment inserted, audit logged."""
    organizer = make_user(ROLE_ORGANIZER, user_id=ORGANIZER_ID, payout_info="KZ123456789")
    override_user(organizer)

    event_row = {
        "id": EVENT_ID,
        "organizer_id": ORGANIZER_ID,
        "paid_sales_status": "NONE",
        "paid_sales_active": False,
        "title": "My Conference",
    }
    activated_event = {**event_row, "paid_sales_status": "ACTIVE", "paid_sales_active": True}
    ticket_type_row = {"id": str(uuid.uuid4()), "price": 5000, "event_id": EVENT_ID}
    mock_sb = _mock_supabase()

    call_state: dict[str, int] = {"events": 0}

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()
        for m in ("select", "insert", "update", "delete", "eq", "neq",
                  "or_", "order", "range"):
            getattr(tbl, m).return_value = tbl
        if name == "events":
            call_state["events"] += 1
            if call_state["events"] == 1:
                tbl.execute.return_value = _make_execute_result([event_row])
            else:
                tbl.execute.return_value = _make_execute_result([activated_event])
        elif name == "ticket_types":
            tbl.execute.return_value = _make_execute_result([ticket_type_row])
        else:
            tbl.execute.return_value = _make_execute_result([])
        return tbl

    mock_sb.table.side_effect = _table

    with patch.object(organizer_module, "supabase", mock_sb):
        with patch("routers.organizer.db_for_user", return_value=mock_sb):
            resp = client.post(
                f"/api/organizer/events/{EVENT_ID}/activate-paid-sales",
                json={"paid_event_terms_accepted": True},
                headers={"Authorization": "Bearer dummy-token"},
            )

    clear_overrides()
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["paid_sales_status"] == "ACTIVE"
    assert data["paid_sales_active"] is True
    assert data["simulated"] is True
    assert data["activation_fee_kzt"] == 5000


# ===========================================================================
# TEST 13 — Incomplete checklist: missing payout_info → 422 with checklist
# ===========================================================================

def test_activate_paid_sales_missing_payout_info():
    """Organizer without non-empty payout_info gets 422 with detailed checklist."""
    organizer = make_user(ROLE_ORGANIZER, user_id=ORGANIZER_ID, payout_info="   ")
    override_user(organizer)

    event_row = {
        "id": EVENT_ID,
        "organizer_id": ORGANIZER_ID,
        "paid_sales_status": "NONE",
        "paid_sales_active": False,
    }
    ticket_type_row = {"id": str(uuid.uuid4()), "price": 2000, "event_id": EVENT_ID}
    mock_sb = _mock_supabase()

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()
        for m in ("select", "insert", "update", "delete", "eq", "neq",
                  "or_", "order", "range"):
            getattr(tbl, m).return_value = tbl
        if name == "events":
            tbl.execute.return_value = _make_execute_result([event_row])
        elif name == "ticket_types":
            tbl.execute.return_value = _make_execute_result([ticket_type_row])
        else:
            tbl.execute.return_value = _make_execute_result([])
        return tbl

    mock_sb.table.side_effect = _table

    with patch.object(organizer_module, "supabase", mock_sb):
        with patch("routers.organizer.db_for_user", return_value=mock_sb):
            resp = client.post(
                f"/api/organizer/events/{EVENT_ID}/activate-paid-sales",
                json={"paid_event_terms_accepted": True},
                headers={"Authorization": "Bearer dummy-token"},
            )

    clear_overrides()
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert "checklist" in detail
    assert detail["checklist"]["valid_payout_account"]["passed"] is False


# ===========================================================================
# TEST 14 — Double activation: already ACTIVE → idempotent 200
# ===========================================================================

def test_activate_paid_sales_idempotent():
    """Calling activate on an already-ACTIVE event returns 200 without side effects."""
    organizer = make_user(ROLE_ORGANIZER, user_id=ORGANIZER_ID, payout_info="KZ123456789")
    override_user(organizer)

    event_row = {
        "id": EVENT_ID,
        "organizer_id": ORGANIZER_ID,
        "paid_sales_status": "ACTIVE",
        "paid_sales_active": True,
    }
    mock_sb = _mock_supabase()

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()
        for m in ("select", "insert", "update", "delete", "eq", "neq",
                  "or_", "order", "range"):
            getattr(tbl, m).return_value = tbl
        if name == "events":
            tbl.execute.return_value = _make_execute_result([event_row])
        else:
            tbl.execute.return_value = _make_execute_result([])
        return tbl

    mock_sb.table.side_effect = _table

    with patch.object(organizer_module, "supabase", mock_sb):
        with patch("routers.organizer.db_for_user", return_value=mock_sb):
            resp = client.post(
                f"/api/organizer/events/{EVENT_ID}/activate-paid-sales",
                json={"paid_event_terms_accepted": True},
                headers={"Authorization": "Bearer dummy-token"},
            )

    clear_overrides()
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["status"] == "already_active"
    assert data["paid_sales_status"] == "ACTIVE"
    assert data["paid_sales_active"] is True


# ===========================================================================
# TEST 15 — Event admin cannot activate paid sales → 403 Forbidden
# ===========================================================================

def test_event_admin_cannot_activate_paid_sales():
    """event_admin (check-in staff only) has no activation rights → 403 Forbidden."""
    ea = make_user(ROLE_EVENT_ADMIN, user_id=EVENT_ADMIN_ID, payout_info="KZ123456789")
    override_user(ea)

    resp = client.post(
        f"/api/organizer/events/{EVENT_ID}/activate-paid-sales",
        json={"paid_event_terms_accepted": True},
        headers={"Authorization": "Bearer dummy-token"},
    )
    clear_overrides()
    assert resp.status_code == 403, resp.text


# ===========================================================================
# TEST 16 — Resolved case rejects new message with 409 Conflict
# ===========================================================================

def test_resolved_case_rejects_new_message():
    """Cannot append messages to a RESOLVED case; returns 409 Conflict."""
    user = make_user(ROLE_ATTENDEE)
    override_user(user)

    case_row = make_case({"status": "RESOLVED"})
    mock_sb = _mock_supabase()
    setup_supabase_mock(mock_sb, {"support_cases": [case_row]})

    with patch.object(support_module, "supabase", mock_sb):
        with patch("routers.support.db_for_user", return_value=mock_sb):
            resp = client.post(
                f"/api/support/cases/{CASE_ID}/messages",
                json={"body": "Trying to reopen"},
                headers={"Authorization": "Bearer dummy-token"},
            )

    clear_overrides()
    assert resp.status_code == 409, resp.text


# ===========================================================================
# TEST 17 — Suspended event returns 403 Forbidden
# ===========================================================================

def test_activate_suspended_event_forbidden():
    """Attempting to activate an event SUSPENDED by an admin returns 403."""
    organizer = make_user(ROLE_ORGANIZER, user_id=ORGANIZER_ID, payout_info="KZ123456789")
    override_user(organizer)

    event_row = {
        "id": EVENT_ID,
        "organizer_id": ORGANIZER_ID,
        "paid_sales_status": "SUSPENDED",
        "paid_sales_active": False,
    }
    mock_sb = _mock_supabase()
    setup_supabase_mock(mock_sb, {"events": [event_row]})

    with patch.object(organizer_module, "supabase", mock_sb):
        with patch("routers.organizer.db_for_user", return_value=mock_sb):
            resp = client.post(
                f"/api/organizer/events/{EVENT_ID}/activate-paid-sales",
                json={"paid_event_terms_accepted": True},
                headers={"Authorization": "Bearer dummy-token"},
            )

    clear_overrides()
    assert resp.status_code == 403, resp.text


# ===========================================================================
# TEST 18 — Paid checkout rejected when paid_sales_status != ACTIVE
# ===========================================================================

def test_paid_checkout_rejected_when_not_active():
    """Checkout for a paid ticket type fails if event paid_sales_status is not ACTIVE."""
    user = make_user(ROLE_ATTENDEE)
    override_user(user)

    event_row = {
        "id": EVENT_ID,
        "paid_sales_status": "NONE",
        "paid_sales_active": False,
    }
    ticket_type_row = {
        "id": "tt-1",
        "event_id": EVENT_ID,
        "price": 3000,
        "quantity": 10,
    }
    mock_sb = _mock_supabase()

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()
        for m in ("select", "insert", "update", "delete", "eq", "neq",
                  "or_", "order", "range"):
            getattr(tbl, m).return_value = tbl
        if name == "events":
            tbl.execute.return_value = _make_execute_result([event_row])
        elif name == "ticket_types":
            tbl.execute.return_value = _make_execute_result([ticket_type_row])
        elif name == "tickets":
            tbl.execute.return_value = _make_execute_result([])  # no existing registration
        else:
            tbl.execute.return_value = _make_execute_result([])
        return tbl

    mock_sb.table.side_effect = _table

    with patch("main.db_for_user", return_value=mock_sb):
        resp = client.post(
            f"/api/events/{EVENT_ID}/register",
            json={"ticket_type_id": "tt-1"},
            headers={"Authorization": "Bearer dummy-token"},
        )

    clear_overrides()
    assert resp.status_code in (400, 402, 403), resp.text
