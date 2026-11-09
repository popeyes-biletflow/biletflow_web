"""PB-19: unit tests for the pure analytics functions (no Supabase needed)."""
from datetime import date, datetime, timezone

from analytics import compute_event_analytics, event_phase, summarize_events

NOW = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)

EVENT = {
    "id": "ev1",
    "title": "Demo Fest",
    "status": "published",
    "starts_at": "2026-12-01T14:00:00+00:00",
    "ends_at": "2026-12-01T18:00:00+00:00",
    "timezone": "UTC",
    "capacity": None,
}
TYPES = [
    {"id": "std", "event_id": "ev1", "name": "Standard", "price": 5000, "quantity": 10},
    {"id": "vip", "event_id": "ev1", "name": "VIP", "price": 20000, "quantity": 2},
]
ORDERS = {
    "o1": {"id": "o1", "subtotal_amount": 5000, "discount_amount": 0, "fee_amount": 250, "total_amount": 5250,
           "created_at": "2026-11-01T10:00:00+00:00"},
    "o2": {"id": "o2", "subtotal_amount": 5000, "discount_amount": 1000, "fee_amount": 200, "total_amount": 4200,
           "promo_code": "FALL20", "created_at": "2026-11-01T15:00:00+00:00"},
    "o3": {"id": "o3", "subtotal_amount": 20000, "discount_amount": 4000, "fee_amount": 800, "total_amount": 16800,
           "promo_code": "FALL20", "created_at": "2026-11-03T09:00:00+00:00"},
    "o4": {"id": "o4", "subtotal_amount": 5000, "discount_amount": 0, "fee_amount": 250, "total_amount": 5250,
           "created_at": "2026-11-04T09:00:00+00:00"},
    # legacy order without the PB-19 pricing columns
    "o5": {"id": "o5", "total_amount": 5000, "created_at": "2026-11-05T09:00:00+00:00"},
}
TICKETS = [
    {"id": "t1", "order_id": "o1", "ticket_type_id": "std", "event_id": "ev1", "status": "checked_in"},
    {"id": "t2", "order_id": "o2", "ticket_type_id": "std", "event_id": "ev1", "status": "valid"},
    {"id": "t3", "order_id": "o3", "ticket_type_id": "vip", "event_id": "ev1", "status": "valid"},
    {"id": "t4", "order_id": "o4", "ticket_type_id": "std", "event_id": "ev1", "status": "refunded"},
    {"id": "t5", "order_id": "o5", "ticket_type_id": "std", "event_id": "ev1", "status": "valid"},
]


def run(**kw):
    return compute_event_analytics(EVENT, TYPES, TICKETS, ORDERS, now=NOW, **kw)


def test_capacity_and_percent_sold():
    a = run()
    assert a["capacity"] == {"total": 12, "sold": 4, "remaining": 8, "percent_sold": 33.3}


def test_revenue_breakdown_includes_refunds():
    r = run()["revenue"]
    # gross counts sold + refunded orders; legacy order falls back to the ticket-type price
    assert r["gross_kzt"] == 5000 + 5000 + 20000 + 5000 + 5000
    assert r["discounts_kzt"] == 5000
    assert r["refunds_kzt"] == 5250
    assert r["net_kzt"] == r["gross_kzt"] - 5000 - 5250
    assert r["simulated"] is True


def test_attendance():
    a = run()["attendance"]
    assert a == {"registered": 4, "checked_in": 1, "absent": 3, "percent_checked_in": 25.0}


def test_sales_over_time_is_cumulative_and_sorted():
    series = run()["sales_over_time"]
    assert [d["date"] for d in series] == ["2026-11-01", "2026-11-03", "2026-11-05"]
    assert [d["cumulative_tickets"] for d in series] == [2, 3, 4]
    assert series[0]["revenue_kzt"] == 5000 + 4000


def test_campaigns_grouped_by_promo_code():
    (c,) = run()["campaigns"]
    assert c == {"code": "FALL20", "redemptions": 2, "tickets": 2,
                 "gross_kzt": 25000, "discount_kzt": 5000, "net_kzt": 20000}


def test_date_range_filter():
    a = run(date_from=date(2026, 11, 2), date_to=date(2026, 11, 4))
    assert [d["date"] for d in a["sales_over_time"]] == ["2026-11-03"]
    assert a["revenue"]["gross_kzt"] == 20000 + 5000  # o3 sold + o4 refunded
    # capacity / attendance are not time-based
    assert a["capacity"]["sold"] == 4


def test_ticket_type_filter():
    a = run(ticket_type_id="vip")
    assert a["capacity"] == {"total": 2, "sold": 1, "remaining": 1, "percent_sold": 50.0}
    assert [t["name"] for t in a["by_ticket_type"]] == ["VIP"]


def test_unlimited_capacity():
    types = [dict(TYPES[0], quantity=None)]
    a = compute_event_analytics(EVENT, types, TICKETS, ORDERS, now=NOW)
    assert a["capacity"]["total"] is None
    assert a["capacity"]["percent_sold"] is None


def test_event_capacity_caps_ticket_type_sum():
    a = compute_event_analytics(dict(EVENT, capacity=5), TYPES, TICKETS, ORDERS, now=NOW)
    assert a["capacity"]["total"] == 5


def test_event_phase():
    assert event_phase(EVENT, NOW) == "upcoming"
    assert event_phase(EVENT, datetime(2026, 12, 1, 15, tzinfo=timezone.utc)) == "active"
    assert event_phase(EVENT, datetime(2026, 12, 2, tzinfo=timezone.utc)) == "completed"
    assert event_phase(dict(EVENT, status="cancelled"), NOW) == "cancelled"


def test_summary_totals():
    a = run()
    s = summarize_events([a, a])
    assert s["events"] == 2
    assert s["tickets_sold"] == 8
    assert s["capacity"] == 24
    assert s["by_phase"]["upcoming"] == 2
    assert s["promo_redemptions"] == 4
    assert s["percent_checked_in"] == 25.0
