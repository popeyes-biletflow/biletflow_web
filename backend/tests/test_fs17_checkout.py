"""FS-17: checkout through holds — free registration, demo payment outcomes, idempotent confirmation."""
import os

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_KEY", "dummy-key")
os.environ.setdefault("QR_SECRET", "test-secret")

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from main import app
from deps import get_current_user
from schemas import CurrentUser
from crypto import verify_hmac_signature
from tests.fakedb import FakeDB

client = TestClient(app)

USER = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"
EVENT = "33333333-3333-3333-3333-333333333333"
TYPE = "44444444-4444-4444-4444-444444444444"
HOLD = "55555555-5555-5555-5555-555555555555"
SOON = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()


@pytest.fixture(autouse=True)
def as_attendee():
    user = CurrentUser(id=USER, email="demo@example.com", full_name="Demo Attendee", role="attendee", access_token="t")
    app.dependency_overrides[get_current_user] = lambda: user
    yield
    app.dependency_overrides.clear()


def finalize(db):
    """Python copy of the finalize_order RPC (009_fs17_checkout.sql) for the fake DB."""
    def run(p):
        hold = next(h for h in db.tables["ticket_holds"] if h["id"] == p["p_hold_id"])
        if hold["status"] == "converted":
            return next(o["id"] for o in db.tables["orders"] if o["hold_id"] == hold["id"])
        order_id = str(uuid.uuid4())
        db.tables["orders"].append({
            "id": order_id, "user_id": hold["user_id"], "event_id": hold["event_id"], "hold_id": hold["id"],
            "ticket_type_id": hold["ticket_type_id"], "quantity": hold["quantity"],
            "subtotal_kzt": hold["subtotal_kzt"], "discount_kzt": hold["discount_kzt"], "fee_kzt": hold["fee_kzt"],
            "total_amount": hold["total_kzt"], "status": "completed" if hold["total_kzt"] == 0 else "paid",
            "currency": p["p_currency"], "created_at": "2026-11-20T10:00:00+00:00",
        })
        for t in p["p_tickets"]:
            db.tables["tickets"].append({
                "id": t["id"], "order_id": order_id, "event_id": hold["event_id"], "user_id": hold["user_id"],
                "ticket_type_id": hold["ticket_type_id"], "status": "valid", "qr_code_hash": t["qr_code_hash"],
                "attendee_name": t["attendee_name"], "attendee_email": t["attendee_email"],
            })
        hold["status"] = "converted"
        return order_id
    return run


def make_db(total=12600, quantity=2, status="active"):
    db = FakeDB(
        ticket_holds=[{
            "id": HOLD, "user_id": USER, "event_id": EVENT, "ticket_type_id": TYPE, "quantity": quantity,
            "status": status, "subtotal_kzt": total, "discount_kzt": 0, "fee_kzt": 0, "total_kzt": total,
        }],
        events=[{"id": EVENT, "title": "Demo Fest", "status": "published", "starts_at": SOON, "ends_at": SOON}],
        ticket_types=[{"id": TYPE, "name": "Standard", "price": total // max(quantity, 1)}],
        orders=[], tickets=[], promo_codes=[], support_cases=[],
    )
    db.rpcs["finalize_order"] = finalize(db)
    db.rpcs["release_ticket_hold"] = lambda p: True
    return db


def post_order(db, **body):
    with patch("orders.db_for_user", return_value=db):
        return client.post("/api/orders", json={"hold_id": HOLD, **body})


def test_free_registration_needs_no_payment():
    db = make_db(total=0, quantity=1)
    r = post_order(db)
    assert r.status_code == 201
    data = r.json()
    assert data["status"] == "completed"
    assert data["payment"]["status"] == "free"
    assert len(data["tickets"]) == 1
    assert db.tables["orders"][0]["status"] == "completed"


def test_paid_order_issues_tickets_with_attendee_names():
    db = make_db()
    r = post_order(db, attendees=[{"name": "Aigerim", "email": "a@example.com"}, {"name": ""}])
    assert r.status_code == 201
    tickets = r.json()["tickets"]
    assert len(tickets) == 2
    names = sorted(t["attendee_name"] for t in tickets)
    assert names == ["Aigerim", "Demo Attendee"]  # empty name falls back to the buyer
    for t in tickets:
        ok, reason, parsed = verify_hmac_signature(t["qr_payload"])
        assert ok, reason
        assert parsed["ticket_id"] == t["ticket_id"]


def test_double_submit_returns_the_same_order():
    db = make_db()
    first = post_order(db).json()
    second = post_order(db)  # hold is converted now
    assert second.status_code == 201
    assert second.json()["replayed"] is True
    assert second.json()["order_id"] == first["order_id"]
    assert {t["ticket_id"] for t in second.json()["tickets"]} == {t["ticket_id"] for t in first["tickets"]}
    assert len(db.tables["orders"]) == 1
    assert len(db.tables["tickets"]) == 2


def test_declined_payment_keeps_hold_and_creates_nothing():
    db = make_db()
    r = post_order(db, payment_outcome="declined")
    assert r.status_code == 402
    assert r.json()["detail"]["code"] == "PAYMENT_DECLINED"
    assert db.tables["orders"] == []
    assert db.tables["ticket_holds"][0]["status"] == "active"
    # retry with an approved outcome works on the same hold
    assert post_order(db).status_code == 201


def test_card_number_is_not_accepted_as_input():
    db = make_db()
    r = post_order(db, card_number="4000000000000002")  # ignored, explicit outcome decides
    assert r.status_code == 201


def test_released_hold_cannot_be_paid():
    r = post_order(make_db(status="released"))
    assert r.status_code == 409


def test_release_hold_endpoint():
    db = make_db()
    with patch("orders.db_for_user", return_value=db):
        r = client.post(f"/api/checkout/holds/{HOLD}/release")
    assert r.status_code == 200
    assert r.json() == {"released": True}
    assert db.rpc_calls[-1] == ("release_ticket_hold", {"p_hold_id": HOLD})


def test_my_order_after_reload_shows_same_ticket_ids():
    db = make_db()
    created = post_order(db).json()
    with patch("routers.my_orders.db_for_user", return_value=db):
        r = client.get(f"/api/me/orders/{created['order_id']}")
    assert r.status_code == 200
    order = r.json()
    assert {t["id"] for t in order["tickets"]} == {t["ticket_id"] for t in created["tickets"]}
    assert order["breakdown_kzt"]["total"] == 12600
    assert order["event"]["title"] == "Demo Fest"
    # same QR on the confirmation page and in the order response
    assert {t["qr_payload"] for t in order["tickets"]} == {t["qr_payload"] for t in created["tickets"]}


def test_someone_elses_order_is_not_found():
    db = make_db()
    db.tables["orders"].append({"id": "foreign", "user_id": OTHER, "event_id": EVENT, "total_amount": 100})
    with patch("routers.my_orders.db_for_user", return_value=db):
        r = client.get("/api/me/orders/foreign")
    assert r.status_code == 404
