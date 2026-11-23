"""FS-19: organizer -> platform escalation and access to copied case links."""
import os

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_KEY", "dummy-key")
os.environ.setdefault("QR_SECRET", "test-secret")

from contextlib import contextmanager
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import app
from deps import get_current_user
from schemas import CurrentUser
from tests.fakedb import FakeDB

client = TestClient(app)

ATTENDEE = "aaaaaaaa-0000-0000-0000-000000000001"
STRANGER = "aaaaaaaa-0000-0000-0000-000000000002"
ORGANIZER = "bbbbbbbb-0000-0000-0000-000000000001"
OTHER_ORG = "bbbbbbbb-0000-0000-0000-000000000002"
ADMIN = "cccccccc-0000-0000-0000-000000000001"
EVENT = "dddddddd-0000-0000-0000-000000000001"


def make_db():
    return FakeDB(
        profiles=[
            {"id": ATTENDEE, "role": "attendee"}, {"id": STRANGER, "role": "attendee"},
            {"id": ORGANIZER, "role": "organizer"}, {"id": OTHER_ORG, "role": "organizer"},
            {"id": ADMIN, "role": "platform_admin"},
        ],
        events=[{"id": EVENT, "organizer_id": ORGANIZER, "title": "Demo"}],
        support_cases=[{"id": "case-1", "requester_id": ATTENDEE, "event_id": EVENT, "category": "refund",
                        "subject": "Refund please", "status": "OPEN", "created_at": "2026-11-20T10:00:00"}],
        support_messages=[{"id": "m1", "case_id": "case-1", "sender_id": ATTENDEE, "body": "hi", "created_at": "1"}],
        notifications=[], audit_log=[], tickets=[], orders=[],
    )


@contextmanager
def as_user(user_id, role, db):
    user = CurrentUser(id=user_id, email=f"{role}@example.com", role=role, access_token="t")
    app.dependency_overrides[get_current_user] = lambda: user
    with patch("routers.support.db_for_user", lambda _t: db), patch("routers.support.supabase", db), \
         patch("routers.support_escalation.db_for_user", lambda _t: db), patch("routers.support_escalation.supabase", db):
        try:
            yield
        finally:
            app.dependency_overrides.clear()


def test_organizer_escalates_attendee_case():
    db = make_db()
    with as_user(ORGANIZER, "organizer", db):
        r = client.post("/api/support/cases/case-1/escalate", json={"note": "Payment provider issue"})
    assert r.status_code == 201
    new_case = r.json()["escalation_case"]
    assert new_case["requester_id"] == ORGANIZER
    assert new_case["event_id"] == EVENT
    assert new_case["category"] == "technical"  # refund is not a platform category
    bodies = [m["body"] for m in db.tables["support_messages"] if m["case_id"] == "case-1"]
    assert any(new_case["id"] in b for b in bodies)
    # the platform admin gets a notification about it
    assert any(n["user_id"] == ADMIN and n["type"] == "SUPPORT_CASE_ESCALATED" for n in db.tables["notifications"])


def test_attendee_cannot_escalate():
    with as_user(ATTENDEE, "attendee", make_db()):
        r = client.post("/api/support/cases/case-1/escalate", json={})
    assert r.status_code == 403


def test_other_organizer_cannot_escalate_or_read():
    db = make_db()
    with as_user(OTHER_ORG, "organizer", db):
        assert client.post("/api/support/cases/case-1/escalate", json={}).status_code == 403
        assert client.get("/api/support/cases/case-1").status_code == 403


def test_copied_case_link_is_hidden_from_other_attendees():
    with as_user(STRANGER, "attendee", make_db()):
        r = client.get("/api/support/cases/case-1")
    assert r.status_code == 404


def test_owner_organizer_can_reply_and_attendee_is_notified():
    db = make_db()
    with as_user(ORGANIZER, "organizer", db):
        r = client.post("/api/support/cases/case-1/messages", json={"body": "We will refund you."})
    assert r.status_code == 201
    assert any(n["user_id"] == ATTENDEE and n["type"] == "SUPPORT_REPLY_RECEIVED" for n in db.tables["notifications"])
