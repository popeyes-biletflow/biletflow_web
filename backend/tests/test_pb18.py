"""PB-18: event lifecycle, discovery filtering, paid-sales gating, inventory and attendee isolation."""
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

os.environ.setdefault("QR_SECRET", "test-secret")

from fastapi.testclient import TestClient

import deps
import main as main_module
from main import app, get_current_user, get_optional_user
from schemas import CurrentUser

client = TestClient(app)

ORGANIZER = CurrentUser(id="org-1", email="org@example.com", role="organizer", access_token="t")
ATTENDEE = CurrentUser(id="att-1", email="att@example.com", role="attendee", access_token="t")
OTHER = CurrentUser(id="att-2", email="other@example.com", role="attendee", access_token="t")


def iso(delta_hours: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=delta_hours)).isoformat()


class Result:
    def __init__(self, data):
        self.data = data


class Query:
    """Tiny in-memory stand-in for the supabase-py query builder."""

    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: str(r.get(col)) == str(val))
        return self

    def in_(self, col, vals):
        vals = {str(v) for v in vals}
        self.filters.append(lambda r: str(r.get(col)) in vals)
        return self

    def insert(self, row):
        self.op, self.payload = "insert", row
        return self

    def update(self, row):
        self.op, self.payload = "update", row
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "insert":
            row = {"id": f"{self.table}-{len(rows) + 1}", "created_at": iso(0), **self.payload}
            rows.append(row)
            return Result([row])
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in matched:
                r.update(self.payload)
        return Result([dict(r) for r in matched])


class FakeDB:
    def __init__(self, **tables):
        self.tables = {k: [dict(r) for r in v] for k, v in tables.items()}

    def table(self, name):
        return Query(self, name)

    def rpc(self, *_a, **_k):
        raise RuntimeError("rpc not available in tests")


def event(**kw):
    base = {
        "id": "ev-1", "organizer_id": "org-1", "title": "Jazz Night", "status": "published",
        "visibility": "public", "starts_at": iso(240), "venue_name": "Hall",
        "paid_sales_status": "NONE", "paid_sales_active": False, "capacity": None,
    }
    base.update(kw)
    return base


FREE = {"id": "tt-free", "event_id": "ev-1", "name": "Free", "price": 0, "quantity": 2, "is_hidden": False}
PAID = {"id": "tt-paid", "event_id": "ev-1", "name": "VIP", "price": 10000, "quantity": 5, "is_hidden": False}
HIDDEN = {"id": "tt-hidden", "event_id": "ev-1", "name": "Staff", "price": 0, "quantity": None, "is_hidden": True}


def run(db, user, method, url, **kw):
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_optional_user] = lambda: user
    app.dependency_overrides[deps.get_current_user] = lambda: user
    try:
        with patch.object(main_module, "supabase", db), patch.object(main_module, "db_for_user", lambda _t: db):
            return getattr(client, method)(url, headers={"Authorization": "Bearer t"}, **kw)
    finally:
        app.dependency_overrides.clear()


# --- event lifecycle -------------------------------------------------------

def test_draft_lifecycle_create_add_types_publish():
    db = FakeDB(events=[], ticket_types=[], tickets=[])
    r = run(db, ORGANIZER, "post", "/api/organizer/events", json={
        "title": "Tech Talk", "starts_at": iso(48), "venue_name": "Hub", "visibility": "unlisted",
        "registration_opens_at": iso(1), "registration_closes_at": iso(40), "capacity": 100,
    })
    assert r.status_code == 201 and r.json()["status"] == "draft"
    ev_id = r.json()["id"]

    assert run(db, ORGANIZER, "post", f"/api/organizer/events/{ev_id}/publish").status_code == 400

    for body in ({"name": "Free", "price": 0, "quantity": 50, "max_per_order": 1},
                 {"name": "Paid", "price": 5000, "quantity": 50, "max_per_order": 2}):
        assert run(db, ORGANIZER, "post", f"/api/organizer/events/{ev_id}/ticket-types", json=body).status_code == 201

    r = run(db, ORGANIZER, "post", f"/api/organizer/events/{ev_id}/publish")
    assert r.status_code == 200 and r.json()["status"] == "published"


