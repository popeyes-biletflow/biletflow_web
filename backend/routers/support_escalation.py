"""FS-19: организатор передаёт обращение посетителя в поддержку платформы.

POST /api/support/cases/{case_id}/escalate  {"note": "..."}

Создаём новый кейс от имени организатора (его ведёт только Platform Admin),
а в старую переписку пишем сообщение со ссылкой на новый кейс.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from deps import db_for_user, get_current_user, sanitize_error, supabase
from routers.support import (
    ORGANIZER_PLATFORM_CATEGORIES,
    _derive_event_id_for_case,
    add_message,
    assert_can_access_case,
    create_case,
    emit_notification,
)
from schemas import CurrentUser, ROLE_ORGANIZER, ROLE_PLATFORM_ADMIN, SupportCaseCreateRequest, SupportMessageCreateRequest

router = APIRouter(prefix="/api/support", tags=["support"])


class EscalateIn(BaseModel):
    note: str = Field(default="", max_length=2000)


@router.post("/cases/{case_id}/escalate", status_code=201)
async def escalate_case(case_id: str, payload: EscalateIn, current_user: CurrentUser = Depends(get_current_user)):
    if (current_user.role or "").lower() != ROLE_ORGANIZER:
        raise HTTPException(status_code=403, detail="Only organizers can escalate cases.")

    db = db_for_user(current_user.access_token)
    try:
        res = db.table("support_cases").select("*").eq("id", case_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error(e))
    if not res.data:
        raise HTTPException(status_code=404, detail="Support case not found.")
    case = res.data[0]

    # тот же доступ, что и при просмотре: организатор только своих событий
    assert_can_access_case(case, current_user, client=db)

    if str(case.get("requester_id")) == current_user.id:
        raise HTTPException(status_code=400, detail="Your own cases already go to platform support.")
    if case.get("status") == "RESOLVED":
        raise HTTPException(status_code=409, detail="Resolved cases cannot be escalated.")

    event_id = _derive_event_id_for_case(case, db)
    category = case.get("category")
    if category not in ORGANIZER_PLATFORM_CATEGORIES:
        category = "technical"  # у организатора к платформе только account / payment / technical
    note = payload.note.strip() or "Organizer needs platform help with this attendee case."

    created = await create_case(
        SupportCaseCreateRequest(
            category=category,
            subject=f"Escalated: {case.get('subject') or case_id}"[:200],
            message=f"{note}\n\nOriginal attendee case: {case_id}",
            event_id=event_id,
        ),
        current_user=current_user,
    )
    new_case = created["case"]

    await add_message(
        case_id,
        SupportMessageCreateRequest(body=f"Передано в поддержку платформы / Escalated to platform support (case {new_case['id']})."),
        current_user=current_user,
    )

    # сообщаем админам платформы
    try:
        admins = supabase.table("profiles").select("id").eq("role", ROLE_PLATFORM_ADMIN).execute().data or []
        for a in admins:
            emit_notification(
                user_id=str(a["id"]),
                type_="SUPPORT_CASE_ESCALATED",
                title=f"Escalated case: {case.get('subject')}",
                message=note[:100],
                data={"case_id": str(new_case["id"]), "original_case_id": case_id},
            )
    except Exception:
        pass

    return {"escalation_case": new_case}
