import os

os.environ.setdefault("QR_SECRET", "test-secret")

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient

import deps
import orders
import promo
import routers.admin as admin_module
from main import app
from schemas import CurrentUser
from tests.fakedb import FakeDB, _Query, _Result
from tests.test_pb18 import ORGANIZER, run

client = TestClient(app)
ADMIN = CurrentUser(id="adm-1", email="a@example.com", role="platform_admin", access_token="t")
BUYER = CurrentUser(id="buy-1", email="b@example.com", role="attendee", access_token="t")


def parse(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(h):
    return (datetime.now(timezone.utc) + timedelta(hours=h)).isoformat()


def test_event_create_and_update_fill_the_legacy_columns():
    db = FakeDB(events=[], ticket_types=[], tickets=[])
    start = iso(48)
    r = run(db, ORGANIZER, "post", "/api/organizer/events", json={"title": "T", "starts_at": start, "venue_name": "Hall"})
    assert r.status_code == 201
    body = r.json()
    assert parse(body["event_date"]) == parse(start) and body["venue"] == "Hall"
    later = iso(72)
    r = run(db, ORGANIZER, "patch", f"/api/organizer/events/{body['id']}", json={"starts_at": later, "venue_name": "Hall 2"})
    assert parse(r.json()["event_date"]) == parse(later) and r.json()["venue"] == "Hall 2"


def test_event_create_without_a_date_still_satisfies_the_required_column():
    db = FakeDB(events=[], ticket_types=[], tickets=[])
    r = run(db, ORGANIZER, "post", "/api/organizer/events", json={"title": "No date yet"})
    assert r.status_code == 201 and r.json()["event_date"]


class NoRowUpdates(FakeDB):
    def table(self, name):
        q = _Query(self, name)
        original = q.execute

        def execute():
            if q.op == "update":
                return _Result([])
            return original()

        q.execute = execute
        return q


def admin_call(db, path, **kw):
    app.dependency_overrides[deps.get_current_user] = lambda: ADMIN
    try:
        with patch.object(admin_module, "db_for_user", lambda _t: db), patch.object(admin_module, "supabase", db):
            return client.post(path, headers={"Authorization": "Bearer t"}, **kw)
    finally:
        app.dependency_overrides.clear()


def test_suspension_that_changes_no_row_is_reported_as_failure():
    db = NoRowUpdates(events=[{"id": "ev-1", "organizer_id": "o"}], profiles=[{"id": "u1"}], audit_log=[], payments=[])
    for path in ("/api/admin/events/ev-1/suspend", "/api/admin/users/u1/suspend"):
        r = admin_call(db, path, json={"reason": "abuse"})
        assert r.status_code == 403 and "not applied" in r.json()["detail"]
    for path in ("/api/admin/events/ev-1/unsuspend", "/api/admin/users/u1/unsuspend"):
        assert admin_call(db, path).status_code == 403
    assert db.tables["audit_log"] == []


def buyer_call(db, patched, method, path, **kw):
    app.dependency_overrides[deps.get_current_user] = lambda: BUYER
    try:
        with patch.object(patched, "db_for_user", lambda _t: db):
            return getattr(client, method)(path, headers={"Authorization": "Bearer t"}, **kw)
    finally:
        app.dependency_overrides.clear()


def suspended_db():
    return FakeDB(
        events=[{"id": "ev-1", "is_suspended": True, "paid_sales_status": "SUSPENDED"}],
        ticket_types=[{"id": "tt-1", "event_id": "ev-1"}],
        ticket_holds=[{"id": "h-1", "user_id": "buy-1", "event_id": "ev-1", "status": "active", "total_kzt": 0}],
        orders=[],
    )


def test_new_holds_on_a_suspended_event_are_refused_before_the_database_function():
    r = buyer_call(suspended_db(), promo, "post", "/api/checkout/apply-promo", json={"ticket_type_id": "tt-1", "quantity": 1})
    assert r.status_code == 400 and r.json()["detail"] == "EVENT_SUSPENDED"


def test_open_event_hold_request_reaches_the_database_function():
    db = FakeDB(events=[{"id": "ev-1", "is_suspended": False, "paid_sales_status": "ACTIVE"}], ticket_types=[{"id": "tt-1", "event_id": "ev-1"}],
                rpcs={"create_ticket_hold": lambda p: {"hold_id": "h"}})
    r = buyer_call(db, promo, "post", "/api/checkout/apply-promo", json={"ticket_type_id": "tt-1", "quantity": 1})
    assert r.status_code == 200 and db.rpc_calls


def test_confirming_an_order_on_a_suspended_event_is_refused():
    r = buyer_call(suspended_db(), orders, "post", "/api/orders", json={"hold_id": "h-1", "currency": "KZT", "payment_outcome": "approved"})
    assert r.status_code == 400 and r.json()["detail"] == "EVENT_SUSPENDED"


def test_public_event_list_leaves_out_suspended_events():
    import main as main_module

    db = FakeDB(events=[
        {"id": "a", "status": "published", "visibility": "public", "is_suspended": False},
        {"id": "b", "status": "published", "visibility": "public", "is_suspended": True},
        {"id": "c", "status": "draft", "visibility": "public"},
        {"id": "d", "status": "published", "visibility": "unlisted"},
    ])
    with patch.object(main_module, "supabase", db):
        r = client.get("/api/events")
    assert [e["id"] for e in r.json()] == ["a"]
