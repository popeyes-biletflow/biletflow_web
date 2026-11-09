"""PB-19: Organizer Event Dashboard & Analytics.

GET /api/organizer/dashboard
    Every event the organizer manages, classified Upcoming / Active /
    Completed / Cancelled, with capacity, sales, KZT revenue, promo
    redemptions and check-in rate, plus totals across all events.

GET /api/organizer/events/{event_id}/analytics?date_from=&date_to=&ticket_type_id=
    Detailed analytics for one event: sales over time, by ticket type,
    campaigns, attendance. ``date_from`` / ``date_to`` are YYYY-MM-DD in the
    event's time zone and filter sales by order timestamp.

Organizers only see events where ``events.organizer_id`` is their own id
(SRS 4.15). Reads go through the caller's JWT, so Supabase RLS must allow an
organizer to read tickets and orders of their own events — see
``migrations/pb19_orders_pricing_and_analytics.sql``.
"""
from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from analytics import compute_event_analytics, summarize_events
from deps import db_for_user, get_current_user
from schemas import CurrentUser, ROLE_ORGANIZER

router = APIRouter(prefix="/api/organizer", tags=["organizer-analytics"])


def _require_organizer(user: CurrentUser) -> None:
    if (user.role or "").strip().lower() != ROLE_ORGANIZER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organizer role required.")


def _load_related(db: Any, event_ids: list[str]) -> tuple[list[dict], list[dict], dict[str, dict]]:
    """Ticket types, tickets and orders for a set of events (3 queries in total)."""
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
    orders: dict[str, dict] = {}
    # Keep the IN-list reasonably short for PostgREST URLs.
    for i in range(0, len(order_ids), 150):
        chunk = order_ids[i : i + 150]
        for o in db.table("orders").select("*").in_("id", chunk).execute().data or []:
            orders[str(o["id"])] = o
    return types, tickets, orders


@router.get("/dashboard")
async def organizer_dashboard(current_user: CurrentUser = Depends(get_current_user)):
    _require_organizer(current_user)
    db = db_for_user(current_user.access_token)
    try:
        events = db.table("events").select("*").eq("organizer_id", current_user.id).execute().data or []
        types, tickets, orders = _load_related(db, [str(e["id"]) for e in events])
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))

    rows = []
    for ev in events:
        eid = str(ev["id"])
        rows.append(
            compute_event_analytics(
                ev,
                [t for t in types if str(t["event_id"]) == eid],
                [t for t in tickets if str(t["event_id"]) == eid],
                orders,
            )
        )
    rows.sort(key=lambda r: str(r["event"]["starts_at"] or ""), reverse=True)
    # The list view does not need the per-day series; keep the payload small.
    compact = [{k: v for k, v in r.items() if k != "sales_over_time"} for r in rows]
    return {"totals": summarize_events(rows), "events": compact}


@router.get("/events/{event_id}/analytics")
async def event_analytics(
    event_id: str,
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    ticket_type_id: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    _require_organizer(current_user)
    if date_from and date_to and date_to < date_from:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="date_to must not be before date_from.")
    db = db_for_user(current_user.access_token)
    try:
        res = db.table("events").select("*").eq("id", event_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
    if not res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")
    event = res.data[0]
    if str(event.get("organizer_id", "")) != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not manage this event.")
    try:
        types, tickets, orders = _load_related(db, [event_id])
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
    if ticket_type_id and not any(str(t["id"]) == ticket_type_id for t in types):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket type not found for this event.")
    return compute_event_analytics(
        event, types, tickets, orders,
        date_from=date_from, date_to=date_to, ticket_type_id=ticket_type_id,
    )
