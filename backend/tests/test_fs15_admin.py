import os

os.environ.setdefault("QR_SECRET", "test-secret")

from unittest.mock import patch

from fastapi.testclient import TestClient

import deps
import routers.admin as admin_module
from main import app
from schemas import CurrentUser
from tests.fakedb import FakeDB

client = TestClient(app)

ADMIN = CurrentUser(id="adm-1", email="a@example.com", role="platform_admin", access_token="t")
ORGANIZER = CurrentUser(id="org-1", email="o@example.com", role="organizer", access_token="t")
ATTENDEE = CurrentUser(id="att-1", email="u@example.com", role="attendee", access_token="t")


class BrokenAudit(FakeDB):
    def table(self, name):
        if name == "audit_log":
            raise RuntimeError("audit down")
        return super().table(name)


def call(db, who, method, url, **kw):
    app.dependency_overrides[deps.get_current_user] = lambda: who
    try:
        with patch.object(admin_module, "db_for_user", lambda _t: db), patch.object(admin_module, "supabase", db):
            return getattr(client, method)(url, headers={"Authorization": "Bearer t"}, **kw)
    finally:
        app.dependency_overrides.clear()


def events_db(**event):
    ev = {"id": "ev-1", "organizer_id": "org-1", "title": "Jazz", "paid_sales_status": "ACTIVE", "paid_sales_active": True, **event}
    return FakeDB(events=[ev], payments=[], audit_log=[], profiles=[{"id": "u1", "email": "x@example.com", "role": "attendee"}])


LIST_URLS = ["/api/admin/users", "/api/admin/events", "/api/admin/orders", "/api/admin/payments", "/api/admin/reports",
             "/api/admin/settings/activation-fee", "/api/admin/export"]


def test_non_admins_are_denied_everywhere():
    for who in (ATTENDEE, ORGANIZER):
        for url in LIST_URLS:
            assert call(events_db(), who, "get", url).status_code == 403, url
        assert call(events_db(), who, "post", "/api/admin/events/ev-1/suspend", json={"reason": "spam"}).status_code == 403
        assert call(events_db(), who, "patch", "/api/admin/settings/activation-fee", json={"activation_fee_kzt": 1}).status_code == 403


def test_suspend_requires_a_reason_and_changes_nothing_without_it():
    db = events_db()
    for body in ({}, {"reason": "  "}, {"reason": "x"}):
        assert call(db, ADMIN, "post", "/api/admin/events/ev-1/suspend", json=body).status_code == 400
        assert call(db, ADMIN, "post", "/api/admin/users/u1/suspend", json=body).status_code == 400
    assert db.tables["events"][0].get("is_suspended") is None


def test_suspend_records_reason_in_audit_log_and_reports_it():
    db = events_db()
    r = call(db, ADMIN, "post", "/api/admin/events/ev-1/suspend", json={"reason": "Terms violation"})
    assert r.status_code == 200 and r.json()["audit_recorded"] is True
    assert db.tables["audit_log"][0]["metadata"]["reason"] == "Terms violation"
    assert db.tables["events"][0]["is_suspended"] is True and db.tables["events"][0]["paid_sales_active"] is False


def test_suspend_reports_when_the_audit_write_failed():
    db = BrokenAudit(events=[{"id": "ev-1", "organizer_id": "org-1", "title": "J"}], payments=[])
    r = call(db, ADMIN, "post", "/api/admin/events/ev-1/suspend", json={"reason": "Terms violation"})
    assert r.status_code == 200 and r.json()["audit_recorded"] is False


def test_unsuspend_does_not_grant_paid_sales_to_an_event_that_never_activated():
    db = events_db(is_suspended=True, paid_sales_status="SUSPENDED", paid_sales_active=False)
    assert call(db, ADMIN, "post", "/api/admin/events/ev-1/unsuspend").status_code == 200
    ev = db.tables["events"][0]
    assert (ev["is_suspended"], ev["paid_sales_status"], ev["paid_sales_active"]) == (False, "NONE", False)


def test_unsuspend_restores_paid_sales_for_an_event_that_had_activated():
    db = events_db(is_suspended=True, paid_sales_status="SUSPENDED", paid_sales_active=False)
    db.tables["payments"].append({"event_id": "ev-1", "status": "completed", "simulated": True})
    call(db, ADMIN, "post", "/api/admin/events/ev-1/unsuspend")
    ev = db.tables["events"][0]
    assert (ev["paid_sales_status"], ev["paid_sales_active"]) == ("ACTIVE", True)


def test_lists_support_offset_and_newest_first():
    db = FakeDB(orders=[{"id": f"o{i}", "created_at": f"2026-11-{i:02d}", "status": "paid"} for i in range(1, 8)])
    first = call(db, ADMIN, "get", "/api/admin/orders?limit=3").json()
    second = call(db, ADMIN, "get", "/api/admin/orders?limit=3&offset=3").json()
    assert [o["id"] for o in first] == ["o7", "o6", "o5"]
    assert [o["id"] for o in second] == ["o4", "o3", "o2"]


def test_payments_can_be_filtered_by_status():
    db = FakeDB(payments=[{"id": "p1", "status": "failed"}, {"id": "p2", "status": "completed"}])
    assert [p["id"] for p in call(db, ADMIN, "get", "/api/admin/payments?status=failed").json()] == ["p1"]


def test_export_revenue_counts_paid_and_completed_orders_only():
    db = FakeDB(events=[], tickets=[], orders=[
        {"id": "a", "status": "paid", "total_amount": 1000}, {"id": "b", "status": "completed", "total_amount": 500},
        {"id": "c", "status": "refunded", "total_amount": 900}, {"id": "d", "status": "pending", "total_amount": 700}])
    assert call(db, ADMIN, "get", "/api/admin/export").json()["total_revenue_kzt"] == 1500


def test_fee_change_is_audited_and_visible_to_organizers_activation_status():
    db = FakeDB(platform_settings=[], audit_log=[])
    assert call(db, ADMIN, "patch", "/api/admin/settings/activation-fee", json={"activation_fee_kzt": 9000}).status_code == 200
    assert call(db, ADMIN, "get", "/api/admin/settings/activation-fee").json()["activation_fee_kzt"] == 9000
    assert db.tables["audit_log"][0]["action"] == "ACTIVATION_FEE_UPDATED"
