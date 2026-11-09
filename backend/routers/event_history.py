from datetime import date, datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from deps import db_for_user, get_current_user
from promo import call_rpc, require_organizer
from routers.analytics import event_analytics, organizer_dashboard
from schemas import CurrentUser

router = APIRouter(prefix="/api/organizer", tags=["organizer-history"])


class DuplicateIn(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    starts_at: datetime | None = None


@router.get("/analytics")
async def organizer_analytics(
    event_id: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    ticket_type_id: str | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    if event_id:
        return await event_analytics(
            event_id=event_id, date_from=date_from, date_to=date_to,
            ticket_type_id=ticket_type_id, current_user=user,
        )
    return await organizer_dashboard(current_user=user)


@router.get("/events/{event_id}/history")
async def event_history(event_id: str, user: CurrentUser = Depends(get_current_user)):
    require_organizer(user)
    db = db_for_user(user.access_token)
    return call_rpc(db, "event_history", {"p_event_id": event_id}) or []


@router.post("/events/{event_id}/duplicate", status_code=201)
async def duplicate_event(
    event_id: str,
    body: DuplicateIn | None = None,
    user: CurrentUser = Depends(get_current_user),
):
    require_organizer(user)
    db = db_for_user(user.access_token)
    body = body or DuplicateIn()
    return call_rpc(db, "duplicate_event", {
        "p_event_id": event_id,
        "p_title": body.title,
        "p_starts_at": body.starts_at.isoformat() if body.starts_at else None,
    })