def test_event_validation_rejects_bad_values():
    db = FakeDB(events=[event(status="draft")], ticket_types=[], tickets=[])
    for body, msg in (
        ({"visibility": "secret"}, "visibility"),
        ({"capacity": 0}, "capacity"),
        ({"registration_opens_at": iso(10), "registration_closes_at": iso(5)}, "registration_closes_at"),
    ):
        r = run(db, ORGANIZER, "patch", "/api/organizer/events/ev-1", json=body)
        assert r.status_code == 400 and msg in r.json()["detail"]


def test_ticket_type_validation():
    db = FakeDB(events=[event(status="draft")], ticket_types=[], tickets=[])
    r = run(db, ORGANIZER, "post", "/api/organizer/events/ev-1/ticket-types", json={"name": "A", "max_per_order": 0})
    assert r.status_code == 400 and "max_per_order" in r.json()["detail"]
    r = run(db, ORGANIZER, "post", "/api/organizer/events/ev-1/ticket-types",
            json={"name": "A", "sale_starts_at": iso(5), "sale_ends_at": iso(1)})
    assert r.status_code == 400


def test_hide_and_unhide_ticket_type():
    db = FakeDB(events=[event()], ticket_types=[dict(FREE)], tickets=[])
    r = run(db, ORGANIZER, "patch", "/api/organizer/ticket-types/tt-free", json={"is_hidden": True})
    assert r.status_code == 200 and r.json()["is_hidden"] is True
    assert run(db, ATTENDEE, "get", "/api/events/ev-1").json()["ticket_types"] == []
    run(db, ORGANIZER, "patch", "/api/organizer/ticket-types/tt-free", json={"is_hidden": False})
    assert [t["id"] for t in run(db, ATTENDEE, "get", "/api/events/ev-1").json()["ticket_types"]] == ["tt-free"]


def test_publish_needs_a_visible_ticket_type():
    db = FakeDB(events=[event(status="draft")], ticket_types=[dict(HIDDEN)], tickets=[])
    r = run(db, ORGANIZER, "post", "/api/organizer/events/ev-1/publish")
    assert r.status_code == 400 and "visible ticket type" in r.text


# --- discovery -------------------------------------------------------------

def test_discovery_only_lists_published_public_events():
    db = FakeDB(events=[
        event(id="a"), event(id="b", status="draft"), event(id="c", status="cancelled"),
        event(id="d", visibility="unlisted"), event(id="e", visibility="private"),
    ])
    r = run(db, None, "get", "/api/events")
    assert [e["id"] for e in r.json()] == ["a"]


def test_cancelled_and_draft_events_hidden_from_public_details():
    db = FakeDB(events=[event(status="cancelled"), event(id="ev-2", status="draft")], ticket_types=[], tickets=[])
    assert run(db, ATTENDEE, "get", "/api/events/ev-1").status_code == 404
    assert run(db, ATTENDEE, "get", "/api/events/ev-2").status_code == 404
    # the owner can still preview the draft
    assert run(db, ORGANIZER, "get", "/api/events/ev-2").status_code == 200


# --- paid sales gating -----------------------------------------------------

def test_paid_ticket_blocked_until_activation_then_purchasable():
    db = FakeDB(events=[event()], ticket_types=[dict(FREE), dict(PAID)], tickets=[], orders=[])
    r = run(db, ATTENDEE, "post", "/api/events/ev-1/checkout/quote", json={"ticket_type_id": "tt-paid"})
    assert r.status_code == 402

    org = CurrentUser(**{**ORGANIZER.model_dump(), "payout_info": "KZ00 1234"})
    with patch("routers.organizer.db_for_user", lambda _t: db), patch("routers.organizer.supabase", db):
        r = run(db, org, "post", "/api/organizer/events/ev-1/activate-paid-sales", json={"paid_event_terms_accepted": True})
    assert r.status_code == 200, r.text
    assert r.json()["paid_sales_status"] == "ACTIVE"

    r = run(db, ATTENDEE, "post", "/api/events/ev-1/checkout/quote", json={"ticket_type_id": "tt-paid"})
    assert r.status_code == 200 and r.json()["subtotal_kzt"] == 10000


