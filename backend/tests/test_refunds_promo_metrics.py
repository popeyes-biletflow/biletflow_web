import os
import uuid
from unittest.mock import MagicMock, patch

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_KEY", "dummy-key")
os.environ.setdefault("QR_SECRET", "test-secret")

import pytest
from fastapi.testclient import TestClient

from main import app
from deps import get_current_user
from schemas import CurrentUser, ROLE_ATTENDEE, ROLE_ORGANIZER

client = TestClient(app)

USER_ID = str(uuid.uuid4())
EVENT_ID = str(uuid.uuid4())
ORDER_ID = str(uuid.uuid4())
CAMPAIGN_ID = str(uuid.uuid4())
TIER_ID = str(uuid.uuid4())


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


def refund_db(result):
    db = rpc_returns(result)
    order = {"id": ORDER_ID, "user_id": USER_ID, "event_id": EVENT_ID, "title": "Astana Tech"}
    db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [order]
    return db


REFUND_RESULT = {
    "refund_id": "r1", "order_id": ORDER_ID, "amount_kzt": 15750,
    "fee_refunded_kzt": 750, "ticket_ids": ["t1"], "status": "refunded", "already_refunded": False,
}


@pytest.mark.parametrize("method,path", [
    ("post", f"/api/me/orders/{ORDER_ID}/refund"),
    ("post", f"/api/organizer/orders/{ORDER_ID}/refund"),
    ("patch", f"/api/organizer/events/{EVENT_ID}/refund-policy"),
    ("get", "/api/organizer/payout-estimate"),
    ("get", f"/api/organizer/events/{EVENT_ID}/attendees"),
    ("get", f"/api/organizer/events/{EVENT_ID}/metrics"),
    ("get", f"/api/organizer/events/{EVENT_ID}/activity"),
    ("patch", f"/api/campaigns/{CAMPAIGN_ID}/disabled"),
])
def test_new_endpoints_require_token(method, path):
    resp = getattr(client, method)(path)
    assert resp.status_code in (401, 403)


