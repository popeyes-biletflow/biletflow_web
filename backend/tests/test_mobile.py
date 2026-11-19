"""Tests for Mobile Event Admin API — routers/mobile.py & tickets undo-checkin."""
import os
import sys
import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_KEY", "dummy-key")

from crypto import generate_hmac_signature
from deps import get_current_user
from main import app
from schemas import (
    CurrentUser,
    ROLE_ATTENDEE,
    ROLE_EVENT_ADMIN,
    ROLE_ORGANIZER,
)

client = TestClient(app, raise_server_exceptions=True)

EVENT_ID = str(uuid.uuid4())
TICKET_ID = str(uuid.uuid4())
USER_ID = str(uuid.uuid4())
STAFF_ID = str(uuid.uuid4())


def make_user(role: str, user_id: str = STAFF_ID) -> CurrentUser:
    return CurrentUser(
        id=user_id,
        email=f"{role}@example.com",
        full_name=f"Test {role.title()}",
        role=role,
        access_token="fake-jwt-token",
    )


@pytest.fixture(autouse=True)
def reset_overrides():
    yield
    app.dependency_overrides.clear()


def test_mobile_events_requires_staff():
    """Attendees are rejected with 403 from mobile events."""
    app.dependency_overrides[get_current_user] = lambda: make_user(ROLE_ATTENDEE)
    res = client.get("/api/mobile/events")
    assert res.status_code == 403
    assert "Event staff access is required" in res.json()["detail"]


def test_mobile_events_success_for_staff():
    """Event admins can fetch events formatted for mobile."""
    app.dependency_overrides[get_current_user] = lambda: make_user(ROLE_EVENT_ADMIN)

    mock_db = MagicMock()
    mock_db.table.return_value.select.return_value.execute.return_value = MagicMock(
        data=[
            {
                "id": EVENT_ID,
                "title": "Astana Tech Fest",
                "venue_name": "EXPO Congress Center",
                "starts_at": "2026-12-01T10:00:00+00:00",
            }
        ]
    )

    with patch("routers.mobile.db_for_user", return_value=mock_db):
        res = client.get("/api/mobile/events")
        assert res.status_code == 200
        data = res.json()
        assert "events" in data
        assert len(data["events"]) == 1
        assert data["events"][0]["id"] == EVENT_ID
        assert data["events"][0]["name"] == "Astana Tech Fest"
        assert data["events"][0]["venue"] == "EXPO Congress Center"


def test_mobile_attendance():
    """Returns correct counts of checked-in vs total valid tickets."""
    app.dependency_overrides[get_current_user] = lambda: make_user(ROLE_EVENT_ADMIN)

    mock_db = MagicMock()
    mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[
            {"id": "t1", "status": "valid"},
            {"id": "t2", "status": "checked_in"},
            {"id": "t3", "status": "refunded"},  # excluded from total
        ]
    )

    with patch("routers.mobile.db_for_user", return_value=mock_db):
        res = client.get(f"/api/mobile/events/{EVENT_ID}/attendance")
        assert res.status_code == 200
        data = res.json()
        assert data["total"] == 2
        assert data["checkedIn"] == 1
        assert data["canUndoCheckIn"] is True


def test_mobile_attendees_search():
    """Returns list of attendees matching search query."""
    app.dependency_overrides[get_current_user] = lambda: make_user(ROLE_EVENT_ADMIN)

    mock_db = MagicMock()
    mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[
            {"id": "t1", "status": "valid", "user_id": "u1", "event_id": EVENT_ID},
            {"id": "t2", "status": "checked_in", "user_id": "u2", "event_id": EVENT_ID},
        ]
    )

    mock_supabase = MagicMock()
    mock_supabase.table.return_value.select.return_value.in_.return_value.execute.return_value = MagicMock(
        data=[
            {"id": "u1", "full_name": "Arman K", "email": "arman@example.com"},
            {"id": "u2", "full_name": "Dana S", "email": "dana@example.com"},
        ]
    )

    with patch("routers.mobile.db_for_user", return_value=mock_db), \
         patch("routers.mobile.supabase", mock_supabase):
        res = client.get(f"/api/mobile/events/{EVENT_ID}/attendees?search=arman")
        assert res.status_code == 200
        data = res.json()
        assert len(data["attendees"]) == 1
        assert data["attendees"][0]["name"] == "Arman K"
        assert data["attendees"][0]["checkedIn"] is False


def test_mobile_validate_ticket_success():
    """Valid signed QR payload marks ticket as checked_in."""
    app.dependency_overrides[get_current_user] = lambda: make_user(ROLE_EVENT_ADMIN)

    expires_at = 9999999999
    signature = generate_hmac_signature(TICKET_ID, EVENT_ID, USER_ID, expires_at)
    qr_payload = f"{TICKET_ID}:{EVENT_ID}:{USER_ID}:{expires_at}:{signature}"

    mock_db = MagicMock()
    mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"id": TICKET_ID, "event_id": EVENT_ID, "status": "valid"}]
    )

    mock_supabase = MagicMock()
    mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()

    with patch("routers.mobile.db_for_user", return_value=mock_db), \
         patch("routers.mobile.supabase", mock_supabase):
        res = client.post(
            f"/api/mobile/events/{EVENT_ID}/tickets/validate",
            json={"qrPayload": qr_payload},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["valid"] is True
        assert data["ticketId"] == TICKET_ID
        assert "Check-in successful" in data["message"]


def test_mobile_validate_duplicate_rejected():
    """Already used ticket returns 409 conflict."""
    app.dependency_overrides[get_current_user] = lambda: make_user(ROLE_EVENT_ADMIN)

    expires_at = 9999999999
    signature = generate_hmac_signature(TICKET_ID, EVENT_ID, USER_ID, expires_at)
    qr_payload = f"{TICKET_ID}:{EVENT_ID}:{USER_ID}:{expires_at}:{signature}"

    mock_db = MagicMock()
    mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"id": TICKET_ID, "event_id": EVENT_ID, "status": "checked_in"}]
    )

    with patch("routers.mobile.db_for_user", return_value=mock_db):
        res = client.post(
            f"/api/mobile/events/{EVENT_ID}/tickets/validate",
            json={"qrPayload": qr_payload},
        )
        assert res.status_code == 409
        assert "Ticket has already been used" in res.json()["detail"]


def test_mobile_validate_foreign_event_rejected():
    """QR for a different event is rejected with 400."""
    app.dependency_overrides[get_current_user] = lambda: make_user(ROLE_EVENT_ADMIN)

    other_event_id = str(uuid.uuid4())
    expires_at = 9999999999
    signature = generate_hmac_signature(TICKET_ID, other_event_id, USER_ID, expires_at)
    qr_payload = f"{TICKET_ID}:{other_event_id}:{USER_ID}:{expires_at}:{signature}"

    res = client.post(
        f"/api/mobile/events/{EVENT_ID}/tickets/validate",
        json={"qrPayload": qr_payload},
    )
    assert res.status_code == 400
    assert "different event" in res.json()["detail"]


def test_undo_checkin_success():
    """Reverts checked_in ticket back to valid."""
    app.dependency_overrides[get_current_user] = lambda: make_user(ROLE_EVENT_ADMIN)

    mock_supabase = MagicMock()
    mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"id": TICKET_ID, "event_id": EVENT_ID, "status": "checked_in"}]
    )
    mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()

    with patch("routers.tickets.supabase", mock_supabase):
        res = client.post(
            "/api/tickets/undo-checkin",
            json={"eventId": EVENT_ID, "ticketId": TICKET_ID},
        )
        assert res.status_code == 200
        assert res.json()["success"] is True
