import os
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_KEY", "dummy-key")
os.environ.setdefault("QR_SECRET", "test-secret")

import pytest
from fastapi.testclient import TestClient

from main import app
from deps import get_current_user
from schemas import CurrentUser, ROLE_ATTENDEE, ROLE_ORGANIZER
from crypto import verify_hmac_signature

client = TestClient(app)

USER_ID = str(uuid.uuid4())
EVENT_ID = str(uuid.uuid4())
TICKET_TYPE_ID = str(uuid.uuid4())
HOLD_ID = str(uuid.uuid4())


def as_user(role):
    user = CurrentUser(
        id=USER_ID, email=f"{role}@example.com", full_name=None, phone_number=None,
        payout_info=None, role=role, access_token="dummy-token",
    )
    app.dependency_overrides[get_current_user] = lambda: user


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def rpc_returns(data):
    db = MagicMock()
    db.rpc.return_value.execute.return_value.data = data
    return db


def rpc_raises(code):
    db = MagicMock()
    db.rpc.return_value.execute.side_effect = Exception(f"{{'message': '{code}', 'code': 'P0001'}}")
    return db


def make_hold(**overrides):
    hold = {
        "id": HOLD_ID, "user_id": USER_ID, "event_id": EVENT_ID, "ticket_type_id": TICKET_TYPE_ID,
        "quantity": 2, "status": "active",
        "subtotal_kzt": 30000, "discount_kzt": 6000, "fee_kzt": 1200, "total_kzt": 25200,
    }
    hold.update(overrides)
    return hold


def orders_db(hold, finalize_result="order-1"):
    db = MagicMock()
    table = db.table.return_value.select.return_value
    table.eq.return_value.eq.return_value.execute.return_value.data = [hold] if hold else []
    ends = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
    table.eq.return_value.execute.return_value.data = [{"starts_at": ends, "ends_at": ends}]
    db.rpc.return_value.execute.return_value.data = finalize_result
    return db


@pytest.mark.parametrize("method,path", [
    ("post", "/api/checkout/apply-promo"),
    ("post", "/api/campaigns"),
    ("post", "/api/orders"),
    ("get", "/api/organizer/campaigns/stats"),
    ("get", f"/api/organizer/events/{EVENT_ID}/history"),
    ("post", f"/api/organizer/events/{EVENT_ID}/duplicate"),
])
def test_endpoints_require_token(method, path):
    resp = client.post(path, json={}) if method == "post" else client.get(path)
    assert resp.status_code in (401, 403)


def test_apply_promo_returns_server_calculated_hold():
    as_user(ROLE_ATTENDEE)
    hold = {"hold_id": HOLD_ID, "subtotal_kzt": 30000, "discount_kzt": 6000, "fee_kzt": 1200, "total_kzt": 25200}
    db = rpc_returns(hold)
    with patch("promo.db_for_user", return_value=db):
        resp = client.post("/api/checkout/apply-promo",
                           json={"ticket_type_id": TICKET_TYPE_ID, "quantity": 2, "code": "test20"})
    assert resp.status_code == 200
    assert resp.json()["total_kzt"] == 25200
    fn, params = db.rpc.call_args.args
    assert fn == "create_ticket_hold"
    assert params == {"p_ticket_type_id": TICKET_TYPE_ID, "p_quantity": 2, "p_promo_code": "test20"}


@pytest.mark.parametrize("code,status", [
    ("SOLD_OUT", 409),
    ("PROMO_EXHAUSTED", 400),
    ("PROMO_NOT_FOUND", 404),
    ("PAID_SALES_INACTIVE", 402),
])
def test_apply_promo_maps_rpc_errors(code, status):
    as_user(ROLE_ATTENDEE)
    with patch("promo.db_for_user", return_value=rpc_raises(code)):
        resp = client.post("/api/checkout/apply-promo", json={"ticket_type_id": TICKET_TYPE_ID, "quantity": 1})
    assert resp.status_code == status
    assert resp.json()["detail"] == code


def test_apply_promo_rejects_bad_quantity():
    as_user(ROLE_ATTENDEE)
    resp = client.post("/api/checkout/apply-promo", json={"ticket_type_id": TICKET_TYPE_ID, "quantity": 0})
    assert resp.status_code == 422