def test_refund_my_order_sends_notification_once():
    as_user(ROLE_ATTENDEE)
    db = refund_db(REFUND_RESULT)
    with patch("routers.refunds.db_for_user", return_value=db), \
         patch("routers.refunds.notify.notify") as notify_mock:
        resp = client.post(f"/api/me/orders/{ORDER_ID}/refund", json={"reason": "test"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "refunded"
    assert db.rpc.call_args.args == ("refund_order", {"p_order_id": ORDER_ID, "p_reason": "test"})
    notify_mock.assert_called_once()
    assert notify_mock.call_args.args[0] == "REFUND_COMPLETED"
    assert notify_mock.call_args.args[3] == "refund:r1"


def test_repeated_refund_returns_same_result_without_second_notification():
    as_user(ROLE_ATTENDEE)
    db = refund_db({**REFUND_RESULT, "already_refunded": True})
    with patch("routers.refunds.db_for_user", return_value=db), \
         patch("routers.refunds.notify.notify") as notify_mock:
        resp = client.post(f"/api/me/orders/{ORDER_ID}/refund")
    assert resp.status_code == 200
    assert resp.json()["already_refunded"] is True
    assert resp.json()["refund_id"] == "r1"
    notify_mock.assert_not_called()


def test_refund_succeeds_even_if_notification_fails():
    as_user(ROLE_ATTENDEE)
    db = refund_db(REFUND_RESULT)
    with patch("routers.refunds.db_for_user", return_value=db), \
         patch("routers.refunds.notify.notify", side_effect=RuntimeError("smtp down")):
        resp = client.post(f"/api/me/orders/{ORDER_ID}/refund")
    assert resp.status_code == 200
    assert resp.json()["status"] == "refunded"


@pytest.mark.parametrize("code,status", [
    ("ORDER_NOT_FOUND", 404),
    ("ORDER_NOT_REFUNDABLE", 409),
    ("TICKET_ALREADY_USED", 409),
    ("NOTHING_TO_REFUND", 409),
    ("REFUND_NOT_ALLOWED", 403),
    ("REFUND_WINDOW_CLOSED", 409),
])
def test_refund_rejections_are_specific_and_send_nothing(code, status):
    as_user(ROLE_ATTENDEE)
    with patch("routers.refunds.db_for_user", return_value=rpc_raises(code)), \
         patch("routers.refunds.notify.notify") as notify_mock:
        resp = client.post(f"/api/me/orders/{ORDER_ID}/refund")
    assert resp.status_code == status
    assert resp.json()["detail"] == code
    notify_mock.assert_not_called()


def test_organizer_refund_requires_organizer_role():
    as_user(ROLE_ATTENDEE)
    resp = client.post(f"/api/organizer/orders/{ORDER_ID}/refund")
    assert resp.status_code == 403


def test_organizer_can_refund_attendee_order():
    as_user(ROLE_ORGANIZER)
    db = refund_db(REFUND_RESULT)
    with patch("routers.refunds.db_for_user", return_value=db), \
         patch("routers.refunds.notify.notify"):
        resp = client.post(f"/api/organizer/orders/{ORDER_ID}/refund", json={"reason": "event issue"})
    assert resp.status_code == 200
    assert db.rpc.call_args.args[1]["p_reason"] == "event issue"


def test_refund_policy_update():
    as_user(ROLE_ORGANIZER)
    db = MagicMock()
    db.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [{"id": EVENT_ID}]
    with patch("routers.refunds.db_for_user", return_value=db):
        resp = client.patch(f"/api/organizer/events/{EVENT_ID}/refund-policy", json={"refund_policy": "none"})
    assert resp.status_code == 200
    assert resp.json()["refund_policy"] == "none"
    db.table.return_value.update.assert_called_once_with({"refund_policy": "none"})


def test_refund_policy_rejects_unknown_value():
    as_user(ROLE_ORGANIZER)
    resp = client.patch(f"/api/organizer/events/{EVENT_ID}/refund-policy", json={"refund_policy": "always"})
    assert resp.status_code == 422


def test_refund_policy_of_foreign_event_not_found():
    as_user(ROLE_ORGANIZER)
    db = MagicMock()
    db.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
    with patch("routers.refunds.db_for_user", return_value=db):
        resp = client.patch(f"/api/organizer/events/{EVENT_ID}/refund-policy", json={"refund_policy": "none"})
    assert resp.status_code == 404


def test_refund_policy_requires_organizer_role():
    as_user(ROLE_ATTENDEE)
    resp = client.patch(f"/api/organizer/events/{EVENT_ID}/refund-policy", json={"refund_policy": "none"})
    assert resp.status_code == 403


CAMPAIGN_BASE = {"event_id": EVENT_ID, "name": "Fixed", "code": "FIX2000", "max_uses": 5,
                 "ends_at": "2030-01-01T00:00:00Z"}


def test_campaign_with_fixed_discount_and_tier_scope():
    as_user(ROLE_ORGANIZER)
    db = rpc_returns({"campaign_id": "c1", "code": "FIX2000", "qr_slug": "abc"})
    body = {**CAMPAIGN_BASE, "discount_type": "fixed_kzt", "discount_value": 2000, "ticket_type_id": TIER_ID}
    with patch("promo.db_for_user", return_value=db):
        resp = client.post("/api/campaigns", json=body)
    assert resp.status_code == 201
    fn, params = db.rpc.call_args.args
    assert fn == "create_campaign_v2"
    assert params["p_discount_type"] == "fixed_kzt"
    assert params["p_discount_value"] == 2000
    assert params["p_ticket_type_id"] == TIER_ID


def test_campaign_legacy_percent_field_still_works():
    as_user(ROLE_ORGANIZER)
    db = rpc_returns({"campaign_id": "c1", "code": "OLD", "qr_slug": "abc"})
    with patch("promo.db_for_user", return_value=db):
        resp = client.post("/api/campaigns", json={**CAMPAIGN_BASE, "discount_percent": 20})
    assert resp.status_code == 201
    params = db.rpc.call_args.args[1]
    assert params["p_discount_type"] == "percent"
    assert params["p_discount_value"] == 20
    assert params["p_ticket_type_id"] is None


def test_campaign_percent_over_100_rejected():
    as_user(ROLE_ORGANIZER)
    resp = client.post("/api/campaigns", json={**CAMPAIGN_BASE, "discount_type": "percent", "discount_value": 150})
    assert resp.status_code == 422


def test_campaign_without_discount_rejected():
    as_user(ROLE_ORGANIZER)
    resp = client.post("/api/campaigns", json=CAMPAIGN_BASE)
    assert resp.status_code == 422


def test_campaign_invalid_ticket_type_rejected():
    as_user(ROLE_ORGANIZER)
    body = {**CAMPAIGN_BASE, "discount_percent": 10, "ticket_type_id": TIER_ID}
    with patch("promo.db_for_user", return_value=rpc_raises("INVALID_TICKET_TYPE")):
        resp = client.post("/api/campaigns", json=body)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "INVALID_TICKET_TYPE"


@pytest.mark.parametrize("code", ["PROMO_DISABLED", "PROMO_NOT_STARTED", "PROMO_EXPIRED", "PROMO_WRONG_TIER"])
def test_apply_promo_specific_rejections(code):
    as_user(ROLE_ATTENDEE)
    with patch("promo.db_for_user", return_value=rpc_raises(code)):
        resp = client.post("/api/checkout/apply-promo", json={"ticket_type_id": TIER_ID, "quantity": 1, "code": "X"})
    assert resp.status_code == 400
    assert resp.json()["detail"] == code


def test_disable_campaign():
    as_user(ROLE_ORGANIZER)
    db = rpc_returns({"campaign_id": CAMPAIGN_ID, "is_disabled": True})
    with patch("promo.db_for_user", return_value=db):
        resp = client.patch(f"/api/campaigns/{CAMPAIGN_ID}/disabled", json={"disabled": True})
    assert resp.status_code == 200
    assert resp.json()["is_disabled"] is True
    assert db.rpc.call_args.args == ("set_campaign_disabled", {"p_campaign_id": CAMPAIGN_ID, "p_disabled": True})


def test_disable_campaign_requires_organizer():
    as_user(ROLE_ATTENDEE)
    resp = client.patch(f"/api/campaigns/{CAMPAIGN_ID}/disabled", json={"disabled": True})
    assert resp.status_code == 403


@pytest.mark.parametrize("code,status", [("NOT_EVENT_OWNER", 403), ("CAMPAIGN_NOT_FOUND", 404)])
def test_disable_campaign_rejections(code, status):
    as_user(ROLE_ORGANIZER)
    with patch("promo.db_for_user", return_value=rpc_raises(code)):
        resp = client.patch(f"/api/campaigns/{CAMPAIGN_ID}/disabled", json={"disabled": True})
    assert resp.status_code == status


def test_payout_estimate_passes_event_filter():
    as_user(ROLE_ORGANIZER)
    db = rpc_returns({"estimated_payout_kzt": 15000, "simulated": True})
    with patch("routers.organizer_finance.db_for_user", return_value=db):
        resp = client.get(f"/api/organizer/payout-estimate?event_id={EVENT_ID}")
    assert resp.status_code == 200
    assert resp.json()["estimated_payout_kzt"] == 15000
    assert db.rpc.call_args.args == ("organizer_payout_estimate", {"p_event_id": EVENT_ID})


def test_payout_estimate_requires_organizer():
    as_user(ROLE_ATTENDEE)
    assert client.get("/api/organizer/payout-estimate").status_code == 403


def test_payout_estimate_foreign_event_forbidden():
    as_user(ROLE_ORGANIZER)
    with patch("routers.organizer_finance.db_for_user", return_value=rpc_raises("NOT_EVENT_OWNER")):
        resp = client.get(f"/api/organizer/payout-estimate?event_id={EVENT_ID}")
    assert resp.status_code == 403


def test_attendees_pagination_and_filter():
    as_user(ROLE_ORGANIZER)
    db = rpc_returns({"total": 1, "items": []})
    with patch("routers.organizer_finance.db_for_user", return_value=db):
        resp = client.get(f"/api/organizer/events/{EVENT_ID}/attendees?status=refunded&limit=5&offset=10")
    assert resp.status_code == 200
    assert db.rpc.call_args.args == ("organizer_attendees", {
        "p_event_id": EVENT_ID, "p_status": "refunded", "p_limit": 5, "p_offset": 10})


def test_attendees_limit_is_capped():
    as_user(ROLE_ORGANIZER)
    assert client.get(f"/api/organizer/events/{EVENT_ID}/attendees?limit=500").status_code == 422


def test_attendees_foreign_event_forbidden():
    as_user(ROLE_ORGANIZER)
    with patch("routers.organizer_finance.db_for_user", return_value=rpc_raises("NOT_EVENT_OWNER")):
        resp = client.get(f"/api/organizer/events/{EVENT_ID}/attendees")
    assert resp.status_code == 403


def test_metrics_passes_filters():
    as_user(ROLE_ORGANIZER)
    db = rpc_returns({"revenue": {"gross_kzt": 30000}})
    with patch("routers.organizer_finance.db_for_user", return_value=db):
        resp = client.get(
            f"/api/organizer/events/{EVENT_ID}/metrics?date_from=2026-11-01&date_to=2026-11-30&ticket_type_id={TIER_ID}")
    assert resp.status_code == 200
    assert db.rpc.call_args.args == ("event_metrics", {
        "p_event_id": EVENT_ID, "p_date_from": "2026-11-01", "p_date_to": "2026-11-30",
        "p_ticket_type_id": TIER_ID})


def test_metrics_rejects_reversed_date_range():
    as_user(ROLE_ORGANIZER)
    resp = client.get(f"/api/organizer/events/{EVENT_ID}/metrics?date_from=2026-12-01&date_to=2026-11-01")
    assert resp.status_code == 400


def test_metrics_other_organizer_forbidden():
    as_user(ROLE_ORGANIZER)
    with patch("routers.organizer_finance.db_for_user", return_value=rpc_raises("NOT_EVENT_OWNER")):
        resp = client.get(f"/api/organizer/events/{EVENT_ID}/metrics")
    assert resp.status_code == 403


def test_metrics_requires_organizer_role():
    as_user(ROLE_ATTENDEE)
    assert client.get(f"/api/organizer/events/{EVENT_ID}/metrics").status_code == 403


def test_activity_filters_and_pagination():
    as_user(ROLE_ORGANIZER)
    db = rpc_returns({"total": 0, "items": []})
    with patch("routers.organizer_finance.db_for_user", return_value=db):
        resp = client.get(
            f"/api/organizer/events/{EVENT_ID}/activity?action=ORDER_REFUNDED&limit=3&offset=6"
            "&date_from=2026-11-01T00:00:00Z")
    assert resp.status_code == 200
    params = db.rpc.call_args.args[1]
    assert db.rpc.call_args.args[0] == "event_activity"
    assert params["p_action"] == "ORDER_REFUNDED"
    assert params["p_limit"] == 3 and params["p_offset"] == 6
    assert params["p_from"].startswith("2026-11-01T00:00:00")
    assert params["p_to"] is None


def test_activity_of_foreign_event_forbidden():
    as_user(ROLE_ORGANIZER)
    with patch("routers.organizer_finance.db_for_user", return_value=rpc_raises("NOT_EVENT_OWNER")):
        resp = client.get(f"/api/organizer/events/{EVENT_ID}/activity")
    assert resp.status_code == 403


def test_activity_unknown_event():
    as_user(ROLE_ORGANIZER)
    with patch("routers.organizer_finance.db_for_user", return_value=rpc_raises("EVENT_NOT_FOUND")):
        resp = client.get(f"/api/organizer/events/{EVENT_ID}/activity")
    assert resp.status_code == 404