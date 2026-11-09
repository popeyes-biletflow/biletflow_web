"""PB-19: аналитика для организатора.

Здесь только функции, которые работают с обычными dict (без Supabase),
поэтому их легко тестировать. Роутер в routers/analytics.py достаёт данные
из базы и передаёт сюда.

- ticket_types.quantity = вместимость типа билета (None = без лимита)
- билет считается проданным, если статус не cancelled / refunded
- суммы берём из заказа; у старых заказов нет subtotal_amount, тогда берём цену типа билета
"""
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None

VOID = ("cancelled", "refunded")
CHECKED_IN = ("checked_in", "used")


def parse_ts(raw):
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def local_day(dt, tz_name):
    # день продажи считаем по часовому поясу события
    if ZoneInfo:
        try:
            return dt.astimezone(ZoneInfo(tz_name)).date()
        except Exception:
            pass
    return dt.astimezone(timezone.utc).date()


def event_phase(event, now=None):
    """upcoming / active / completed / cancelled"""
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


def percent(part, whole):
    if not whole:
        return None
    return round(part * 100 / whole, 1)


def compute_event_analytics(event, ticket_types, tickets, orders,
                            date_from=None, date_to=None, ticket_type_id=None, now=None):
    tz_name = event.get("timezone") or "Asia/Almaty"

    # фильтр по типу билета
    types = [t for t in ticket_types if ticket_type_id is None or str(t["id"]) == str(ticket_type_id)]
    type_by_id = {str(t["id"]): t for t in types}
    tickets = [t for t in tickets if str(t.get("ticket_type_id")) in type_by_id]

    def get_order(t):
        return orders.get(str(t.get("order_id")), {})

    def sale_day(t):
        ts = parse_ts(get_order(t).get("created_at"))
        return local_day(ts, tz_name) if ts else None

    def in_range(t):
        if date_from is None and date_to is None:
            return True
        day = sale_day(t)
        if day is None:
            return False
        if date_from and day < date_from:
            return False
        if date_to and day > date_to:
            return False
        return True

    def money(t):
        """(subtotal, discount, fee, total) по заказу билета"""
        o = get_order(t)
        price = int(type_by_id.get(str(t.get("ticket_type_id")), {}).get("price") or 0)
        subtotal = int(o["subtotal_amount"]) if o.get("subtotal_amount") is not None else price
        discount = int(o.get("discount_amount") or 0)
        fee = int(o.get("fee_amount") or 0)
        if o.get("total_amount") is not None:
            total = int(o["total_amount"])
        else:
            total = subtotal - discount + fee
        return subtotal, discount, fee, total

    def status(t):
        return (t.get("status") or "").lower()

    valid = [t for t in tickets if status(t) not in VOID]
    refunded = [t for t in tickets if status(t) == "refunded"]
    cancelled = [t for t in tickets if status(t) == "cancelled"]
    checked_in = [t for t in valid if status(t) in CHECKED_IN]

    # вместимость
    if not types or any(t.get("quantity") is None for t in types):
        capacity = None
    else:
        capacity = sum(int(t["quantity"]) for t in types)
    if ticket_type_id is None and event.get("capacity"):
        if capacity is None:
            capacity = int(event["capacity"])
        else:
            capacity = min(capacity, int(event["capacity"]))
    sold = len(valid)
    remaining = None if capacity is None else max(capacity - sold, 0)

    # выручка (только за выбранный период)
    sold_in_range = [t for t in valid if in_range(t)]
    refunded_in_range = [t for t in refunded if in_range(t)]
    gross = 0
    discounts = 0
    fees = 0
    for t in sold_in_range + refunded_in_range:
        s, d, f, _ = money(t)
        gross += s
        discounts += d
        fees += f
    refunds_total = sum(money(t)[3] for t in refunded_in_range)
    net = gross - discounts - refunds_total

    # продажи по дням
    per_day = {}
    for t in sold_in_range:
        day = sale_day(t)
        if day is None:
            continue
        s, d, _, _ = money(t)
        if day not in per_day:
            per_day[day] = {"tickets": 0, "revenue_kzt": 0}
        per_day[day]["tickets"] += 1
        per_day[day]["revenue_kzt"] += s - d

    sales_over_time = []
    total_so_far = 0
    for day in sorted(per_day):
        total_so_far += per_day[day]["tickets"]
        sales_over_time.append({
            "date": day.isoformat(),
            "tickets": per_day[day]["tickets"],
            "revenue_kzt": per_day[day]["revenue_kzt"],
            "cumulative_tickets": total_so_far,
        })

    # по типам билетов
    by_type = []
    for tt in types:
        tid = str(tt["id"])
        type_valid = [t for t in valid if str(t.get("ticket_type_id")) == tid]
        revenue = sum(money(t)[0] - money(t)[1] for t in type_valid if in_range(t))
        cap = tt.get("quantity")
        by_type.append({
            "ticket_type_id": tid,
            "name": tt.get("name") or "—",
            "price_kzt": int(tt.get("price") or 0),
            "capacity": cap,
            "sold": len(type_valid),
            "remaining": None if cap is None else max(int(cap) - len(type_valid), 0),
            "percent_sold": percent(len(type_valid), cap),
            "revenue_kzt": revenue,
            "checked_in": sum(1 for t in type_valid if status(t) in CHECKED_IN),
            "is_hidden": bool(tt.get("is_hidden")),
        })

    # промокоды (берём из orders.promo_code)
    promo = {}
    for t in sold_in_range:
        code = get_order(t).get("promo_code")
        if not code:
            continue
        s, d, _, _ = money(t)
        if code not in promo:
            promo[code] = {"code": code, "redemptions": 0, "tickets": 0,
                           "gross_kzt": 0, "discount_kzt": 0, "net_kzt": 0}
        promo[code]["redemptions"] += 1
        promo[code]["tickets"] += 1
        promo[code]["gross_kzt"] += s
        promo[code]["discount_kzt"] += d
        promo[code]["net_kzt"] += s - d
    campaigns = sorted(promo.values(), key=lambda c: c["tickets"], reverse=True)

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
            "percent_sold": percent(sold, capacity),
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
            "percent_checked_in": percent(len(checked_in), sold),
        },
        "cancellations": {"cancelled": len(cancelled), "refunded": len(refunded)},
        "sales_over_time": sales_over_time,
        "by_ticket_type": by_type,
        "campaigns": campaigns,
    }


def summarize_events(rows):
    """Общие итоги по всем событиям организатора (шапка дашборда)."""
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
        totals["gross_kzt"] += r["revenue"]["gross_kzt"]
        totals["discounts_kzt"] += r["revenue"]["discounts_kzt"]
        totals["refunds_kzt"] += r["revenue"]["refunds_kzt"]
        totals["net_kzt"] += r["revenue"]["net_kzt"]
        totals["checked_in"] += r["attendance"]["checked_in"]
        for c in r["campaigns"]:
            totals["promo_redemptions"] += c["redemptions"]
    totals["percent_checked_in"] = percent(totals["checked_in"], totals["tickets_sold"])
    return totals
