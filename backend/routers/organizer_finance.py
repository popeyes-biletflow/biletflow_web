from fastapi import APIRouter, Depends, Query

from deps import db_for_user, get_current_user
from promo import call_rpc, require_organizer
from schemas import CurrentUser

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