CAMPAIGN_BODY = {
    "event_id": EVENT_ID, "name": "Test QR", "discount_percent": 20,
    "code": "TEST20", "max_uses": 3, "ends_at": "2030-01-01T00:00:00Z",
}


def test_campaign_requires_organizer_role():
    as_user(ROLE_ATTENDEE)
    resp = client.post("/api/campaigns", json=CAMPAIGN_BODY)
    assert resp.status_code == 403


def test_campaign_created_with_qr_link():
    as_user(ROLE_ORGANIZER)
    db = rpc_returns({"campaign_id": "c1", "code": "TEST20", "qr_slug": "abc"})
    with patch("promo.db_for_user", return_value=db):
        resp = client.post("/api/campaigns", json=CAMPAIGN_BODY)
    assert resp.status_code == 201
    params = db.rpc.call_args.args[1]
    assert resp.json()["qr_link"].endswith("/c/" + params["p_slug"])
    assert params["p_event_id"] == EVENT_ID


def test_campaign_duplicate_code_conflict():
    as_user(ROLE_ORGANIZER)
    with patch("promo.db_for_user", return_value=rpc_raises("PROMO_CODE_EXISTS")):
        resp = client.post("/api/campaigns", json=CAMPAIGN_BODY)
    assert resp.status_code == 409


def test_campaign_for_foreign_event_forbidden():
    as_user(ROLE_ORGANIZER)
    with patch("promo.db_for_user", return_value=rpc_raises("NOT_EVENT_OWNER")):
        resp = client.post("/api/campaigns", json=CAMPAIGN_BODY)
    assert resp.status_code == 403


def test_campaign_rejects_end_before_start():
    as_user(ROLE_ORGANIZER)
    body = {**CAMPAIGN_BODY, "starts_at": "2030-01-02T00:00:00Z", "ends_at": "2030-01-01T00:00:00Z"}
    resp = client.post("/api/campaigns", json=body)
    assert resp.status_code == 422