def test_activation_reports_every_missing_prerequisite():
    db = FakeDB(events=[event()], ticket_types=[dict(FREE)], tickets=[])
    with patch("routers.organizer.db_for_user", lambda _t: db), patch("routers.organizer.supabase", db):
        r = run(db, ORGANIZER, "post", "/api/organizer/events/ev-1/activate-paid-sales",
                json={"paid_event_terms_accepted": False})
    assert r.status_code == 422
    failed = {k for k, v in r.json()["detail"]["checklist"].items() if not v["passed"]}
    assert failed == {"at_least_one_paid_ticket_type", "valid_payout_account", "paid_event_terms_accepted"}


# --- inventory and registration window ------------------------------------

def test_free_registration_is_zero_value_order_and_respects_quantity():
    db = FakeDB(events=[event()], ticket_types=[dict(FREE)], tickets=[], orders=[])
    r = run(db, ATTENDEE, "post", "/api/events/ev-1/register", json={"ticket_type_id": "tt-free"})
    assert r.status_code == 201, r.text
    assert r.json()["pricing"]["total_kzt"] == 0
    assert db.tables["orders"][0]["total_amount"] == 0
    # quantity is a total, not decremented on purchase
    assert db.tables["ticket_types"][0]["quantity"] == 2

    assert run(db, OTHER, "post", "/api/events/ev-1/register", json={"ticket_type_id": "tt-free"}).status_code == 201
    third = CurrentUser(id="att-3", email="c@example.com", role="attendee", access_token="t")
    r = run(db, third, "post", "/api/events/ev-1/register", json={"ticket_type_id": "tt-free"})
    assert r.status_code == 400 and "sold out" in r.json()["detail"]


def test_event_capacity_and_registration_window():
    db = FakeDB(events=[event(capacity=1)], ticket_types=[dict(FREE, quantity=None)], tickets=[
        {"id": "x", "event_id": "ev-1", "ticket_type_id": "tt-free", "user_id": "z", "status": "valid"},
    ], orders=[])
    r = run(db, ATTENDEE, "post", "/api/events/ev-1/register", json={"ticket_type_id": "tt-free"})
    assert r.status_code == 400 and "capacity" in r.json()["detail"]

    db = FakeDB(events=[event(registration_closes_at=iso(-1))], ticket_types=[dict(FREE)], tickets=[], orders=[])
    r = run(db, ATTENDEE, "post", "/api/events/ev-1/register", json={"ticket_type_id": "tt-free"})
    assert r.status_code == 400 and "closed" in r.json()["detail"]


def test_hidden_ticket_type_cannot_be_bought():
    db = FakeDB(events=[event()], ticket_types=[dict(HIDDEN)], tickets=[], orders=[])
    assert run(db, ATTENDEE, "post", "/api/events/ev-1/register", json={"ticket_type_id": "tt-hidden"}).status_code == 404


# --- my tickets -----------------------------------------------------------

def test_my_tickets_only_returns_own_tickets_with_statuses():
    tickets = [
        {"id": "t1", "user_id": "att-1", "event_id": "ev-1", "ticket_type_id": "tt-free", "order_id": "o1", "status": "valid"},
        {"id": "t2", "user_id": "att-1", "event_id": "ev-1", "ticket_type_id": "tt-free", "order_id": "o2", "status": "checked_in"},
        {"id": "t3", "user_id": "att-1", "event_id": "ev-1", "ticket_type_id": "tt-paid", "order_id": "o3", "status": "refunded"},
        {"id": "t4", "user_id": "att-1", "event_id": "ev-1", "ticket_type_id": "tt-paid", "order_id": "o4", "status": "cancelled"},
        {"id": "t9", "user_id": "att-2", "event_id": "ev-1", "ticket_type_id": "tt-free", "order_id": "o9", "status": "valid"},
    ]
    orders = [{"id": f"o{i}", "user_id": "att-1", "total_amount": 0} for i in (1, 2, 3, 4)]
    db = FakeDB(events=[event()], ticket_types=[dict(FREE), dict(PAID)], tickets=tickets, orders=orders, support_cases=[])
    r = run(db, ATTENDEE, "get", "/api/me/tickets")
    assert r.status_code == 200
    by_id = {t["id"]: t for t in r.json()}
    assert set(by_id) == {"t1", "t2", "t3", "t4"}
    assert {k: v["status"] for k, v in by_id.items()} == {
        "t1": "ACTIVE", "t2": "USED", "t3": "REFUNDED", "t4": "CANCELLED",
    }
    assert by_id["t1"]["qr_payload"] and by_id["t3"]["qr_payload"] is None
