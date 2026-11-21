"""FS-20: notifications and ticket delivery through a real (local) SMTP server.

aiosmtpd plays the test mailbox, so these tests check what an attendee would actually receive.
"""
import os

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_KEY", "dummy-key")
os.environ.setdefault("QR_SECRET", "test-secret")

import email
import socket
import uuid
from datetime import datetime, timedelta, timezone
from email import policy
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import notify
from main import app
from deps import get_current_user
from schemas import CurrentUser
from tests.fakedb import FakeDB
from tests.test_fs17_checkout import finalize

aiosmtpd = pytest.importorskip("aiosmtpd.controller")

client = TestClient(app)

BUYER = "11111111-1111-1111-1111-111111111111"
ORGANIZER = "99999999-9999-9999-9999-999999999999"
EVENT = "33333333-3333-3333-3333-333333333333"
TYPE = "44444444-4444-4444-4444-444444444444"
SOON = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()


class Mailbox:
    def __init__(self):
        self.messages = []

    async def handle_DATA(self, server, session, envelope):
        self.messages.append(email.message_from_bytes(envelope.content, policy=policy.default))
        return "250 OK"

    def bodies(self):
        return [m.get_body(("plain",)).get_content() for m in self.messages]


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Server:
    """SMTP test server that can go down and come back on the same port."""

    def __init__(self, box):
        self.box, self.port, self.ctl = box, free_port(), None

    def start(self):
        self.ctl = aiosmtpd.Controller(self.box, hostname="127.0.0.1", port=self.port)
        self.ctl.start()

    def stop(self):
        if self.ctl:
            self.ctl.stop()
            self.ctl = None


@pytest.fixture
def mailbox(monkeypatch):
    box = Mailbox()
    server = Server(box)
    server.start()
    monkeypatch.setattr(notify, "SMTP_HOST", "127.0.0.1")
    monkeypatch.setattr(notify, "SMTP_PORT", server.port)
    monkeypatch.setattr(notify, "EMAIL_ENABLED", True)
    monkeypatch.setattr(notify, "PREVIEW_DIR", "")
    yield box, server
    server.stop()


@pytest.fixture(autouse=True)
def as_buyer():
    user = CurrentUser(id=BUYER, email="buyer@example.com", full_name="Demo Buyer", role="attendee", access_token="t")
    app.dependency_overrides[get_current_user] = lambda: user
    yield
    app.dependency_overrides.clear()


def shop(total=12600, quantity=2):
    db = FakeDB(
        unique={"email_outbox": "dedupe_key", "notifications": "dedupe_key"},
        ticket_holds=[{
            "id": "hold-1", "user_id": BUYER, "event_id": EVENT, "ticket_type_id": TYPE, "quantity": quantity,
            "status": "active", "subtotal_kzt": total, "discount_kzt": 0, "fee_kzt": 0, "total_kzt": total,
            "expires_at": SOON,
        }],
        events=[{"id": EVENT, "title": "Demo Fest", "status": "published", "starts_at": SOON, "ends_at": SOON,
                 "timezone": "Asia/Almaty", "venue_name": "Astana Arena", "organizer_id": ORGANIZER}],
        ticket_types=[{"id": TYPE, "name": "Standard", "price": total}],
        orders=[], tickets=[], promo_codes=[], support_cases=[], notifications=[], email_outbox=[],
        profiles=[{"id": BUYER, "email": "buyer@example.com"}, {"id": ORGANIZER, "email": "org@example.com"}],
    )
    db.rpcs["finalize_order"] = finalize(db)
    return db


def buy(db, **body):
    with patch("orders.db_for_user", return_value=db), patch.object(notify, "db", db):
        return client.post("/api/orders", json={"hold_id": "hold-1", **body}, headers={"Accept-Language": "en"})


def test_paid_purchase_sends_one_confirmation_with_ticket_links(mailbox):
    box, _ = mailbox
    db = shop()
    r = buy(db, attendees=[{"name": "Buyer"}, {"name": "Friend"}])
    assert r.status_code == 201
    assert len(box.messages) == 1
    msg = box.messages[0]
    assert msg["To"] == "buyer@example.com"
    assert msg["Subject"].startswith("Order paid")
    body = box.bodies()[0]
    for t in r.json()["tickets"]:
        assert f"/tickets/{t['ticket_id']}" in body
    assert "demo payment" in body
    # in-app notice with a link to the order
    assert [n["type"] for n in db.tables["notifications"]] == ["PURCHASE_CONFIRMED"]
    assert db.tables["notifications"][0]["data"]["url"] == f"/orders/{r.json()['order_id']}"