def test_campaign_link_redirects_to_frontend():
    with patch("promo.supabase", rpc_returns({"event_id": EVENT_ID, "code": "TEST20"})):
        resp = client.get("/c/abc", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"].endswith("/checkout?promo=TEST20")


def test_campaign_link_unknown_slug():
    with patch("promo.supabase", rpc_returns(None)):
        resp = client.get("/c/nope", follow_redirects=False)
    assert resp.status_code == 404


def test_order_paid_issues_signed_tickets():
    as_user(ROLE_ATTENDEE)
    db = orders_db(make_hold())
    with patch("orders.db_for_user", return_value=db):
        resp = client.post("/api/orders", json={"hold_id": HOLD_ID, "currency": "USD"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "paid"
    assert data["charged"]["amount"] == "50.40"
    assert len(data["tickets"]) == 2
    for t in data["tickets"]:
        ok, reason, parsed = verify_hmac_signature(t["qr_payload"])
        assert ok, reason
        assert parsed["event_id"] == EVENT_ID
    fn, params = db.rpc.call_args.args
    assert fn == "finalize_order"
    assert len(params["p_tickets"]) == 2


def test_order_declined_card_does_not_finalize():
    as_user(ROLE_ATTENDEE)
    db = orders_db(make_hold())
    with patch("orders.db_for_user", return_value=db):
        resp = client.post("/api/orders", json={"hold_id": HOLD_ID, "card_number": "4000000000000002"})
    assert resp.status_code == 402
    db.rpc.assert_not_called()


def test_order_unknown_hold():
    as_user(ROLE_ATTENDEE)
    with patch("orders.db_for_user", return_value=orders_db(None)):
        resp = client.post("/api/orders", json={"hold_id": HOLD_ID})
    assert resp.status_code == 404


def test_order_hold_not_active():
    as_user(ROLE_ATTENDEE)
    with patch("orders.db_for_user", return_value=orders_db(make_hold(status="converted"))):
        resp = client.post("/api/orders", json={"hold_id": HOLD_ID})
    assert resp.status_code == 409


def test_order_hold_expired_during_finalize():
    as_user(ROLE_ATTENDEE)
    db = orders_db(make_hold())
    db.rpc.return_value.execute.side_effect = Exception("HOLD_EXPIRED")
    with patch("orders.db_for_user", return_value=db):
        resp = client.post("/api/orders", json={"hold_id": HOLD_ID})
    assert resp.status_code == 410


def test_stats_requires_organizer():
    as_user(ROLE_ATTENDEE)
    resp = client.get("/api/organizer/campaigns/stats")
    assert resp.status_code == 403


def test_stats_conversion_rate():
    as_user(ROLE_ORGANIZER)
    data = {"campaigns": [{"orders": 1, "qr_scans": 4}, {"orders": 0, "qr_scans": 0}], "totals": {"orders": 1}}
    with patch("orders.db_for_user", return_value=rpc_returns(data)):
        resp = client.get("/api/organizer/campaigns/stats")
    assert resp.status_code == 200
    rates = [c["conversion_rate"] for c in resp.json()["campaigns"]]
    assert rates == [0.25, None]


def test_history_requires_organizer():
    as_user(ROLE_ATTENDEE)
    resp = client.get(f"/api/organizer/events/{EVENT_ID}/history")
    assert resp.status_code == 403


def test_history_returns_timeline():
    as_user(ROLE_ORGANIZER)
    timeline = [{"action": "PROMO_CREATED"}, {"action": "ORDER_PAID"}]
    db = rpc_returns(timeline)
    with patch("routers.event_history.db_for_user", return_value=db):
        resp = client.get(f"/api/organizer/events/{EVENT_ID}/history")
    assert resp.status_code == 200
    assert [e["action"] for e in resp.json()] == ["PROMO_CREATED", "ORDER_PAID"]
    assert db.rpc.call_args.args == ("event_history", {"p_event_id": EVENT_ID})


def test_history_of_foreign_event_forbidden():
    as_user(ROLE_ORGANIZER)
    with patch("routers.event_history.db_for_user", return_value=rpc_raises("NOT_EVENT_OWNER")):
        resp = client.get(f"/api/organizer/events/{EVENT_ID}/history")
    assert resp.status_code == 403


def test_history_unknown_event():
    as_user(ROLE_ORGANIZER)
    with patch("routers.event_history.db_for_user", return_value=rpc_raises("EVENT_NOT_FOUND")):
        resp = client.get(f"/api/organizer/events/{EVENT_ID}/history")
    assert resp.status_code == 404


def test_duplicate_with_new_date():
    as_user(ROLE_ORGANIZER)
    db = rpc_returns({"event_id": "new-id", "status": "draft", "ticket_types_copied": 2})
    with patch("routers.event_history.db_for_user", return_value=db):
        resp = client.post(f"/api/organizer/events/{EVENT_ID}/duplicate",
                           json={"title": "Copy", "starts_at": "2027-01-20T18:00:00Z"})
    assert resp.status_code == 201
    assert resp.json()["status"] == "draft"
    fn, params = db.rpc.call_args.args
    assert fn == "duplicate_event"
    assert params["p_event_id"] == EVENT_ID
    assert params["p_title"] == "Copy"
    assert params["p_starts_at"].startswith("2027-01-20T18:00:00")


def test_duplicate_without_body():
    as_user(ROLE_ORGANIZER)
    db = rpc_returns({"event_id": "new-id", "status": "draft", "ticket_types_copied": 0})
    with patch("routers.event_history.db_for_user", return_value=db):
        resp = client.post(f"/api/organizer/events/{EVENT_ID}/duplicate")
    assert resp.status_code == 201
    params = db.rpc.call_args.args[1]
    assert params["p_title"] is None and params["p_starts_at"] is None


def test_duplicate_foreign_event_forbidden():
    as_user(ROLE_ORGANIZER)
    with patch("routers.event_history.db_for_user", return_value=rpc_raises("NOT_EVENT_OWNER")):
        resp = client.post(f"/api/organizer/events/{EVENT_ID}/duplicate", json={})
    assert resp.status_code == 403