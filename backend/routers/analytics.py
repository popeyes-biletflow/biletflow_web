"""PB-19: дашборд и аналитика организатора.

GET /api/organizer/dashboard
    все события организатора с продажами, выручкой, промокодами и check-in + общие итоги
GET /api/organizer/events/{event_id}/analytics?date_from=&date_to=&ticket_type_id=
    подробная аналитика одного события

Организатор видит только свои события (events.organizer_id). Запросы идут с его JWT,
поэтому в Supabase нужны RLS-политики из migrations/pb19_orders_pricing_and_analytics.sql
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from analytics import compute_event_analytics, summarize_events
from deps import db_for_user, get_current_user
from schemas import CurrentUser, ROLE_ORGANIZER

router = APIRouter(prefix="/api/organizer", tags=["organizer-analytics"])


def check_organizer(user: CurrentUser):
    if (user.role or "").strip().lower() != ROLE_ORGANIZER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organizer role required.")


def load_data(db, event_ids):
    """Типы билетов, билеты и заказы для списка событий."""
    if not event_ids:
        return [], [], {}
    types = db.table("ticket_types").select("*").in_("event_id", event_ids).execute().data or []
    tickets = (
        db.table("tickets")
        .select("id, order_id, ticket_type_id, event_id, status, checked_in_at")
        .in_("event_id", event_ids)
        .execute()
        .data
        or []
    )
    order_ids = list({str(t["order_id"]) for t in tickets if t.get("order_id")})
    orders = {}
    # режем на куски, чтобы URL не получился слишком длинным
    for i in range(0, len(order_ids), 150):
        chunk = order_ids[i:i + 150]
        for o in db.table("orders").select("*").in_("id", chunk).execute().data or []:
            orders[str(o["id"])] = o
    return types, tickets, orders


@router.get("/dashboard")
async def organizer_dashboard(current_user: CurrentUser = Depends(get_current_user)):
    check_organizer(current_user)
    db = db_for_user(current_user.access_token)
    try:
        events = db.table("events").select("*").eq("organizer_id", current_user.id).execute().data or []
        types, tickets, orders = load_data(db, [str(e["id"]) for e in events])
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    rows = []
    for ev in events:
        eid = str(ev["id"])
        ev_types = [t for t in types if str(t["event_id"]) == eid]
        ev_tickets = [t for t in tickets if str(t["event_id"]) == eid]
        rows.append(compute_event_analytics(ev, ev_types, ev_tickets, orders))

    rows.sort(key=lambda r: str(r["event"]["starts_at"] or ""), reverse=True)

    # в списке график по дням не нужен, убираем чтобы ответ был меньше
    short = []
    for r in rows:
        short.append({k: v for k, v in r.items() if k != "sales_over_time"})

    return {"totals": summarize_events(rows), "events": short}


@router.get("/events/{event_id}/analytics")
async def event_analytics(
    event_id: str,
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    ticket_type_id: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    check_organizer(current_user)
    if date_from and date_to and date_to < date_from:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="date_to must not be before date_from.")

    db = db_for_user(current_user.access_token)
    try:
        res = db.table("events").select("*").eq("id", event_id).execute()
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    if not res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

    event = res.data[0]
    if str(event.get("organizer_id", "")) != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not manage this event.")

    try:
        types, tickets, orders = load_data(db, [event_id])
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    if ticket_type_id and not any(str(t["id"]) == ticket_type_id for t in types):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket type not found for this event.")

    return compute_event_analytics(
        event, types, tickets, orders,
        date_from=date_from, date_to=date_to, ticket_type_id=ticket_type_id,
    )