def test_free_registration_sends_registration_email(mailbox):
    box, _ = mailbox
    r = buy(shop(total=0, quantity=1))
    assert r.status_code == 201
    assert len(box.messages) == 1
    assert box.messages[0]["Subject"].startswith("You are registered")
    assert f"/tickets/{r.json()['tickets'][0]['ticket_id']}" in box.bodies()[0]


def test_retry_does_not_send_a_second_email(mailbox):
    box, _ = mailbox
    db = shop()
    first = buy(db).json()
    again = buy(db).json()  # double click / network retry
    assert again["order_id"] == first["order_id"]
    assert len(box.messages) == 1
    assert len(db.tables["email_outbox"]) == 1
    assert len(db.tables["notifications"]) == 1


def test_attendee_with_own_email_gets_their_ticket(mailbox):
    box, _ = mailbox
    buy(shop(), attendees=[{"name": "Buyer"}, {"name": "Friend", "email": "friend@example.com"}])
    to = sorted(m["To"] for m in box.messages)
    assert to == ["buyer@example.com", "friend@example.com"]


def test_smtp_outage_keeps_the_order_and_retry_delivers_once(mailbox):
    box, ctl = mailbox
    ctl.stop()  # transient failure: mail server is down
    db = shop()
    r = buy(db)
    assert r.status_code == 201  # ticket issued anyway
    assert len(db.tables["tickets"]) == 2
    row = db.tables["email_outbox"][0]
    assert row["status"] == "failed" and row["attempts"] == 1

    ctl.start()
    with patch.object(notify, "db", db):
        stats = notify.retry_pending()
        again = notify.retry_pending()
    assert stats["sent"] == 1
    assert again == {"sent": 0, "failed": 0, "skipped": 0}
    assert len(box.messages) == 1
    assert db.tables["email_outbox"][0]["status"] == "sent"
    assert len(db.tables["orders"]) == 1  # nothing was rolled back or duplicated


def test_declined_payment_notifies_buyer(mailbox):
    box, _ = mailbox
    db = shop()
    assert buy(db, payment_outcome="declined").status_code == 402
    assert len(box.messages) == 1
    assert box.messages[0]["Subject"].startswith("Payment failed")
    assert db.tables["orders"] == []


def test_support_reply_reaches_the_attendee_by_email(mailbox):
    box, _ = mailbox
    db = shop()
    db.tables["support_cases"].append({"id": "case-1", "requester_id": BUYER, "event_id": EVENT,
                                       "category": "refund", "subject": "Refund", "status": "OPEN"})
    db.tables["support_messages"] = []
    db.tables["audit_log"] = []
    org = CurrentUser(id=ORGANIZER, email="org@example.com", role="organizer", access_token="t")
    app.dependency_overrides[get_current_user] = lambda: org
    with patch("routers.support.db_for_user", lambda _t: db), patch("routers.support.supabase", db), \
         patch.object(notify, "db", db):
        r = client.post("/api/support/cases/case-1/messages", json={"body": "Refund approved."})
    assert r.status_code == 201
    assert [m["To"] for m in box.messages] == ["buyer@example.com"]
    assert "Refund approved." in box.bodies()[0]
    assert "/support/case-1" in box.bodies()[0]


def test_event_cancellation_reaches_each_holder_once(mailbox):
    box, _ = mailbox
    db = shop()
    buy(db)  # buyer holds 2 tickets
    box.messages.clear()
    with patch.object(notify, "db", db):
        n1 = notify.notify_event_holders(db, db.tables["events"][0], "EVENT_CANCELLED", "cancelled")
        n2 = notify.notify_event_holders(db, db.tables["events"][0], "EVENT_CANCELLED", "cancelled")
    assert (n1, n2) == (1, 1)
    assert len(box.messages) == 1  # second run is deduplicated


@pytest.mark.parametrize("lang", ["kk", "ru", "en"])
def test_every_template_renders(lang, tmp_path):
    files = notify.write_previews(str(tmp_path))
    assert len(files) == len(notify.TEMPLATES) * 3
    for tpl in notify.TEMPLATES:
        subject, text, page = notify.render(tpl, {"event_title": "X", "url": "http://x/y"}, lang)
        assert subject and text and page.startswith("<!doctype html>")
