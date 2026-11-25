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

os.environ.setdefault("QR_SECRET", "mobile-test-secret")
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_KEY", "dummy-key")

from crypto import generate_hmac_signature
from tests import checkin_fake
from tests.fakedb import FakeDB
from deps import get_current_user
from main import app
from schemas import (
    CurrentUser,
    ROLE_ATTENDEE,
    ROLE_EVENT_ADMIN,
    ROLE_ORGANIZER,
    ROLE_PLATFORM_ADMIN,
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


OTHER_STAFF_ID = str(uuid.uuid4())
ORGANIZER_ID = str(uuid.uuid4())


def make_db(ticket_status="valid", can_undo=True, assigned=True, extra_tickets=()):
    staff = [{"event_id": EVENT_ID, "user_id": STAFF_ID, "can_undo": can_undo}] if assigned else []
    db = FakeDB(
        events=[{
            "id": EVENT_ID, "organizer_id": ORGANIZER_ID, "title": "Astana Tech Fest",
            "venue_name": "EXPO Congress Center", "starts_at": "2026-12-01T10:00:00+00:00",
        }],
        tickets=[
            {"id": TICKET_ID, "event_id": EVENT_ID, "user_id": USER_ID, "status": ticket_status},
            *extra_tickets,
        ],
        event_staff=staff,
        profiles=[
            {"id": USER_ID, "full_name": "Arman K", "email": "arman@example.com"},
        ],
        audit_log=[],
    )
    db.rpc = lambda name, params: checkin_fake.call(db.tables, name, params)
    return db


def use_db(db):
    return (
        patch("routers.mobile.db_for_user", return_value=db),
        patch("routers.mobile.supabase", db),
        patch("routers.tickets.db_for_user", return_value=db),
        patch("routers.tickets.supabase", db),
    )


class _Patched:
    def __init__(self, db):
        self.patches = use_db(db)

    def __enter__(self):
        for p in self.patches:
            p.start()

    def __exit__(self, *_):
        for p in self.patches:
            p.stop()


def signed_qr(ticket_id=TICKET_ID, event_id=EVENT_ID):
    expires_at = 9999999999
    sig = generate_hmac_signature(ticket_id, event_id, USER_ID, expires_at)
    return f"{ticket_id}:{event_id}:{USER_ID}:{expires_at}:{sig}"


def validate(qr, event_id=EVENT_ID):
    return client.post(f"/api/mobile/events/{event_id}/tickets/validate", json={"qrPayload": qr})


def as_staff(role=ROLE_EVENT_ADMIN, user_id=STAFF_ID):
    app.dependency_overrides[get_current_user] = lambda: make_user(role, user_id)


# Event list and roster
def test_mobile_events_success_for_staff():
    """An event admin sees the events they are assigned to."""
    as_staff()
    with _Patched(make_db()):
        res = client.get("/api/mobile/events")
    assert res.status_code == 200
    events = res.json()["events"]
    assert [e["id"] for e in events] == [EVENT_ID]
    assert events[0]["name"] == "Astana Tech Fest"
    assert events[0]["venue"] == "EXPO Congress Center"


def test_mobile_events_empty_for_unassigned_staff():
    """An event admin with no assignment sees no events (no fallback to every event)."""
    as_staff()
    with _Patched(make_db(assigned=False)):
        res = client.get("/api/mobile/events")
    assert res.status_code == 200
    assert res.json()["events"] == []


def test_mobile_unassigned_staff_cannot_use_event():
    """Roster, counters, validate and manual check-in are all refused for an unassigned event admin."""
    as_staff()
    with _Patched(make_db(assigned=False)):
        assert client.get(f"/api/mobile/events/{EVENT_ID}/attendance").status_code == 403
        assert client.get(f"/api/mobile/events/{EVENT_ID}/attendees").status_code == 403
        assert validate(signed_qr()).status_code == 403
        res = client.post(f"/api/mobile/events/{EVENT_ID}/tickets/check-in", json={"ticketId": TICKET_ID})
        assert res.status_code == 403


def test_mobile_attendance():
    """Returns counts of checked-in vs total valid tickets; refunded tickets are excluded."""
    as_staff()
    extra = (
        {"id": "t2", "event_id": EVENT_ID, "user_id": "u2", "status": "checked_in"},
        {"id": "t3", "event_id": EVENT_ID, "user_id": "u3", "status": "refunded"},
    )
    with _Patched(make_db(extra_tickets=extra)):
        res = client.get(f"/api/mobile/events/{EVENT_ID}/attendance")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 2
    assert data["checkedIn"] == 1
    assert data["canUndoCheckIn"] is True


def test_mobile_attendance_reports_undo_permission_per_assignment():
    """canUndoCheckIn follows the assignment: false for staff without it, true for the organizer."""
    as_staff()
    with _Patched(make_db(can_undo=False)):
        assert client.get(f"/api/mobile/events/{EVENT_ID}/attendance").json()["canUndoCheckIn"] is False
    as_staff(ROLE_ORGANIZER, ORGANIZER_ID)
    with _Patched(make_db(can_undo=False)):
        assert client.get(f"/api/mobile/events/{EVENT_ID}/attendance").json()["canUndoCheckIn"] is True


def test_mobile_attendees_search():
    """Returns attendees matching the search query."""
    as_staff()
    extra = ({"id": "t2", "event_id": EVENT_ID, "user_id": "u2", "status": "checked_in"},)
    db = make_db(extra_tickets=extra)
    db.tables["profiles"].append({"id": "u2", "full_name": "Dana S", "email": "dana@example.com"})
    with _Patched(db):
        res = client.get(f"/api/mobile/events/{EVENT_ID}/attendees?search=arman")
    assert res.status_code == 200
    data = res.json()
    assert len(data["attendees"]) == 1
    assert data["attendees"][0]["name"] == "Arman K"
    assert data["attendees"][0]["checkedIn"] is False


# QR validation (atomic admission)
def test_mobile_validate_ticket_success():
    """A valid signed QR admits the ticket once and records the audit entry."""
    as_staff()
    db = make_db()
    with _Patched(db):
        res = validate(signed_qr())
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is True
    assert data["ticketId"] == TICKET_ID
    assert "Check-in successful" in data["message"]
    assert db.tables["tickets"][0]["status"] == "checked_in"
    assert [a["action"] for a in db.tables["audit_log"]] == ["TICKET_CHECKIN"]


def test_mobile_validate_duplicate_rejected():
    """A second scan of the same ticket returns 409 and creates no second admission."""
    as_staff()
    db = make_db()
    with _Patched(db):
        assert validate(signed_qr()).status_code == 200
        res = validate(signed_qr())
    assert res.status_code == 409
    assert "Ticket has already been used" in res.json()["detail"]
    assert len([a for a in db.tables["audit_log"] if a["action"] == "TICKET_CHECKIN"]) == 1


def test_mobile_validate_foreign_event_rejected():
    """A QR for a different event is rejected with 400 before any database call."""
    as_staff()
    other_event_id = str(uuid.uuid4())
    db = make_db()
    with _Patched(db):
        res = validate(signed_qr(event_id=other_event_id))
    assert res.status_code == 400
    assert "different event" in res.json()["detail"]
    assert db.tables["tickets"][0]["status"] == "valid"


def test_mobile_validate_refunded_or_cancelled_rejected():
    for status_value in ("refunded", "cancelled"):
        as_staff()
        db = make_db(ticket_status=status_value)
        with _Patched(db):
            res = validate(signed_qr())
        assert res.status_code == 400, status_value
        assert db.tables["tickets"][0]["status"] == status_value


def test_mobile_validate_database_error_is_not_admission():
    """If the check-in function is unreachable the scan fails and nothing is admitted."""
    as_staff()
    db = make_db()

    def broken(name, params):
        raise RuntimeError("connection reset")

    db.rpc = broken
    with _Patched(db):
        res = validate(signed_qr())
    assert res.status_code == 500
    assert db.tables["tickets"][0]["status"] == "valid"


# Manual check-in
def manual(ticket_id=TICKET_ID, event_id=EVENT_ID):
    return client.post(f"/api/mobile/events/{event_id}/tickets/check-in", json={"ticketId": ticket_id})


def test_manual_check_in_and_duplicate():
    as_staff()
    db = make_db()
    with _Patched(db):
        assert manual().status_code == 200
        assert db.tables["tickets"][0]["status"] == "checked_in"
        assert manual().status_code == 409


def test_manual_check_in_blocks_refunded_and_cancelled():
    for status_value in ("refunded", "cancelled"):
        as_staff()
        db = make_db(ticket_status=status_value)
        with _Patched(db):
            res = manual()
        assert res.status_code == 400, status_value
        assert "cancelled or refunded" in res.json()["detail"]
        assert db.tables["tickets"][0]["status"] == status_value


def test_manual_check_in_unknown_or_foreign_ticket_is_404():
    as_staff()
    other_ticket = {"id": "t-other", "event_id": str(uuid.uuid4()), "user_id": "u9", "status": "valid"}
    db = make_db(extra_tickets=(other_ticket,))
    with _Patched(db):
        assert manual("missing").status_code == 404
        assert manual("t-other").status_code == 404
    assert other_ticket["status"] == "valid"


# Undo
def undo(ticket_id=TICKET_ID, event_id=EVENT_ID):
    return client.post("/api/tickets/undo-checkin", json={"eventId": event_id, "ticketId": ticket_id})


def test_undo_checkin_success():
    """Staff with the undo permission revert a checked-in ticket to valid."""
    as_staff()
    db = make_db(ticket_status="checked_in")
    with _Patched(db):
        res = undo()
    assert res.status_code == 200
    assert res.json()["success"] is True
    assert db.tables["tickets"][0]["status"] == "valid"
    assert [a["action"] for a in db.tables["audit_log"]] == ["TICKET_CHECKIN_REVERSED"]


def test_undo_requires_assignment_permission():
    """Staff assigned without can_undo cannot reverse a check-in; the ticket stays checked in."""
    as_staff()
    db = make_db(ticket_status="checked_in", can_undo=False)
    with _Patched(db):
        res = undo()
    assert res.status_code == 403
    assert db.tables["tickets"][0]["status"] == "checked_in"


def test_undo_organizer_and_admin_always_allowed():
    for role, uid in ((ROLE_ORGANIZER, ORGANIZER_ID), (ROLE_PLATFORM_ADMIN, str(uuid.uuid4()))):
        as_staff(role, uid)
        db = make_db(ticket_status="checked_in", can_undo=False)
        db.tables["profiles"].append({"id": uid, "role": role})
        with _Patched(db):
            assert undo().status_code == 200, role


def test_undo_unassigned_staff_forbidden():
    as_staff()
    db = make_db(ticket_status="checked_in", assigned=False)
    with _Patched(db):
        assert undo().status_code == 403
    assert db.tables["tickets"][0]["status"] == "checked_in"


def test_undo_ticket_not_checked_in():
    as_staff()
    with _Patched(make_db(ticket_status="valid")):
        res = undo()
    assert res.status_code == 400
    assert "not checked in" in res.json()["detail"]


# Staff assignment records the undo permission
def test_assigning_staff_records_undo_permission():
    from routers import organizer

    db = FakeDB(
        events=[{"id": EVENT_ID, "organizer_id": ORGANIZER_ID}],
        profiles=[{"id": OTHER_STAFF_ID, "email": "door@example.com", "full_name": "Door Staff", "role": "event_admin"}],
        event_staff=[],
        audit_log=[],
    )
    as_staff(ROLE_ORGANIZER, ORGANIZER_ID)
    with patch.object(organizer, "db_for_user", lambda _t: db), patch.object(organizer, "supabase", db):
        res = client.post(
            f"/api/organizer/events/{EVENT_ID}/staff",
            json={"email": "door@example.com", "can_undo": False},
        )
    assert res.status_code in (200, 201), res.text
    assert res.json()["can_undo"] is False
    assert db.tables["event_staff"][0]["can_undo"] is False


def test_attendee_list_excludes_refunded_and_cancelled():
    """The roster matches the counter: refunded and cancelled tickets are not listed."""
    as_staff()
    extra = (
        {"id": "t-ref", "event_id": EVENT_ID, "user_id": "u2", "status": "refunded"},
        {"id": "t-can", "event_id": EVENT_ID, "user_id": "u3", "status": "cancelled"},
        {"id": "t-in", "event_id": EVENT_ID, "user_id": "u4", "status": "checked_in"},
    )
    with _Patched(make_db(extra_tickets=extra)):
        listed = client.get(f"/api/mobile/events/{EVENT_ID}/attendees").json()["attendees"]
        counted = client.get(f"/api/mobile/events/{EVENT_ID}/attendance").json()
    assert sorted(a["ticketId"] for a in listed) == sorted([TICKET_ID, "t-in"])
    assert len(listed) == counted["total"]
