from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient

import deps
import orders
import routers.organizer as organizer_module
from main import app
from schemas import CurrentUser
from tests.fakedb import FakeDB

client = TestClient(app)


def user(uid="org-1", role="organizer", payout=None):
    return CurrentUser(id=uid, email="o@example.com", role=role, access_token="t", payout_info=payout)


def iso(hours):
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def call(db, who, url, supabase=None):
    app.dependency_overrides[deps.get_current_user] = lambda: who
    try:
        with patch.object(organizer_module, "db_for_user", lambda _t: db), \
                patch.object(organizer_module, "supabase", supabase or db), \
                patch.object(orders, "db_for_user", lambda _t: db):
            return client.get(url, headers={"Authorization": "Bearer t"})
    finally:
        app.dependency_overrides.clear()


def activation_db(**event):
    ev = {"id": "ev-1", "organizer_id": "org-1", "paid_sales_status": "NONE", "paid_sales_active": False, **event}
    return FakeDB(
        events=[ev],
        ticket_types=[{"id": "t1", "event_id": "ev-1", "price": 0}],
        platform_settings=[{"key": "activation_fee_kzt", "value": 7500}],
    )


def test_activation_status_reports_real_fee_and_missing_items():
    r = call(activation_db(), user(), "/api/organizer/events/ev-1/activation")
    body = r.json()
    assert r.status_code == 200
    assert body["activation_fee_kzt"] == 7500
    assert body["checklist"]["at_least_one_paid_ticket_type"]["passed"] is False
    assert body["checklist"]["valid_payout_account"]["passed"] is False
    assert body["checklist"]["identity_verified"]["simulated"] is True
    assert body["checklist"]["activation_fee_paid"]["passed"] is False


def test_activation_status_reflects_paid_tier_payout_and_active_state():
    db = activation_db(paid_sales_status="ACTIVE", paid_sales_active=True)
    db.tables["ticket_types"].append({"id": "t2", "event_id": "ev-1", "price": 5000})
    body = call(db, user(payout="KZ123"), "/api/organizer/events/ev-1/activation").json()
    assert body["paid_sales_active"] is True
    assert all(body["checklist"][k]["passed"] for k in ("at_least_one_paid_ticket_type", "valid_payout_account", "activation_fee_paid"))


def test_activation_status_denies_other_organizer_and_attendee():
    assert call(activation_db(), user("org-2"), "/api/organizer/events/ev-1/activation").status_code == 403
    assert call(activation_db(), user("a-1", role="attendee"), "/api/organizer/events/ev-1/activation").status_code == 403


def campaign_db(**campaign):
    row = {"id": "c1", "event_id": "ev-1", "name": "Spring", "discount_percent": 10, "qr_slug": "abc123",
           "starts_at": iso(-5), "ends_at": iso(5), **campaign}
    stat = {"campaign_id": "c1", "event_id": "ev-1", "name": "Spring", "code": "SPRING", "discount_percent": 10,
            "max_uses": 5, "qr_scans": 4, "orders": 2, "tickets_sold": 3}
    return FakeDB(campaigns=[row], rpcs={"campaign_stats": lambda _p: {"campaigns": [stat], "totals": {}}})


def stats(db):
    return call(db, user(), "/api/organizer/campaigns/stats?event_id=ev-1").json()["campaigns"][0]


def test_campaign_stats_include_link_window_and_state():
    c = stats(campaign_db())
    assert c["qr_link"].endswith("/c/abc123")
    assert c["state"] == "active" and c["discount_type"] == "percent" and c["discount_value"] == 10
    assert c["conversion_rate"] == 0.5


def test_campaign_state_disabled_expired_scheduled():
    assert stats(campaign_db(is_disabled=True))["state"] == "disabled"
    assert stats(campaign_db(starts_at=iso(-10), ends_at=iso(-1)))["state"] == "expired"
    assert stats(campaign_db(starts_at=iso(2)))["state"] == "scheduled"
