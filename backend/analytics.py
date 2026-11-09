"""PB-19: organizer analytics computed from authoritative BiletFlow records.

Pure functions only (no Supabase / FastAPI imports) so they can be unit-tested
with plain dicts. The router in ``routers/analytics.py`` loads the rows and
passes them in.

Conventions
-----------
* ``ticket_types.quantity`` is the organizer-configured capacity of a type
  (same meaning as in the PB-21 organizer API). ``None`` means unlimited.
* A ticket counts as *sold* unless its status is ``cancelled`` / ``refunded``.
* Money values come from the order (``subtotal_amount`` / ``discount_amount``
  / ``fee_amount`` / ``total_amount``); for orders created before those
  columns existed the ticket-type price is used as the subtotal.
* All amounts are KZT integers and are demonstration (simulated) revenue.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Iterable, Optional

try:  # zoneinfo needs tzdata on Windows; fall back to UTC days if missing
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore

VOID_STATUSES = {"cancelled", "refunded"}
CHECKED_IN_STATUSES = {"checked_in", "used"}


def parse_ts(raw) -> Optional[datetime]:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _local_day(dt: datetime, tz_name: str) -> date:
    if ZoneInfo is not None:
        try:
            return dt.astimezone(ZoneInfo(tz_name)).date()
        except Exception:
            pass
    return dt.astimezone(timezone.utc).date()


def event_phase(event: dict, now: Optional[datetime] = None) -> str:
    """Classify an event as Upcoming / Active / Completed / Cancelled (SRS 4.16)."""
    if event.get("status") == "cancelled":
        return "cancelled"
    now = now or datetime.now(timezone.utc)
    starts = parse_ts(event.get("starts_at"))
    ends = parse_ts(event.get("ends_at")) or starts
    if starts and now < starts:
        return "upcoming"
    if ends and now > ends:
        return "completed"
    if starts:
        return "active"
    return "upcoming"


def _pct(part: int, whole: Optional[int]) -> Optional[float]:
    if not whole:
        return None
    return round(part * 100 / whole, 1)


def compute_event_analytics(
    event: dict,
    ticket_types: Iterable[dict],
    tickets: Iterable[dict],
    orders: dict[str, dict],
    *,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    ticket_type_id: Optional[str] = None,
    now: Optional[datetime] = None,
) -> dict:
    """Return the analytics payload for one event.

    ``date_from`` / ``date_to`` (inclusive, event-local days) filter sales by
    order timestamp. Capacity and attendance always describe the whole event
    (or the selected ticket type) because they are not time-based.
    """
    tz_name = event.get("timezone") or "Asia/Almaty"
    types = [t for t in ticket_types if ticket_type_id is None or str(t["id"]) == str(ticket_type_id)]
    type_by_id = {str(t["id"]): t for t in types}
    tickets = [t for t in tickets if str(t.get("ticket_type_id")) in type_by_id]

    def order_of(t: dict) -> dict:
        return orders.get(str(t.get("order_id")), {})

    def sale_day(t: dict) -> Optional[date]:
        ts = parse_ts(order_of(t).get("created_at"))
        return _local_day(ts, tz_name) if ts else None

    def in_range(t: dict) -> bool:
        if date_from is None and date_to is None:
            return True
        day = sale_day(t)
        if day is None:
            return False
        return (date_from is None or day >= date_from) and (date_to is None or day <= date_to)

    def money(t: dict) -> tuple[int, int, int, int]:
        """(subtotal, discount, fee, total) for the order behind a ticket."""
        o = order_of(t)
        price = int(type_by_id.get(str(t.get("ticket_type_id")), {}).get("price") or 0)
        subtotal = int(o["subtotal_amount"]) if o.get("subtotal_amount") is not None else price
        discount = int(o.get("discount_amount") or 0)
        fee = int(o.get("fee_amount") or 0)
        total = int(o["total_amount"]) if o.get("total_amount") is not None else subtotal - discount + fee
        return subtotal, discount, fee, total

    status_of = lambda t: (t.get("status") or "").lower()  # noqa: E731
    valid = [t for t in tickets if status_of(t) not in VOID_STATUSES]
    refunded = [t for t in tickets if status_of(t) == "refunded"]
    cancelled = [t for t in tickets if status_of(t) == "cancelled"]
    checked_in = [t for t in valid if status_of(t) in CHECKED_IN_STATUSES]

    # ---- capacity ------------------------------------------------------
    unlimited = any(t.get("quantity") is None for t in types)
    capacity = None if unlimited or not types else sum(int(t.get("quantity") or 0) for t in types)
    if ticket_type_id is None and event.get("capacity"):
        capacity = int(event["capacity"]) if capacity is None else min(capacity, int(event["capacity"]))
    sold = len(valid)
    remaining = None if capacity is None else max(capacity - sold, 0)

    # ---- revenue (filtered by sale date) -------------------------------
    sold_in_range = [t for t in valid if in_range(t)]
    refunded_in_range = [t for t in refunded if in_range(t)]
    gross = discounts = fees = 0
    for t in sold_in_range + refunded_in_range:
        s, d, f, _ = money(t)
        gross += s
        discounts += d
        fees += f
    refunds_total = sum(money(t)[3] for t in refunded_in_range)
    net = gross - discounts - refunds_total

    # ---- sales over time -----------------------------------------------
    per_day: dict[date, dict] = defaultdict(lambda: {"tickets": 0, "revenue_kzt": 0})
    for t in sold_in_range:
        day = sale_day(t)
        if day is None:
            continue
        s, d, _, _ = money(t)
        per_day[day]["tickets"] += 1
        per_day[day]["revenue_kzt"] += s - d
    sales_over_time = []
    cumulative = 0
    for day in sorted(per_day):
        cumulative += per_day[day]["tickets"]
        sales_over_time.append({"date": day.isoformat(), **per_day[day], "cumulative_tickets": cumulative})

    # ---- by ticket type --------------------------------------------------
    by_type = []
    for tt in types:
        tid = str(tt["id"])
        type_valid = [t for t in valid if str(t.get("ticket_type_id")) == tid]
        type_rev = sum(money(t)[0] - money(t)[1] for t in type_valid if in_range(t))
        cap = tt.get("quantity")
        by_type.append({
            "ticket_type_id": tid,
            "name": tt.get("name") or "—",
            "price_kzt": int(tt.get("price") or 0),
            "capacity": cap,
            "sold": len(type_valid),
            "remaining": None if cap is None else max(int(cap) - len(type_valid), 0),
            "percent_sold": _pct(len(type_valid), cap),
            "revenue_kzt": type_rev,
            "checked_in": sum(1 for t in type_valid if status_of(t) in CHECKED_IN_STATUSES),
            "is_hidden": bool(tt.get("is_hidden")),
        })

    # ---- promo campaigns (from order.promo_code) ------------------------
    promo: dict[str, dict] = {}
    for t in sold_in_range:
        code = order_of(t).get("promo_code")
        if not code:
            continue
        s, d, _, _ = money(t)
        row = promo.setdefault(code, {"code": code, "redemptions": 0, "tickets": 0,
                                      "gross_kzt": 0, "discount_kzt": 0, "net_kzt": 0})
        row["redemptions"] += 1
        row["tickets"] += 1
        row["gross_kzt"] += s
        row["discount_kzt"] += d
        row["net_kzt"] += s - d
    campaigns = sorted(promo.values(), key=lambda r: r["tickets"], reverse=True)

    return {
        "event": {
            "id": str(event.get("id")),
            "title": event.get("title"),
            "status": event.get("status"),
            "phase": event_phase(event, now),
            "starts_at": event.get("starts_at"),
            "ends_at": event.get("ends_at"),
            "timezone": tz_name,
            "paid_sales_status": event.get("paid_sales_status", "NONE"),
        },
        "filters": {
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
            "ticket_type_id": ticket_type_id,
        },
        "capacity": {
            "total": capacity,
            "sold": sold,
            "remaining": remaining,
            "percent_sold": _pct(sold, capacity),
        },
        "revenue": {
            "currency": "KZT",
            "simulated": True,
            "gross_kzt": gross,
            "discounts_kzt": discounts,
            "fees_kzt": fees,
            "refunds_kzt": refunds_total,
            "net_kzt": net,
            "orders": len({str(t.get("order_id")) for t in sold_in_range}),
        },
        "attendance": {
            "registered": sold,
            "checked_in": len(checked_in),
            "absent": sold - len(checked_in),
            "percent_checked_in": _pct(len(checked_in), sold),
        },
        "cancellations": {"cancelled": len(cancelled), "refunded": len(refunded)},
        "sales_over_time": sales_over_time,
        "by_ticket_type": by_type,
        "campaigns": campaigns,
    }


def summarize_events(rows: list[dict]) -> dict:
    """Totals across several ``compute_event_analytics`` results (unified dashboard header)."""
    totals = {
        "events": len(rows),
        "by_phase": {"upcoming": 0, "active": 0, "completed": 0, "cancelled": 0},
        "tickets_sold": 0,
        "capacity": 0,
        "capacity_unlimited_events": 0,
        "gross_kzt": 0,
        "discounts_kzt": 0,
        "refunds_kzt": 0,
        "net_kzt": 0,
        "checked_in": 0,
        "promo_redemptions": 0,
    }
    for r in rows:
        totals["by_phase"][r["event"]["phase"]] += 1
        totals["tickets_sold"] += r["capacity"]["sold"]
        if r["capacity"]["total"] is None:
            totals["capacity_unlimited_events"] += 1
        else:
            totals["capacity"] += r["capacity"]["total"]
        for k in ("gross_kzt", "discounts_kzt", "refunds_kzt", "net_kzt"):
            totals[k] += r["revenue"][k]
        totals["checked_in"] += r["attendance"]["checked_in"]
        totals["promo_redemptions"] += sum(c["redemptions"] for c in r["campaigns"])
    totals["percent_checked_in"] = _pct(totals["checked_in"], totals["tickets_sold"])
    return totals
