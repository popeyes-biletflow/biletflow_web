from fastapi import APIRouter, Depends, Query

from deps import db_for_user, get_current_user
from promo import call_rpc, require_organizer
from schemas import CurrentUser
from datetime import date, datetime
from fastapi import HTTPException

router = APIRouter(prefix="/api/organizer", tags=["organizer-finance"])


@router.get("/payout-estimate")
async def payout_estimate(
    event_id: str | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    require_organizer(user)
    db = db_for_user(user.access_token)
    return call_rpc(db, "organizer_payout_estimate", {"p_event_id": event_id})


@router.get("/events/{event_id}/attendees")
async def event_attendees(
    event_id: str,
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(get_current_user),
):
    require_organizer(user)
    db = db_for_user(user.access_token)
    return call_rpc(db, "organizer_attendees", {
        "p_event_id": event_id,
        "p_status": status,
        "p_limit": limit,
        "p_offset": offset,
    })

@router.get("/events/{event_id}/metrics")
async def event_metrics(
    event_id: str,
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    ticket_type_id: str | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    require_organizer(user)
    if date_from and date_to and date_to < date_from:
        raise HTTPException(400, "date_to must not be before date_from.")
    db = db_for_user(user.access_token)
    return call_rpc(db, "event_metrics", {
        "p_event_id": event_id,
        "p_date_from": date_from.isoformat() if date_from else None,
        "p_date_to": date_to.isoformat() if date_to else None,
        "p_ticket_type_id": ticket_type_id,
    })


@router.get("/events/{event_id}/activity")
async def event_activity(
    event_id: str,
    action: str | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(get_current_user),
):
    require_organizer(user)
    db = db_for_user(user.access_token)
    return call_rpc(db, "event_activity", {
        "p_event_id": event_id,
        "p_action": action,
        "p_from": date_from.isoformat() if date_from else None,
        "p_to": date_to.isoformat() if date_to else None,
        "p_limit": limit,
        "p_offset": offset,
    })