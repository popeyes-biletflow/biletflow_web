"""FS-18: owner-scoped orders/tickets and the server-generated A4 PDF."""
import os

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_KEY", "dummy-key")
os.environ.setdefault("QR_SECRET", "test-secret")

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import main
from main import app
from deps import get_current_user
from schemas import CurrentUser
from crypto import verify_hmac_signature
from tests.fakedb import FakeDB

client = TestClient(app)

USER = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"
EVENT = "33333333-3333-3333-3333-333333333333"
SOON = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()


@pytest.fixture(autouse=True)
def as_attendee():
    user = CurrentUser(id=USER, email="demo@example.com", full_name="Демо Қатысушы", role="attendee", access_token="t")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[main.get_current_user] = lambda: user
    yield
    app.dependency_overrides.clear()


def make_db():
    return FakeDB(
        events=[{"id": EVENT, "title": "Наурыз концерті", "status": "published", "starts_at": SOON, "ends_at": SOON,
                 "timezone": "Asia/Almaty", "venue_name": "Astana Arena", "venue_address": "Қабанбай батыр 45"}],
        ticket_types=[{"id": "tt1", "name": "VIP", "price": 10000}],
        orders=[
            {"id": "o1", "user_id": USER, "event_id": EVENT, "ticket_type_id": "tt1", "quantity": 2,
             "subtotal_kzt": 20000, "discount_kzt": 2000, "fee_kzt": 900, "total_amount": 18900,
             "status": "paid", "created_at": "2026-11-20T10:00:00+00:00"},
            {"id": "o2", "user_id": OTHER, "event_id": EVENT, "ticket_type_id": "tt1", "quantity": 1,
             "total_amount": 10000, "status": "paid", "created_at": "2026-11-20T11:00:00+00:00"},
        ],
        tickets=[
            {"id": "t-valid", "order_id": "o1", "user_id": USER, "event_id": EVENT, "ticket_type_id": "tt1",
             "status": "valid", "attendee_name": "Айгерім"},
            {"id": "t-refunded", "order_id": "o1", "user_id": USER, "event_id": EVENT, "ticket_type_id": "tt1",
             "status": "refunded", "attendee_name": None},
            {"id": "t-other", "order_id": "o2", "user_id": OTHER, "event_id": EVENT, "ticket_type_id": "tt1",
             "status": "valid"},
        ],
        promo_codes=[], support_cases=[],
    )


def get(url, db):
    with patch("routers.my_orders.db_for_user", return_value=db), patch.object(main, "db_for_user", lambda _t: db):
        return client.get(url)


def test_orders_are_owner_scoped_and_totals_not_doubled():
    r = get("/api/me/orders", make_db())
    assert r.status_code == 200
    orders = r.json()
    assert [o["id"] for o in orders] == ["o1"]
    assert orders[0]["breakdown_kzt"] == {"subtotal": 20000, "discount": 2000, "fee": 900, "total": 18900}
    assert len(orders[0]["tickets"]) == 2


def test_refunded_ticket_is_invalid_and_has_no_qr():
    tickets = {t["id"]: t for t in get("/api/me/orders", make_db()).json()[0]["tickets"]}
    assert tickets["t-refunded"]["status"] == "REFUNDED"
    assert tickets["t-refunded"]["qr_payload"] is None
    assert tickets["t-valid"]["status"] == "ACTIVE"
    ok, _, parsed = verify_hmac_signature(tickets["t-valid"]["qr_payload"])
    assert ok and parsed["ticket_id"] == "t-valid"


def test_single_ticket_matches_list_and_falls_back_to_buyer_name():
    db = make_db()
    one = get("/api/me/tickets/t-valid", db).json()
    flat = {t["id"]: t for t in get("/api/me/tickets", db).json()}
    assert one["qr_payload"] == flat["t-valid"]["qr_payload"]  # screen and PDF use the same signed QR
    assert one["attendee_name"] == "Айгерім"
    assert flat["t-refunded"]["attendee_name"] == "Демо Қатысушы"


def test_foreign_ticket_is_not_found():
    assert get("/api/me/tickets/t-other", make_db()).status_code == 404
    assert get("/api/me/tickets/t-other/pdf", make_db()).status_code == 404


@pytest.mark.parametrize("lang", ["ru", "kk", "en"])
def test_pdf_download(lang):
    r = get(f"/api/me/tickets/t-valid/pdf?lang={lang}", make_db())
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert "attachment" in r.headers["content-disposition"]
    assert r.content.startswith(b"%PDF")
    assert len(r.content) > 5000


def test_pdf_has_no_email_or_payment_data():
    from ticket_pdf import render_ticket_pdf
    import zlib, re

    pdf = render_ticket_pdf({
        "id": "t-valid", "status": "ACTIVE", "event_title": "Demo", "starts_at": SOON, "timezone": "Asia/Almaty",
        "venue_name": "Hall", "venue_address": "", "ticket_type": "VIP", "attendee_name": "Demo", "seat": None,
        "qr_payload": "t-valid:e:u:1:sig", "promo_code": "SECRET", "order_total_kzt": 18900,
    }, "en")
    text = b""
    for stream in re.findall(rb"stream\r?\n(.*?)\r?\nendstream", pdf, re.S):
        try:
            text += zlib.decompress(stream)
        except zlib.error:
            pass
    assert b"demo@example.com" not in text and b"18900" not in text and b"SECRET" not in text
