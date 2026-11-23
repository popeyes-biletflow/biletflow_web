"""Заказы посетителя (FS-17 / FS-18).

GET /api/me/orders             - все мои заказы с билетами
GET /api/me/orders/{order_id}  - один заказ (страница после оплаты)

Запросы идут с токеном пользователя, поэтому RLS отдаёт только его строки.
Чужой order_id просто не найдётся (404).
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from crypto import ticket_qr_payload
from deps import db_for_user, get_current_user, sanitize_error
from schemas import CurrentUser
from ticket_pdf import render_ticket_pdf

router = APIRouter(prefix="/api/me", tags=["my-orders"])


def ticket_state(ticket, event, refund_case):
    status = (ticket.get("status") or "").lower()
    if status == "refunded":
        return "REFUNDED"
    if status == "cancelled" or event.get("status") == "cancelled":
        return "CANCELLED"
    if status in ("checked_in", "used"):
        return "USED"
    if refund_case and refund_case.get("status") != "RESOLVED":
        return "CANCEL_PENDING"
    return "ACTIVE"


def first_set(row, *keys):
    # у новых заказов колонки *_kzt, у старых (через /register) *_amount
    for k in keys:
        if row.get(k) is not None:
            return row[k]
    return None


def load_orders(db, user, order_id=None):
    q = db.table("orders").select("*").eq("user_id", user.id)
    if order_id:
        q = q.eq("id", order_id)
    orders = q.execute().data or []
    if not orders:
        return []

    order_ids = [str(o["id"]) for o in orders]
    tickets = db.table("tickets").select("*").in_("order_id", order_ids).execute().data or []

    # у старых заказов нет event_id и ticket_type_id, берём их из билетов
    event_ids = set()
    type_ids = set()
    promo_ids = set()
    for o in orders:
        if o.get("event_id"):
            event_ids.add(str(o["event_id"]))
        if o.get("ticket_type_id"):
            type_ids.add(str(o["ticket_type_id"]))
        if o.get("promo_code_id"):
            promo_ids.add(str(o["promo_code_id"]))
    for t in tickets:
        event_ids.add(str(t["event_id"]))
        if t.get("ticket_type_id"):
            type_ids.add(str(t["ticket_type_id"]))

    events = {}
    if event_ids:
        for e in db.table("events").select("*").in_("id", list(event_ids)).execute().data or []:
            events[str(e["id"])] = e
    types = {}
    if type_ids:
        for tt in db.table("ticket_types").select("*").in_("id", list(type_ids)).execute().data or []:
            types[str(tt["id"])] = tt
    promos = {}
    if promo_ids:
        for p in db.table("promo_codes").select("id, code").in_("id", list(promo_ids)).execute().data or []:
            promos[str(p["id"])] = p

    # запросы на отмену = обращения в поддержку с категорией refund
    last_case = {}
    if tickets:
        cases = (
            db.table("support_cases").select("id, ticket_id, status, created_at")
            .eq("requester_id", user.id).eq("category", "refund").in_("ticket_id", [str(t["id"]) for t in tickets])
            .execute().data or []
        )
        for c in sorted(cases, key=lambda c: str(c.get("created_at") or "")):
            last_case[str(c["ticket_id"])] = c

    result = []
    for o in orders:
        oid = str(o["id"])
        my_tickets = [t for t in tickets if str(t.get("order_id")) == oid]
        my_tickets.sort(key=lambda t: str(t["id"]))

        event_id = str(o.get("event_id") or (my_tickets[0]["event_id"] if my_tickets else ""))
        event = events.get(event_id, {})
        type_id = str(o.get("ticket_type_id") or (my_tickets[0].get("ticket_type_id") if my_tickets else ""))
        ttype = types.get(type_id, {})
        price = int(ttype.get("price") or 0)
        qty = int(o.get("quantity") or len(my_tickets) or 1)

        subtotal = first_set(o, "subtotal_kzt", "subtotal_amount")
        discount = first_set(o, "discount_kzt", "discount_amount")
        fee = first_set(o, "fee_kzt", "fee_amount")
        total = o.get("total_amount")
        promo_code = promos.get(str(o.get("promo_code_id")), {}).get("code") or o.get("promo_code")

        out_tickets = []
        for t in my_tickets:
            tid = str(t["id"])
            case = last_case.get(tid)
            state = ticket_state(t, event, case)
            seat_parts = [str(t[k]) for k in ("section", "row", "seat") if t.get(k)]
            qr = None
            if state in ("ACTIVE", "CANCEL_PENDING"):  # QR только для действующих билетов
                qr = ticket_qr_payload(tid, str(t["event_id"]), user.id, event)[0]
            out_tickets.append({
                "id": tid,
                "status": state,
                "attendee_name": t.get("attendee_name"),
                "seat": " · ".join(seat_parts) or None,
                "checked_in_at": t.get("checked_in_at"),
                "refund_case_id": str(case["id"]) if case else None,
                "qr_payload": qr,
            })

        result.append({
            "id": oid,
            "status": o.get("status"),
            "created_at": o.get("created_at"),
            "event": {
                "id": event_id,
                "title": event.get("title") or "—",
                "status": event.get("status"),
                "starts_at": event.get("starts_at"),
                "ends_at": event.get("ends_at"),
                "timezone": event.get("timezone") or "Asia/Almaty",
                "venue_name": event.get("venue_name") or "",
                "venue_address": event.get("venue_address") or "",
            },
            "ticket_type": {"id": type_id, "name": ttype.get("name") or "—", "price_kzt": price},
            "quantity": qty,
            "breakdown_kzt": {
                "subtotal": int(subtotal if subtotal is not None else price * qty),
                "discount": int(discount or 0),
                "fee": int(fee or 0),
                "total": int(total if total is not None else price * qty),
            },
            "promo_code": promo_code,
            "simulated_payment": True,
            "tickets": out_tickets,
        })

    result.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
    return result


@router.get("/orders")
async def my_orders(current_user: CurrentUser = Depends(get_current_user)):
    db = db_for_user(current_user.access_token)
    try:
        return load_orders(db, current_user)
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.get("/orders/{order_id}")
async def my_order(order_id: str, current_user: CurrentUser = Depends(get_current_user)):
    db = db_for_user(current_user.access_token)
    try:
        rows = load_orders(db, current_user, order_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error(e))
    if not rows:
        raise HTTPException(status_code=404, detail="Order not found.")
    return rows[0]


# FS-18: один билет и PDF для печати

def flat_tickets(orders, user):
    # билеты из заказов одним списком (формат /api/me/tickets)
    out = []
    for o in orders:
        ev = o["event"]
        for t in o["tickets"]:
            out.append({
                "id": t["id"],
                "order_id": o["id"],
                "event_id": ev["id"],
                "event_title": ev["title"],
                "event_status": ev["status"],
                "starts_at": ev["starts_at"],
                "ends_at": ev["ends_at"],
                "timezone": ev["timezone"],
                "venue_name": ev["venue_name"],
                "venue_address": ev["venue_address"],
                "ticket_type": o["ticket_type"]["name"],
                "attendee_name": t["attendee_name"] or user.full_name or user.email,
                "seat": t["seat"],
                "status": t["status"],
                "checked_in_at": t["checked_in_at"],
                "refund_case_id": t["refund_case_id"],
                "qr_payload": t["qr_payload"],
                "purchased_at": o["created_at"],
                "promo_code": o["promo_code"],
                "order_total_kzt": o["breakdown_kzt"]["total"],  # сумма за весь заказ
            })
    return out


def load_one_ticket(db, user, ticket_id):
    rows = db.table("tickets").select("id, order_id").eq("id", ticket_id).eq("user_id", user.id).execute().data or []
    if not rows or not rows[0].get("order_id"):
        raise HTTPException(status_code=404, detail="Ticket not found.")
    orders = load_orders(db, user, str(rows[0]["order_id"]))
    for t in flat_tickets(orders, user):
        if t["id"] == str(ticket_id):
            return t
    raise HTTPException(status_code=404, detail="Ticket not found.")


@router.get("/tickets/{ticket_id}")
async def my_ticket(ticket_id: str, current_user: CurrentUser = Depends(get_current_user)):
    db = db_for_user(current_user.access_token)
    try:
        return load_one_ticket(db, current_user, ticket_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.get("/tickets/{ticket_id}/pdf")
async def my_ticket_pdf(ticket_id: str, lang: str = "ru", current_user: CurrentUser = Depends(get_current_user)):
    db = db_for_user(current_user.access_token)
    try:
        ticket = load_one_ticket(db, current_user, ticket_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error(e))

    if lang not in ("ru", "kk", "en"):
        lang = "ru"
    pdf = render_ticket_pdf(ticket, lang)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="biletflow-ticket-{ticket_id[:8]}.pdf"',
            "Cache-Control": "no-store",
        },
    )
